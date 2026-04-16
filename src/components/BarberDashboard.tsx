import { useState, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanCard } from "@/components/PlanCard";
import { NotificationBell } from "@/components/NotificationBell";
import { InstallAppButton } from "@/components/InstallAppButton";
import { EnableNotificationsButton } from "@/components/EnableNotificationsButton";
import {
  Scissors,
  LogOut,
  Calendar,
  Clock,
  Users,
  DollarSign,
  CheckCircle,
  XCircle,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Settings,
  TrendingUp,
} from "lucide-react";

interface Appointment {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  client_id: string;
  service: { name: string; price: number; duration_minutes: number } | null;
  client_profile: { full_name: string | null } | null;
}

interface DayMetrics {
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  scheduled: number;
  revenue: number;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; color: string }> = {
  scheduled: { label: "Agendado", icon: Clock, color: "text-primary" },
  completed: { label: "Concluído", icon: CheckCircle, color: "text-green-500" },
  cancelled: { label: "Cancelado", icon: XCircle, color: "text-destructive" },
  no_show: { label: "Não compareceu", icon: AlertCircle, color: "text-yellow-500" },
};

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatDateFull(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  const weekdays = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return `${weekdays[d.getDay()]}, ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
}

export function BarberDashboard() {
  const { user, signOut } = useAuth();
  const { barbershopId, barbershop } = useBarbershop();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [weekMetrics, setWeekMetrics] = useState<{ totalWeek: number; revenueWeek: number }>({
    totalWeek: 0,
    revenueWeek: 0,
  });

  const name = barbershop?.name || "BarbaFlow";

  const fetchAppointments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const { data, error: err } = await supabase
      .from("appointments")
      .select("id, date, start_time, end_time, status, notes, client_id, service:services(name, price, duration_minutes)")
      .eq("barbershop_id", barbershopId)
      .eq("barber_id", user.id)
      .eq("date", selectedDate)
      .order("start_time", { ascending: true });

    if (err) {
      setError("Erro ao carregar agendamentos.");
    } else {
      // Fetch client profiles separately
      const clientIds = [...new Set((data || []).map((a) => a.client_id))];
      let profilesMap: Record<string, { full_name: string | null }> = {};

      if (clientIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", clientIds);

        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map((p) => [p.user_id, { full_name: p.full_name }]));
        }
      }

      setAppointments(
        (data || []).map((a) => ({
          ...a,
          service: Array.isArray(a.service) ? a.service[0] || null : a.service,
          client_profile: profilesMap[a.client_id] || null,
        })) as Appointment[]
      );
    }
    setLoading(false);
  }, [user, barbershopId, selectedDate]);

  // Fetch week metrics
  const fetchWeekMetrics = useCallback(async () => {
    if (!user) return;

    const today = new Date(selectedDate + "T12:00:00");
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    const { data } = await supabase
      .from("appointments")
      .select("status, service:services(price)")
      .eq("barbershop_id", barbershopId)
      .eq("barber_id", user.id)
      .gte("date", weekStart.toISOString().split("T")[0])
      .lte("date", weekEnd.toISOString().split("T")[0]);

    if (data) {
      const totalWeek = data.length;
      const revenueWeek = data
        .filter((a) => a.status === "completed")
        .reduce((sum, a) => {
          const svc = Array.isArray(a.service) ? a.service[0] : a.service;
          return sum + (svc ? Number(svc.price) : 0);
        }, 0);
      setWeekMetrics({ totalWeek, revenueWeek });
    }
  }, [user, barbershopId, selectedDate]);

  useEffect(() => {
    fetchAppointments();
    fetchWeekMetrics();
  }, [fetchAppointments, fetchWeekMetrics]);

  const shiftDate = (dir: number) => {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + dir);
    setSelectedDate(d.toISOString().split("T")[0]);
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  // Day metrics
  const metrics: DayMetrics = appointments.reduce(
    (acc, a) => {
      acc.total++;
      if (a.status === "completed") {
        acc.completed++;
        acc.revenue += a.service ? Number(a.service.price) : 0;
      }
      if (a.status === "cancelled") acc.cancelled++;
      if (a.status === "no_show") acc.noShow++;
      if (a.status === "scheduled") acc.scheduled++;
      return acc;
    },
    { total: 0, completed: 0, cancelled: 0, noShow: 0, scheduled: 0, revenue: 0 } as DayMetrics
  );

  const handleStatusChange = async (id: string, newStatus: "completed" | "cancelled" | "no_show") => {
    await supabase.from("appointments").update({ status: newStatus }).eq("id", id);
    fetchAppointments();
    fetchWeekMetrics();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {barbershop?.logo_url ? (
              <img src={barbershop.logo_url} alt={name} className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="h-9 w-9 rounded-full bg-gradient-gold flex items-center justify-center">
                <Scissors className="w-4 h-4 text-primary-foreground" />
              </div>
            )}
            <div className="hidden sm:block">
              <h1 className="font-display text-lg text-foreground">{name}</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/agenda">
              <Button variant="ghost" size="sm">
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Agenda</span>
              </Button>
            </Link>
            <Link to="/relatorios">
              <Button variant="ghost" size="sm">
                <TrendingUp className="w-4 h-4" />
                <span className="hidden sm:inline">Relatórios</span>
              </Button>
            </Link>
            <Link to="/configuracoes">
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Config</span>
              </Button>
            </Link>
            <InstallAppButton />
            <EnableNotificationsButton />
            <NotificationBell />
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">
        {/* Date navigation */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">
              {isToday ? "Hoje" : formatDateFull(selectedDate)}
            </h2>
            {isToday && (
              <p className="text-sm text-muted-foreground">{formatDateFull(selectedDate)}</p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {!isToday && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
              >
                Hoje
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Metrics cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">Hoje</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">{metrics.total}</p>
              <p className="text-[10px] text-muted-foreground">{metrics.scheduled} pendente{metrics.scheduled !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Receita dia</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">
                R$ {metrics.revenue.toFixed(0)}
              </p>
              <p className="text-[10px] text-muted-foreground">{metrics.completed} concluído{metrics.completed !== 1 ? "s" : ""}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">Semana</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">{weekMetrics.totalWeek}</p>
              <p className="text-[10px] text-muted-foreground">agendamentos</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <DollarSign className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">Receita semana</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">
                R$ {weekMetrics.revenueWeek.toFixed(0)}
              </p>
              <p className="text-[10px] text-muted-foreground">concluídos</p>
            </CardContent>
          </Card>
        </div>

        {/* Plan usage card */}
        <PlanCard />

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Appointments list */}
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground mb-3">
            Agendamentos do dia
          </h3>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : appointments.length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground font-medium">
                  Nenhum agendamento para este dia.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {appointments.map((apt) => {
                const statusCfg = STATUS_CONFIG[apt.status] || STATUS_CONFIG.scheduled;
                const StatusIcon = statusCfg.icon;
                const isScheduled = apt.status === "scheduled";

                return (
                  <Card key={apt.id} className="bg-card border-border overflow-hidden">
                    <CardContent className="p-0">
                      <div className="flex">
                        {/* Time column */}
                        <div className="flex flex-col items-center justify-center px-4 py-3 bg-secondary/50 min-w-[72px]">
                          <span className="text-lg font-display font-bold text-foreground">
                            {apt.start_time.slice(0, 5)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {apt.end_time.slice(0, 5)}
                          </span>
                        </div>

                        {/* Details */}
                        <div className="flex-1 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm font-medium text-foreground truncate">
                                {apt.client_profile?.full_name || "Cliente"}
                              </span>
                            </div>
                            {apt.service && (
                              <div className="flex items-center gap-2">
                                <Scissors className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                <span className="text-xs text-muted-foreground truncate">
                                  {apt.service.name} — R$ {Number(apt.service.price).toFixed(2)}
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-1.5">
                              <StatusIcon className={`w-3 h-3 ${statusCfg.color}`} />
                              <span className={`text-[10px] ${statusCfg.color}`}>{statusCfg.label}</span>
                            </div>
                          </div>

                          {/* Actions for scheduled appointments */}
                          {isScheduled && (
                            <div className="flex gap-1.5 flex-shrink-0">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-500 hover:text-green-400 hover:bg-green-500/10 text-xs h-8"
                                onClick={() => handleStatusChange(apt.id, "completed")}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Concluir
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 text-xs h-8"
                                onClick={() => handleStatusChange(apt.id, "no_show")}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Faltou
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
