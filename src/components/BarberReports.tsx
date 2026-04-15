import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Calendar,
  DollarSign,
  TrendingUp,
  Users,
  Scissors,
} from "lucide-react";

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface MonthlyAppointment {
  id: string;
  date: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  service: { name: string; price: number } | null;
}

interface DailyData {
  day: string;
  dayNum: number;
  agendamentos: number;
  receita: number;
}

interface StatusData {
  name: string;
  value: number;
  fill: string;
}

interface ServiceData {
  name: string;
  count: number;
  revenue: number;
}

const statusChartConfig: ChartConfig = {
  concluidos: { label: "Concluídos", color: "oklch(0.65 0.17 145)" },
  cancelados: { label: "Cancelados", color: "oklch(0.577 0.245 27.325)" },
  naoCompareceu: { label: "Não compareceu", color: "oklch(0.75 0.18 55)" },
  agendados: { label: "Agendados", color: "oklch(0.75 0.1 75)" },
};

const barChartConfig: ChartConfig = {
  agendamentos: { label: "Agendamentos", color: "var(--chart-1)" },
  receita: { label: "Receita (R$)", color: "var(--chart-2)" },
};

const STATUS_COLORS = [
  "oklch(0.65 0.17 145)",   // completed - green
  "oklch(0.577 0.245 27.325)", // cancelled - red
  "oklch(0.75 0.18 55)",    // no_show - amber
  "oklch(0.75 0.1 75)",     // scheduled - gold
];

export function BarberReports() {
  const { user } = useAuth();
  const { barbershopId, barbershop } = useBarbershop();
  const [appointments, setAppointments] = useState<MonthlyAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const fetchMonthData = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const startDate = `${selectedMonth.year}-${String(selectedMonth.month + 1).padStart(2, "0")}-01`;
    const lastDay = new Date(selectedMonth.year, selectedMonth.month + 1, 0).getDate();
    const endDate = `${selectedMonth.year}-${String(selectedMonth.month + 1).padStart(2, "0")}-${lastDay}`;

    const { data, error } = await supabase
      .from("appointments")
      .select("id, date, status, service:services(name, price)")
      .eq("barbershop_id", barbershopId)
      .eq("barber_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date", { ascending: true });

    if (!error && data) {
      setAppointments(
        data.map((a) => ({
          ...a,
          service: Array.isArray(a.service) ? a.service[0] || null : a.service,
        })) as MonthlyAppointment[]
      );
    }
    setLoading(false);
  }, [user, barbershopId, selectedMonth]);

  useEffect(() => {
    fetchMonthData();
  }, [fetchMonthData]);

  const shiftMonth = (delta: number) => {
    setSelectedMonth((prev) => {
      let m = prev.month + delta;
      let y = prev.year;
      if (m < 0) { m = 11; y--; }
      if (m > 11) { m = 0; y++; }
      return { year: y, month: m };
    });
  };

  // ── Computed metrics ──────────────────────────────

  const metrics = useMemo(() => {
    const total = appointments.length;
    const completed = appointments.filter((a) => a.status === "completed").length;
    const cancelled = appointments.filter((a) => a.status === "cancelled").length;
    const noShow = appointments.filter((a) => a.status === "no_show").length;
    const scheduled = appointments.filter((a) => a.status === "scheduled").length;
    const revenue = appointments
      .filter((a) => a.status === "completed")
      .reduce((sum, a) => sum + (a.service?.price ?? 0), 0);
    const avgTicket = completed > 0 ? revenue / completed : 0;

    return { total, completed, cancelled, noShow, scheduled, revenue, avgTicket };
  }, [appointments]);

  // ── Daily chart data ──────────────────────────────

  const dailyData = useMemo<DailyData[]>(() => {
    const lastDay = new Date(selectedMonth.year, selectedMonth.month + 1, 0).getDate();
    const days: DailyData[] = [];

    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${selectedMonth.year}-${String(selectedMonth.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayAppts = appointments.filter((a) => a.date === dateStr);
      days.push({
        day: String(d),
        dayNum: d,
        agendamentos: dayAppts.length,
        receita: dayAppts
          .filter((a) => a.status === "completed")
          .reduce((sum, a) => sum + (a.service?.price ?? 0), 0),
      });
    }
    return days;
  }, [appointments, selectedMonth]);

  // ── Status pie data ───────────────────────────────

  const statusData = useMemo<StatusData[]>(() => {
    const items: StatusData[] = [];
    if (metrics.completed > 0) items.push({ name: "Concluídos", value: metrics.completed, fill: STATUS_COLORS[0] });
    if (metrics.cancelled > 0) items.push({ name: "Cancelados", value: metrics.cancelled, fill: STATUS_COLORS[1] });
    if (metrics.noShow > 0) items.push({ name: "Não compareceu", value: metrics.noShow, fill: STATUS_COLORS[2] });
    if (metrics.scheduled > 0) items.push({ name: "Agendados", value: metrics.scheduled, fill: STATUS_COLORS[3] });
    return items;
  }, [metrics]);

  // ── Top services ──────────────────────────────────

  const topServices = useMemo<ServiceData[]>(() => {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const a of appointments.filter((a) => a.status === "completed" && a.service)) {
      const name = a.service!.name;
      const prev = map.get(name) || { count: 0, revenue: 0 };
      map.set(name, { count: prev.count + 1, revenue: prev.revenue + a.service!.price });
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [appointments]);

  // ── Render ────────────────────────────────────────

  const monthLabel = `${MONTH_NAMES[selectedMonth.month]} ${selectedMonth.year}`;
  const isCurrentMonth =
    selectedMonth.year === new Date().getFullYear() &&
    selectedMonth.month === new Date().getMonth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard" search={{}}>
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-bold text-foreground truncate">
              Relatórios
            </h1>
            <p className="text-xs text-muted-foreground">{barbershop?.name}</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Month selector */}
        <div className="flex items-center justify-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-display text-lg font-semibold text-foreground min-w-[200px] text-center">
            {monthLabel}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => shiftMonth(1)}
            disabled={isCurrentMonth}
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
            <Skeleton className="col-span-2 md:col-span-4 h-64 rounded-xl" />
          </div>
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard
                icon={Calendar}
                label="Total"
                value={String(metrics.total)}
                accent={false}
              />
              <MetricCard
                icon={DollarSign}
                label="Receita"
                value={`R$ ${metrics.revenue.toFixed(0)}`}
                accent
              />
              <MetricCard
                icon={TrendingUp}
                label="Ticket Médio"
                value={`R$ ${metrics.avgTicket.toFixed(0)}`}
                accent={false}
              />
              <MetricCard
                icon={Users}
                label="Concluídos"
                value={`${metrics.completed}/${metrics.total}`}
                accent={false}
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Daily appointments bar chart */}
              <Card className="bg-card border-border lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Agendamentos por Dia
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {metrics.total === 0 ? (
                    <EmptyChart message="Nenhum agendamento neste mês." />
                  ) : (
                    <ChartContainer config={barChartConfig} className="h-[250px] w-full">
                      <BarChart data={dailyData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="oklch(0.28 0.02 260)"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }}
                          tickLine={false}
                          axisLine={false}
                          interval={Math.max(0, Math.floor(dailyData.length / 10))}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }}
                          tickLine={false}
                          axisLine={false}
                          allowDecimals={false}
                        />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar
                          dataKey="agendamentos"
                          fill="var(--chart-1)"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={24}
                        />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              {/* Status pie */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 flex flex-col items-center">
                  {statusData.length === 0 ? (
                    <EmptyChart message="Sem dados." />
                  ) : (
                    <>
                      <ChartContainer config={statusChartConfig} className="h-[180px] w-full">
                        <PieChart>
                          <Pie
                            data={statusData}
                            cx="50%"
                            cy="50%"
                            innerRadius={45}
                            outerRadius={70}
                            paddingAngle={3}
                            dataKey="value"
                            nameKey="name"
                            strokeWidth={0}
                          >
                            {statusData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.fill} />
                            ))}
                          </Pie>
                          <ChartTooltip content={<ChartTooltipContent />} />
                        </PieChart>
                      </ChartContainer>
                      <div className="flex flex-wrap gap-3 justify-center mt-2">
                        {statusData.map((s) => (
                          <div key={s.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span
                              className="w-2.5 h-2.5 rounded-full inline-block"
                              style={{ backgroundColor: s.fill }}
                            />
                            {s.name} ({s.value})
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Revenue area chart */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Receita Diária (R$)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {metrics.revenue === 0 ? (
                  <EmptyChart message="Nenhuma receita neste mês." />
                ) : (
                  <ChartContainer config={barChartConfig} className="h-[200px] w-full">
                    <AreaChart data={dailyData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="oklch(0.75 0.1 75)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="oklch(0.75 0.1 75)" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="oklch(0.28 0.02 260)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }}
                        tickLine={false}
                        axisLine={false}
                        interval={Math.max(0, Math.floor(dailyData.length / 10))}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: "oklch(0.6 0.03 260)" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area
                        dataKey="receita"
                        stroke="oklch(0.75 0.1 75)"
                        strokeWidth={2}
                        fill="url(#goldGradient)"
                        type="monotone"
                      />
                    </AreaChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            {/* Top services */}
            {topServices.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Serviços Mais Rentáveis
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-3">
                  {topServices.map((s, i) => {
                    const maxRevenue = topServices[0].revenue;
                    const pct = maxRevenue > 0 ? (s.revenue / maxRevenue) * 100 : 0;
                    return (
                      <div key={s.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Scissors className="w-3.5 h-3.5 text-primary" />
                            <span className="font-medium text-foreground truncate max-w-[200px]">
                              {s.name}
                            </span>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <span className="text-foreground font-semibold">
                              R$ {s.revenue.toFixed(0)}
                            </span>
                            {" · "}
                            {s.count}x
                          </div>
                        </div>
                        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Calendar;
  label: string;
  value: string;
  accent: boolean;
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
      </CardContent>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
      {message}
    </div>
  );
}
