import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from "recharts";
import { ArrowLeft, TrendingDown, MessageSquare, Users } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/churn")({
  head: () => ({
    meta: [
      { title: "Relatório de Churn — BarbaFlow Admin" },
      { name: "description", content: "Motivos de cancelamento de conta agrupados." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ChurnReportPage,
});

const REASON_LABELS: Record<string, string> = {
  no_use: "Não usei o suficiente",
  found_alternative: "Encontrei outra solução",
  too_expensive: "Muito caro",
  missing_features: "Faltam funcionalidades",
  bad_experience: "Experiência ruim",
  privacy: "Preocupação com privacidade",
  temporary: "Pausa temporária",
  other: "Outro motivo",
};

const REASON_COLORS: Record<string, string> = {
  no_use: "hsl(45, 70%, 55%)",
  found_alternative: "hsl(15, 75%, 55%)",
  too_expensive: "hsl(0, 70%, 55%)",
  missing_features: "hsl(265, 60%, 60%)",
  bad_experience: "hsl(345, 70%, 55%)",
  privacy: "hsl(200, 70%, 55%)",
  temporary: "hsl(180, 50%, 50%)",
  other: "hsl(220, 10%, 55%)",
};

type FeedbackRow = {
  id: string;
  reason: string;
  details: string | null;
  had_barbershop_role: boolean;
  created_at: string;
};

type Period = "30" | "90";

function ChurnReportPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<Period>("30");
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Auth + role guard
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/login", search: { redirect: undefined } });
      return;
    }
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "super_admin" })
      .then(({ data, error }) => {
        if (error || !data) {
          setAllowed(false);
        } else {
          setAllowed(true);
        }
      });
  }, [user, authLoading, navigate]);

  // Load feedback for the selected period
  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    const days = parseInt(period, 10);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    supabase
      .from("account_deletion_feedback")
      .select("id, reason, details, had_barbershop_role, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (error) {
          toast.error("Erro ao carregar feedback", { description: error.message });
          setRows([]);
        } else {
          setRows((data ?? []) as FeedbackRow[]);
        }
        setLoading(false);
      });
  }, [allowed, period]);

  const grouped = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
    }
    const total = rows.length;
    return Array.from(counts.entries())
      .map(([reason, count]) => ({
        reason,
        label: REASON_LABELS[reason] ?? reason,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
        color: REASON_COLORS[reason] ?? "hsl(220, 10%, 55%)",
      }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const totalDeletions = rows.length;
  const ownerDeletions = useMemo(
    () => rows.filter((r) => r.had_barbershop_role).length,
    [rows],
  );
  const recentDetails = useMemo(
    () => rows.filter((r) => r.details && r.details.trim().length > 0).slice(0, 10),
    [rows],
  );

  const chartConfig: ChartConfig = useMemo(() => {
    const cfg: ChartConfig = {};
    for (const g of grouped) {
      cfg[g.reason] = { label: g.label, color: g.color };
    }
    return cfg;
  }, [grouped]);

  if (authLoading || allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Acesso negado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Esta página é restrita a administradores do sistema.
            </p>
            <Link to="/dashboard" search={{}}>
              <Button variant="secondary" className="w-full">
                Voltar ao painel
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/dashboard" search={{}}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Voltar</span>
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="font-display text-lg text-foreground truncate">
                Relatório de Churn
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Motivos de exclusão de conta
              </p>
            </div>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="30">30 dias</TabsTrigger>
              <TabsTrigger value="90">90 dias</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingDown className="w-4 h-4 text-destructive" />
                <span className="text-xs text-muted-foreground">
                  Total de exclusões
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-display font-bold text-foreground">
                  {totalDeletions}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">
                  Donos / equipe
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-display font-bold text-foreground">
                  {ownerDeletions}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">
                  Com detalhes escritos
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-display font-bold text-foreground">
                  {rows.filter((r) => r.details && r.details.trim()).length}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Motivos agrupados — últimos {period} dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : grouped.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <TrendingDown className="w-10 h-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">
                  Nenhuma exclusão de conta neste período. 🎉
                </p>
              </div>
            ) : (
              <ChartContainer config={chartConfig} className="h-[320px] w-full">
                <BarChart data={grouped} layout="vertical" margin={{ left: 12, right: 24 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                  <XAxis type="number" allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={170}
                    tick={{ fontSize: 12 }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelKey="label"
                        formatter={(value, _name, item) => {
                          const payload = item?.payload as
                            | { count: number; percent: number; label: string }
                            | undefined;
                          return (
                            <div className="flex items-center justify-between gap-4 w-full">
                              <span className="text-muted-foreground">
                                {payload?.label}
                              </span>
                              <span className="font-mono font-medium">
                                {value} ({payload?.percent ?? 0}%)
                              </span>
                            </div>
                          );
                        }}
                      />
                    }
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {grouped.map((entry) => (
                      <Cell key={entry.reason} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </CardContent>
        </Card>

        {/* Breakdown table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contagem por motivo</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : grouped.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                Sem dados.
              </p>
            ) : (
              <div className="space-y-2">
                {grouped.map((g) => (
                  <div
                    key={g.reason}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-card/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="h-3 w-3 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: g.color }}
                      />
                      <span className="text-sm text-foreground truncate">
                        {g.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {g.percent}%
                      </span>
                      <span className="text-sm font-mono font-semibold text-foreground tabular-nums">
                        {g.count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent comments */}
        {recentDetails.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Comentários recentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentDetails.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-lg border border-border bg-card/50 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{REASON_LABELS[r.reason] ?? r.reason}</span>
                    <span>
                      {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {r.details}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
