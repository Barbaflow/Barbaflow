import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays,
  CheckCircle2,
  XCircle,
  UserX,
  ReceiptText,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Minus,
  Package,
  AlertTriangle,
  ArrowRight,
  Clock,
  Users,
  BarChart3,
  Scissors,
  Plus,
} from "lucide-react";
import { fmtBRL } from "@/lib/comandas";
import { fetchProfileSummaries, type ProfileSummaryMap } from "@/lib/profile-summaries";
import { resolvePeriod, previousPeriod } from "@/lib/report-period";
import { nowInTenantTZ, timeToMinutes } from "@/lib/tz";
import { loadOpenComandas, sectionErrorMessage, type OpenComandaRow } from "@/lib/dashboard-sections";

/** Estoque considerado "baixo" — o schema não tem limiar por produto. */
const LOW_STOCK_THRESHOLD = 5;

interface Props {
  barbershopId: string;
  isAdmin: boolean;
  userId: string;
  timezone: string;
  /** Abre a aba de produtos/estoque (ação rápida, admin). */
  onOpenProducts: () => void;
}

interface DaySummary {
  appointments_today: number;
  scheduled_today: number;
  completed_today: number;
  cancelled_today: number;
  no_show_today: number;
  open_tickets: number;
}
interface Faturamento {
  netToday: number;
  netMonth: number;
  avgMonth: number;
  prevNetMonth: number | null;
}
interface UpcomingAppt {
  id: string;
  start_time: string;
  status: string;
  client_id: string | null;
  barber_id: string;
  serviceName: string;
}
type OpenComanda = OpenComandaRow;
interface LowStock {
  id: string;
  name: string;
  stock_quantity: number;
}

type SectionState<T> = { status: "loading" | "ready" | "error"; data: T | null };

function useSection<T>() {
  return useState<SectionState<T>>({ status: "loading", data: null });
}

export function OperationalDashboard({ barbershopId, isAdmin, userId, timezone, onOpenProducts }: Props) {
  const [resumo, setResumo] = useSection<{ day: DaySummary; fat: Faturamento }>();
  const [proximos, setProximos] = useState<SectionState<UpcomingAppt[]>>({ status: "loading", data: null });
  const [comandas, setComandas] = useState<SectionState<OpenComanda[]>>({ status: "loading", data: null });
  // `null` = contagem indisponível (nunca carregou ou a consulta falhou). Não é
  // o mesmo que zero, e o badge trata os dois casos de forma diferente.
  const [comandasCount, setComandasCount] = useState<number | null>(null);
  const [estoque, setEstoque] = useState<SectionState<LowStock[]>>({ status: "loading", data: null });
  const [names, setNames] = useState<ProfileSummaryMap>({});

  const today = useMemo(() => nowInTenantTZ(timezone).iso, [timezone]);

  /* ── Resumo do dia + faturamento (RPCs; faturamento reusa report_sales_summary) ── */
  const loadResumo = useCallback(async () => {
    setResumo({ status: "loading", data: null });
    const todayP = resolvePeriod("today", timezone);
    const monthP = resolvePeriod("month", timezone);
    const prevP = previousPeriod(monthP, timezone);

    const [summaryR, todR, monR, prevR] = await Promise.all([
      supabase.rpc("get_dashboard_summary", { _barbershop_id: barbershopId }),
      supabase.rpc("report_sales_summary", { _barbershop_id: barbershopId, _start: todayP.startInstant, _end: todayP.endInstant }),
      supabase.rpc("report_sales_summary", { _barbershop_id: barbershopId, _start: monthP.startInstant, _end: monthP.endInstant }),
      supabase.rpc("report_sales_summary", { _barbershop_id: barbershopId, _start: prevP.startInstant, _end: prevP.endInstant }),
    ]);

    if (summaryR.error || todR.error || monR.error) {
      setResumo({ status: "error", data: null });
      return;
    }
    const day = (summaryR.data?.[0] as DaySummary | undefined) ?? null;
    const tod = todR.data?.[0] as { net: number } | undefined;
    const mon = monR.data?.[0] as { net: number; avg_ticket: number } | undefined;
    const prev = prevR.error ? null : (prevR.data?.[0] as { net: number; closed_count: number } | undefined);
    if (!day) {
      setResumo({ status: "error", data: null });
      return;
    }
    setResumo({
      status: "ready",
      data: {
        day,
        fat: {
          netToday: Number(tod?.net ?? 0),
          netMonth: Number(mon?.net ?? 0),
          avgMonth: Number(mon?.avg_ticket ?? 0),
          prevNetMonth: prev && prev.closed_count > 0 ? Number(prev.net) : null,
        },
      },
    });
  }, [barbershopId, timezone, setResumo]);

  /* ── Próximos agendamentos (hoje, a partir de agora) ── */
  const loadProximos = useCallback(async () => {
    setProximos({ status: "loading", data: null });
    let q = supabase
      .from("appointments")
      .select("id, start_time, status, client_id, barber_id, service:services(name)")
      .eq("barbershop_id", barbershopId)
      .eq("date", today)
      .eq("status", "scheduled")
      .order("start_time", { ascending: true })
      .limit(20);
    if (!isAdmin) q = q.eq("barber_id", userId);
    const { data, error } = await q;
    if (error) {
      setProximos({ status: "error", data: null });
      return;
    }
    const nowMin = nowInTenantTZ(timezone).minutes;
    const rows: UpcomingAppt[] = (data ?? [])
      .filter((a) => timeToMinutes(String(a.start_time)) >= nowMin)
      .slice(0, 5)
      .map((a) => {
        const svc = Array.isArray(a.service) ? a.service[0] : a.service;
        return {
          id: a.id,
          start_time: String(a.start_time).slice(0, 5),
          status: a.status,
          client_id: a.client_id,
          barber_id: a.barber_id,
          serviceName: svc?.name ?? "Serviço",
        };
      });
    setProximos({ status: "ready", data: rows });
    collectNames(rows.flatMap((r) => [r.client_id, r.barber_id]));
  }, [barbershopId, today, isAdmin, userId, timezone]);

  /* ── Comandas abertas (valores persistidos) ── */
  const loadComandas = useCallback(async () => {
    setComandas({ status: "loading", data: null });

    const result = await loadOpenComandas({
      // Contagem continua por `head: true` — nenhuma linha trafega só para contar.
      count: () => {
        let q = supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("barbershop_id", barbershopId)
          .eq("status", "aberta");
        if (!isAdmin) q = q.eq("barber_id", userId);
        return q;
      },
      list: () => {
        let q = supabase
          .from("tickets")
          .select("id, client_id, barber_id, total, created_at")
          .eq("barbershop_id", barbershopId)
          .eq("status", "aberta")
          .order("created_at", { ascending: false })
          .limit(5);
        if (!isAdmin) q = q.eq("barber_id", userId);
        return q;
      },
    });

    if (result.status === "error") {
      // Sem número confiável: zeramos para `null` para que o badge não exiba um
      // total inventado nem um valor obsoleto da carga anterior.
      setComandasCount(null);
      setComandas({ status: "error", data: null });
      return;
    }

    setComandasCount(result.count);
    setComandas({ status: "ready", data: result.rows });
    collectNames(result.rows.flatMap((r) => [r.client_id, r.barber_id]));
  }, [barbershopId, isAdmin, userId]);

  /* ── Estoque baixo (produtos ativos, esgotados primeiro) ── */
  const loadEstoque = useCallback(async () => {
    setEstoque({ status: "loading", data: null });
    const { data, error } = await supabase
      .from("products")
      .select("id, name, stock_quantity")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .lte("stock_quantity", LOW_STOCK_THRESHOLD)
      .order("stock_quantity", { ascending: true })
      .limit(8);
    if (error) {
      setEstoque({ status: "error", data: null });
      return;
    }
    setEstoque({ status: "ready", data: (data ?? []) as LowStock[] });
  }, [barbershopId]);

  const collectNames = useCallback((ids: (string | null)[]) => {
    const wanted = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (wanted.length === 0) return;
    fetchProfileSummaries(wanted).then((map) => setNames((prev) => ({ ...prev, ...map })));
  }, []);

  useEffect(() => {
    loadResumo();
    loadProximos();
    loadComandas();
    loadEstoque();
  }, [loadResumo, loadProximos, loadComandas, loadEstoque]);

  // Realtime: um único canal do dashboard para tickets + appointments do tenant.
  // (products NÃO está na publication; o estoque é refeito ao fechar comanda.)
  useEffect(() => {
    if (!barbershopId) return;
    const channel = supabase
      .channel(`dashboard-ops-${barbershopId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `barbershop_id=eq.${barbershopId}` }, () => {
        loadResumo();
        loadComandas();
        loadEstoque();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `barbershop_id=eq.${barbershopId}` }, () => {
        loadResumo();
        loadProximos();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // Só o tenant governa o canal — os loaders são estáveis por barbershopId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barbershopId]);

  const nameOf = (id: string | null) => (id ? names[id]?.full_name ?? "—" : "—");

  return (
    <div className="space-y-4">
      {/* 1 + 4 — Resumo do dia + Faturamento */}
      <ResumoSection state={resumo} isAdmin={isAdmin} onRetry={loadResumo} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 2 — Próximos agendamentos */}
        <ProximosSection state={proximos} nameOf={nameOf} onRetry={loadProximos} />
        {/* 3 — Comandas abertas */}
        <ComandasSection state={comandas} count={comandasCount} nameOf={nameOf} onRetry={loadComandas} />
      </div>

      {/* 5 — Estoque baixo */}
      <EstoqueSection state={estoque} onRetry={loadEstoque} onOpenProducts={onOpenProducts} isAdmin={isAdmin} />

      {/* 6 — Ações rápidas */}
      <QuickActions isAdmin={isAdmin} onOpenProducts={onOpenProducts} />
    </div>
  );
}

/* ══════════════════════ Seções ══════════════════════ */

function ResumoSection({
  state,
  isAdmin,
  onRetry,
}: {
  state: SectionState<{ day: DaySummary; fat: Faturamento }>;
  isAdmin: boolean;
  onRetry: () => void;
}) {
  if (state.status === "loading") return <Skeleton className="h-40 rounded-xl" />;
  if (state.status === "error" || !state.data)
    return <SectionError title="Resumo do dia" onRetry={onRetry} />;

  const { day, fat } = state.data;
  const delta = fat.prevNetMonth !== null ? fat.netMonth - fat.prevNetMonth : null;
  const deltaPct = fat.prevNetMonth ? Math.round((delta! / fat.prevNetMonth) * 100) : null;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat icon={CalendarDays} label="Agendamentos hoje" value={day.appointments_today} />
        <MiniStat icon={CheckCircle2} label="Concluídos" value={day.completed_today} tone="good" />
        <MiniStat icon={XCircle} label="Cancelados" value={day.cancelled_today} tone="muted" />
        <MiniStat icon={UserX} label="Faltas" value={day.no_show_today} tone="warn" />
        <MiniStat icon={ReceiptText} label="Comandas abertas" value={day.open_tickets} tone="accent" />
        <MiniStat icon={DollarSign} label="Líquido hoje" value={fmtBRL(fat.netToday)} tone="accent" />
      </div>

      {/* Faturamento resumido */}
      <Card className="bg-card border-border">
        <CardContent className="p-5 flex flex-wrap items-center gap-x-8 gap-y-2 justify-between">
          <FatItem label="Líquido do mês" value={fmtBRL(fat.netMonth)} accent />
          <FatItem label="Ticket médio (mês)" value={fmtBRL(fat.avgMonth)} />
          <div className="flex flex-col">
            <span className="text-sm text-muted-foreground">vs. mês anterior</span>
            {delta === null ? (
              <span className="text-base text-muted-foreground/70">sem comparação</span>
            ) : (
              <span className={`text-base flex items-center gap-1 ${delta > 0 ? "text-emerald-500" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                {delta > 0 ? <TrendingUp className="w-4 h-4" /> : delta < 0 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
                {delta === 0 ? "estável" : `${delta > 0 ? "+" : "−"}${fmtBRL(Math.abs(delta))}${deltaPct !== null ? ` (${deltaPct >= 0 ? "+" : ""}${deltaPct}%)` : ""}`}
              </span>
            )}
          </div>
          <Link to="/relatorios" search={{ barbershop: undefined }} className="text-base text-primary hover:underline flex items-center gap-1">
            {isAdmin ? "Ver relatórios completos" : "Ver meu faturamento"}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function ProximosSection({
  state,
  nameOf,
  onRetry,
}: {
  state: SectionState<UpcomingAppt[]>;
  nameOf: (id: string | null) => string;
  onRetry: () => void;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary" /> Próximos agendamentos
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {state.status === "loading" ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : state.status === "error" ? (
          <SectionError onRetry={onRetry} inline />
        ) : !state.data || state.data.length === 0 ? (
          <EmptyInline message="Nenhum atendimento restante hoje." />
        ) : (
          <div className="space-y-2">
            {state.data.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-foreground shrink-0">{a.start_time}</span>
                  <div className="min-w-0">
                    <p className="text-foreground truncate">{nameOf(a.client_id)}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {a.serviceName} · {nameOf(a.barber_id)}
                    </p>
                  </div>
                </div>
                <a href="#agenda-do-dia">
                  <Button variant="ghost" size="sm" className="shrink-0">
                    Agenda
                  </Button>
                </a>
              </div>
            ))}
            <Link to="/comandas" search={{ barbershop: undefined, comanda: undefined }} className="text-xs text-primary hover:underline inline-flex items-center gap-1 pt-1">
              Ir para comandas <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ComandasSection({
  state,
  count,
  nameOf,
  onRetry,
}: {
  state: SectionState<OpenComanda[]>;
  /** `null` quando a contagem não pôde ser obtida — não renderiza badge algum. */
  count: number | null;
  nameOf: (id: string | null) => string;
  onRetry: () => void;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <ReceiptText className="w-4 h-4 text-primary" /> Comandas abertas
          {count !== null && count > 0 && (
            <span className="ml-auto text-xs bg-primary/15 text-primary rounded-full px-2 py-0.5">{count}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {state.status === "loading" ? (
          <Skeleton className="h-24 rounded-lg" />
        ) : state.status === "error" ? (
          <SectionError onRetry={onRetry} inline />
        ) : !state.data || state.data.length === 0 ? (
          <EmptyInline message="Nenhuma comanda aberta." />
        ) : (
          <div className="space-y-2">
            {state.data.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="text-foreground truncate">{nameOf(c.client_id)}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {nameOf(c.barber_id)} · aberta {fmtHour(c.created_at)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold text-foreground">{fmtBRL(c.total)}</span>
                  <Link to="/comandas" search={{ barbershop: undefined, comanda: c.id }}>
                    <Button variant="outline" size="sm">Continuar</Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EstoqueSection({
  state,
  onRetry,
  onOpenProducts,
  isAdmin,
}: {
  state: SectionState<LowStock[]>;
  onRetry: () => void;
  onOpenProducts: () => void;
  isAdmin: boolean;
}) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" /> Estoque baixo
        </CardTitle>
        {isAdmin && (
          <Button variant="ghost" size="sm" onClick={onOpenProducts}>
            Produtos <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {state.status === "loading" ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : state.status === "error" ? (
          <SectionError onRetry={onRetry} inline />
        ) : !state.data || state.data.length === 0 ? (
          <EmptyInline message="Nenhum produto com estoque baixo." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {state.data.map((p) => {
              const out = p.stock_quantity <= 0;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                    out ? "border-destructive/40 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5"
                  }`}
                >
                  <span className="text-foreground">{p.name}</span>
                  <span className={`text-xs font-semibold ${out ? "text-destructive" : "text-amber-500"}`}>
                    {out ? "Esgotado" : `${p.stock_quantity} un`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickActions({ isAdmin, onOpenProducts }: { isAdmin: boolean; onOpenProducts: () => void }) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 flex flex-wrap gap-2">
        <a href="#agenda-do-dia">
          <Button variant="outline" size="sm"><CalendarDays className="w-4 h-4" /> Agenda</Button>
        </a>
        <Link to="/comandas" search={{ barbershop: undefined, comanda: undefined }}>
          <Button variant="outline" size="sm"><Plus className="w-4 h-4" /> Nova comanda</Button>
        </Link>
        {isAdmin && (
          <Link to="/clientes" search={{ barbershop: undefined }}>
            <Button variant="outline" size="sm"><Users className="w-4 h-4" /> Clientes</Button>
          </Link>
        )}
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={onOpenProducts}>
            <Scissors className="w-4 h-4" /> Produtos
          </Button>
        )}
        <Link to="/relatorios" search={{ barbershop: undefined }}>
          <Button variant="outline" size="sm"><BarChart3 className="w-4 h-4" /> Relatórios</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════ Auxiliares ══════════════════════ */

function MiniStat({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string | number;
  tone?: "neutral" | "good" | "warn" | "muted" | "accent";
}) {
  const color =
    tone === "good" ? "text-emerald-500"
    : tone === "warn" ? "text-amber-500"
    : tone === "accent" ? "text-primary"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-muted-foreground leading-tight">{label}</span>
        </div>
        {/* `font-body` (DM Sans) e não `font-display` (Playfair Display): a
            serifada é boa em título, mas atrapalha em número — o "0" e o "R$"
            ficam com pouco contraste de forma. Só a família muda; tamanho, peso
            e cor seguem iguais. O rótulo acima continua como estava. */}
        <span className={`text-xl font-body font-bold ${tone === "accent" ? "text-primary" : "text-foreground"}`}>
          {value}
        </span>
      </CardContent>
    </Card>
  );
}

function FatItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-sm text-muted-foreground">{label}</span>
      {/* Mesma troca do MiniStat: número em `font-body`. */}
      <span className={`text-xl font-body font-bold ${accent ? "text-primary" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

function SectionError({ title, onRetry, inline }: { title?: string; onRetry: () => void; inline?: boolean }) {
  const body = (
    <div className={`flex items-center gap-2 ${inline ? "py-3" : "p-4"} text-sm`}>
      <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
      <span className="text-muted-foreground">{sectionErrorMessage(title)}</span>
      <Button variant="ghost" size="sm" onClick={onRetry}>Tentar novamente</Button>
    </div>
  );
  if (inline) return body;
  return <Card className="border-destructive/40"><CardContent className="p-2">{body}</CardContent></Card>;
}

function EmptyInline({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground py-4 text-center">{message}</p>;
}

/** Hora HH:MM de um timestamp ISO (para "aberta às"). */
function fmtHour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
