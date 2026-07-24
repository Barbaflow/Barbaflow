import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Receipt,
  BadgePercent,
  Scissors,
  Package,
  Users,
  CreditCard,
  AlertTriangle,
  Store,
} from "lucide-react";
import { fmtBRL } from "@/lib/comandas";
import { fetchProfileSummaries, type ProfileSummaryMap } from "@/lib/profile-summaries";
import { formatISODateBR, DEFAULT_TENANT_TZ } from "@/lib/tz";
import {
  resolvePeriod,
  previousPeriod,
  type PeriodPreset,
  type ReportPeriod,
} from "@/lib/report-period";

/** Estoque considerado "baixo" — o schema não tem limiar por produto. */
const LOW_STOCK_THRESHOLD = 5;

interface Props {
  barbershopId: string;
  isSuper: boolean;
  isAdmin: boolean;
  isBarber: boolean;
  isForeignTenant: boolean;
}

interface Summary {
  gross: number;
  discount: number;
  net: number;
  closed_count: number;
  avg_ticket: number;
  services_count: number;
  products_count: number;
}
interface DayPoint {
  day: string;
  net: number;
  closed_count: number;
}
interface ServiceRow {
  service_id: string | null;
  name: string;
  revenue: number;
  quantity: number;
}
interface ProductRow {
  product_id: string | null;
  name: string;
  revenue: number;
  quantity: number;
  stock_quantity: number | null;
  active: boolean | null;
}
interface BarberRow {
  barber_id: string;
  tickets_count: number;
  services_count: number;
  net: number;
  avg_ticket: number;
}
interface PaymentRow {
  method_name: string;
  amount: number;
  tickets_count: number;
}

interface ReportData {
  summary: Summary;
  prevSummary: Summary | null;
  series: DayPoint[];
  services: ServiceRow[];
  products: ProductRow[];
  barbers: BarberRow[];
  payments: PaymentRow[];
}

type Status = "loading" | "ready" | "empty" | "error";

const ZERO_SUMMARY: Summary = {
  gross: 0, discount: 0, net: 0, closed_count: 0, avg_ticket: 0, services_count: 0, products_count: 0,
};

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "last7", label: "7 dias" },
  { key: "month", label: "Mês atual" },
  { key: "prevMonth", label: "Mês anterior" },
  { key: "custom", label: "Personalizado" },
];

const chartConfig: ChartConfig = {
  net: { label: "Faturamento (R$)", color: "var(--chart-2)" },
  comandas: { label: "Comandas", color: "var(--chart-1)" },
};

export function BarberReports({ barbershopId, isSuper, isAdmin, isForeignTenant }: Props) {
  const [shop, setShop] = useState<{ name: string; timezone: string } | null>(null);
  const [shopError, setShopError] = useState(false);

  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState<{ startISO: string; endISO: string } | undefined>(undefined);

  const [data, setData] = useState<ReportData | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [barberNames, setBarberNames] = useState<ProfileSummaryMap>({});

  const showProfessionals = isAdmin || isSuper;

  /* ── Barbearia (nome + fuso) ─────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    setShop(null);
    setShopError(false);
    supabase
      .from("barbershops")
      .select("name, timezone")
      .eq("id", barbershopId)
      .maybeSingle()
      .then(({ data: row, error }) => {
        if (cancelled) return;
        if (error) setShopError(true);
        else setShop(row ? { name: String(row.name), timezone: String(row.timezone || DEFAULT_TENANT_TZ) } : null);
      });
    return () => {
      cancelled = true;
    };
  }, [barbershopId]);

  const tz = shop?.timezone ?? DEFAULT_TENANT_TZ;

  const period = useMemo<ReportPeriod>(
    () => resolvePeriod(preset, tz, custom),
    [preset, tz, custom],
  );

  /* ── Carrega os relatórios do período ────────────────────────────────── */
  const fetchReports = useCallback(async () => {
    if (!shop) return; // espera o fuso da barbearia para não recortar no fuso errado
    setStatus("loading");
    setErrorMsg(null);

    const prev = previousPeriod(period, tz);
    const baseArgs = { _barbershop_id: barbershopId, _start: period.startInstant, _end: period.endInstant };

    const [summaryR, prevR, seriesR, servicesR, productsR, barbersR, paymentsR] = await Promise.all([
      supabase.rpc("report_sales_summary", baseArgs),
      supabase.rpc("report_sales_summary", {
        _barbershop_id: barbershopId, _start: prev.startInstant, _end: prev.endInstant,
      }),
      supabase.rpc("report_sales_timeseries", baseArgs),
      supabase.rpc("report_services", baseArgs),
      supabase.rpc("report_products", baseArgs),
      supabase.rpc("report_by_barber", baseArgs),
      supabase.rpc("report_payment_methods", baseArgs),
    ]);

    const firstError =
      summaryR.error || seriesR.error || servicesR.error || productsR.error || barbersR.error || paymentsR.error;
    if (firstError) {
      setErrorMsg(firstError.message ?? "Falha ao carregar os relatórios.");
      setStatus("error");
      return;
    }

    const summary = (summaryR.data?.[0] as Summary | undefined) ?? ZERO_SUMMARY;
    // A comparação só existe se o período anterior teve vendas (não inventamos).
    const prevSummary = (prevR.data?.[0] as Summary | undefined) ?? null;

    const barbers = (barbersR.data as BarberRow[] | null) ?? [];
    if (barbers.length > 0) {
      const names = await fetchProfileSummaries(barbers.map((b) => b.barber_id));
      setBarberNames(names);
    } else {
      setBarberNames({});
    }

    setData({
      summary,
      prevSummary: prevSummary && prevSummary.closed_count > 0 ? prevSummary : null,
      series: (seriesR.data as DayPoint[] | null) ?? [],
      services: (servicesR.data as ServiceRow[] | null) ?? [],
      products: (productsR.data as ProductRow[] | null) ?? [],
      barbers,
      payments: (paymentsR.data as PaymentRow[] | null) ?? [],
    });
    setStatus(summary.closed_count === 0 ? "empty" : "ready");
  }, [shop, period, tz, barbershopId]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  /* ── Série diária com zeros preenchidos ──────────────────────────────── */
  const dailyChart = useMemo(() => {
    const byDay = new Map((data?.series ?? []).map((d) => [d.day, d]));
    return period.days.map((iso) => {
      const hit = byDay.get(iso);
      return {
        label: formatISODateBR(iso),
        net: hit ? Number(hit.net) : 0,
        comandas: hit ? Number(hit.closed_count) : 0,
      };
    });
  }, [data?.series, period.days]);

  const net = data?.summary.net ?? 0;
  const paymentsTotal = useMemo(
    () => (data?.payments ?? []).reduce((s, p) => s + Number(p.amount), 0),
    [data?.payments],
  );
  const paymentsDiverge = status === "ready" && net > 0 && Math.abs(paymentsTotal - net) > 0.01;

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard" search={{ checkout: undefined }}>
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-bold text-foreground truncate">Relatórios</h1>
            <p className="text-xs text-muted-foreground truncate">{shop?.name ?? "Carregando…"}</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {isForeignTenant && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <Store className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              Você está vendo os relatórios de <strong>{shop?.name ?? "a barbearia selecionada"}</strong> como super admin.
            </p>
          </div>
        )}

        {/* Filtros de período */}
        <PeriodFilter
          preset={preset}
          custom={custom}
          period={period}
          onPreset={(p) => {
            setPreset(p);
            if (p !== "custom") setCustom(undefined);
          }}
          onCustom={(range) => {
            setCustom(range);
            setPreset("custom");
          }}
        />

        {shopError ? (
          <ErrorState message="Não foi possível carregar os dados da barbearia." onRetry={fetchReports} />
        ) : status === "loading" ? (
          <LoadingState />
        ) : status === "error" ? (
          <ErrorState message={errorMsg ?? "Falha ao carregar os relatórios."} onRetry={fetchReports} />
        ) : status === "empty" ? (
          <EmptyState label={period.label} />
        ) : data ? (
          <ReportBody
            data={data}
            dailyChart={dailyChart}
            net={net}
            paymentsTotal={paymentsTotal}
            paymentsDiverge={paymentsDiverge}
            barberNames={barberNames}
            showProfessionals={showProfessionals}
          />
        ) : null}
      </main>
    </div>
  );
}

/* ══════════════════════ Filtro de período ══════════════════════════════ */

function PeriodFilter({
  preset,
  custom,
  period,
  onPreset,
  onCustom,
}: {
  preset: PeriodPreset;
  custom?: { startISO: string; endISO: string };
  period: ReportPeriod;
  onPreset: (p: PeriodPreset) => void;
  onCustom: (range: { startISO: string; endISO: string }) => void;
}) {
  const startISO = custom?.startISO ?? period.startISO;
  const endISO = custom?.endISO ?? period.endISO;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            variant={preset === p.key ? "gold" : "outline"}
            size="sm"
            onClick={() => onPreset(p.key)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            De
            <input
              type="date"
              value={startISO}
              max={endISO}
              onChange={(e) => onCustom({ startISO: e.target.value, endISO })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            até
            <input
              type="date"
              value={endISO}
              min={startISO}
              onChange={(e) => onCustom({ startISO, endISO: e.target.value })}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </label>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        Período: <span className="text-foreground font-medium">{period.label}</span>
      </p>
    </div>
  );
}

/* ══════════════════════ Corpo do relatório ═════════════════════════════ */

function ReportBody({
  data,
  dailyChart,
  net,
  paymentsTotal,
  paymentsDiverge,
  barberNames,
  showProfessionals,
}: {
  data: ReportData;
  dailyChart: { label: string; net: number; comandas: number }[];
  net: number;
  paymentsTotal: number;
  paymentsDiverge: boolean;
  barberNames: ProfileSummaryMap;
  showProfessionals: boolean;
}) {
  const { summary, prevSummary } = data;
  const interval = Math.max(0, Math.floor(dailyChart.length / 8));

  return (
    <>
      {/* Indicadores */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard icon={DollarSign} label="Faturamento líquido" value={fmtBRL(summary.net)} accent
          delta={delta(summary.net, prevSummary?.net)} money />
        <KpiCard icon={Receipt} label="Faturamento bruto" value={fmtBRL(summary.gross)}
          delta={delta(summary.gross, prevSummary?.gross)} money />
        <KpiCard icon={BadgePercent} label="Descontos" value={fmtBRL(summary.discount)}
          delta={delta(summary.discount, prevSummary?.discount)} money invertGood />
        <KpiCard icon={Receipt} label="Comandas fechadas" value={String(summary.closed_count)}
          delta={delta(summary.closed_count, prevSummary?.closed_count)} />
        <KpiCard icon={TrendingUp} label="Ticket médio" value={fmtBRL(summary.avg_ticket)}
          delta={delta(summary.avg_ticket, prevSummary?.avg_ticket)} money />
        <KpiCard icon={Scissors} label="Serviços vendidos" value={String(summary.services_count)}
          delta={delta(summary.services_count, prevSummary?.services_count)} />
        <KpiCard icon={Package} label="Produtos vendidos" value={String(summary.products_count)}
          delta={delta(summary.products_count, prevSummary?.products_count)} />
      </div>

      {/* Evolução temporal */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Evolução do faturamento
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <ComposedChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.28 0.02 260)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }}
                tickLine={false} axisLine={false} interval={interval} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }}
                tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" allowDecimals={false}
                tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar yAxisId="left" dataKey="net" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Line yAxisId="right" dataKey="comandas" stroke="var(--chart-1)" strokeWidth={2} dot={false} type="monotone" />
            </ComposedChart>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Serviços e produtos lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankingCard title="Serviços vendidos" icon={Scissors} emptyMsg="Nenhum serviço vendido."
          rows={data.services.map((s) => ({
            key: s.service_id ?? s.name,
            name: s.name,
            revenue: s.revenue,
            sub: `${s.quantity}x · ${pct(s.revenue, net)}% do faturamento`,
          }))} />
        <RankingCard title="Produtos vendidos" icon={Package} emptyMsg="Nenhum produto vendido."
          rows={data.products.map((p) => ({
            key: p.product_id ?? p.name,
            name: p.name,
            revenue: p.revenue,
            sub: `${p.quantity}x · estoque ${p.stock_quantity ?? "—"}`,
            badge:
              p.stock_quantity !== null && p.stock_quantity <= LOW_STOCK_THRESHOLD
                ? "Estoque baixo"
                : undefined,
          }))} />
      </div>

      {/* Profissionais (só admin/super) */}
      {showProfessionals && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" /> Profissionais
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {data.barbers.length === 0 ? (
              <EmptyInline message="Nenhum atendimento no período." />
            ) : (
              <div className="space-y-3">
                {data.barbers.map((b) => (
                  <div key={b.barber_id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        {barberNames[b.barber_id]?.full_name ?? "Profissional"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {b.tickets_count} comandas · {b.services_count} serviços · TM {fmtBRL(b.avg_ticket)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-foreground">{fmtBRL(b.net)}</p>
                      <p className="text-xs text-muted-foreground">{pct(b.net, net)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Formas de pagamento */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Formas de pagamento
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          {data.payments.length === 0 ? (
            <EmptyInline message="Nenhum pagamento registrado no período." />
          ) : (
            data.payments.map((p) => (
              <div key={p.method_name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{p.method_name}</span>
                  <span className="text-muted-foreground">
                    <span className="text-foreground font-semibold">{fmtBRL(p.amount)}</span>
                    {" · "}{p.tickets_count} comandas · {pct(p.amount, paymentsTotal)}%
                  </span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct(p.amount, paymentsTotal)}%` }} />
                </div>
              </div>
            ))
          )}
          {paymentsDiverge && (
            <div className="flex items-start gap-2 pt-1 text-xs text-amber-500">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                Pagamentos ({fmtBRL(paymentsTotal)}) não batem com o faturamento líquido ({fmtBRL(net)}).
                Há comandas fechadas sem pagamento totalmente registrado.
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/* ══════════════════════ Sub-componentes ════════════════════════════════ */

interface Delta {
  abs: number;
  pct: number | null;
  direction: "up" | "down" | "stable";
}

/** Comparação com o período anterior; `null` quando não há base para comparar. */
function delta(current: number, previous: number | null | undefined): Delta | null {
  if (previous === null || previous === undefined) return null;
  const abs = current - previous;
  const direction = Math.abs(abs) < 1e-9 ? "stable" : abs > 0 ? "up" : "down";
  const p = previous !== 0 ? (abs / previous) * 100 : null;
  return { abs, pct: p, direction };
}

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
  delta,
  money,
  invertGood,
}: {
  icon: typeof DollarSign;
  label: string;
  value: string;
  accent?: boolean;
  delta: Delta | null;
  money?: boolean;
  /** Quando true, uma QUEDA é "boa" (ex.: descontos) e vira verde. */
  invertGood?: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-4 h-4 ${accent ? "text-primary" : "text-muted-foreground"}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <span className={`text-xl font-display font-bold ${accent ? "text-primary" : "text-foreground"}`}>
          {value}
        </span>
        <DeltaBadge delta={delta} money={money} invertGood={invertGood} />
      </CardContent>
    </Card>
  );
}

function DeltaBadge({ delta, money, invertGood }: { delta: Delta | null; money?: boolean; invertGood?: boolean }) {
  if (!delta) {
    return <span className="text-[11px] text-muted-foreground/60">sem comparação</span>;
  }
  const good = invertGood ? delta.direction === "down" : delta.direction === "up";
  const color =
    delta.direction === "stable" ? "text-muted-foreground" : good ? "text-emerald-500" : "text-destructive";
  const Icon = delta.direction === "up" ? TrendingUp : delta.direction === "down" ? TrendingDown : Minus;
  const absText = money ? fmtBRL(Math.abs(delta.abs)) : String(Math.abs(Math.round(delta.abs)));
  const pctText = delta.pct === null ? "" : ` (${delta.pct >= 0 ? "+" : ""}${delta.pct.toFixed(0)}%)`;
  return (
    <span className={`text-[11px] flex items-center gap-1 ${color}`}>
      <Icon className="w-3 h-3" />
      {delta.direction === "stable" ? "estável" : `${delta.abs >= 0 ? "+" : "−"}${absText}${pctText}`}
    </span>
  );
}

function RankingCard({
  title,
  icon: Icon,
  rows,
  emptyMsg,
}: {
  title: string;
  icon: typeof Scissors;
  rows: { key: string; name: string; revenue: number; sub: string; badge?: string }[];
  emptyMsg: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.revenue), 0);
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="w-4 h-4 text-primary" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {rows.length === 0 ? (
          <EmptyInline message={emptyMsg} />
        ) : (
          rows.map((r) => (
            <div key={r.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="font-medium text-foreground truncate">{r.name}</span>
                  {r.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500 shrink-0">
                      {r.badge}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  <span className="text-foreground font-semibold">{fmtBRL(r.revenue)}</span>
                </span>
              </div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${max > 0 ? (r.revenue / max) * 100 : 0}%` }} />
              </div>
              <p className="text-[11px] text-muted-foreground">{r.sub}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl" />
      ))}
      <Skeleton className="col-span-2 md:col-span-4 h-64 rounded-xl" />
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-10 text-center space-y-2">
        <Receipt className="w-10 h-10 mx-auto text-muted-foreground" />
        <h2 className="font-display text-lg text-foreground">Nenhuma venda no período</h2>
        <p className="text-sm text-muted-foreground">
          Não há comandas fechadas em <span className="text-foreground">{label}</span>. Feche uma comanda
          ou selecione outro período.
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="p-8 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 mx-auto text-destructive" />
        <h2 className="font-display text-lg text-foreground">Não foi possível carregar</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button variant="outline" onClick={onRetry}>Tentar novamente</Button>
      </CardContent>
    </Card>
  );
}

function EmptyInline({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground py-4 text-center">{message}</p>;
}

/** Percentual inteiro seguro (divisão por zero → 0). */
function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}
