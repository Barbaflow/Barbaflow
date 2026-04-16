import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanCard } from "@/components/PlanCard";
import { NotificationBell } from "@/components/NotificationBell";
import { InstallAppButton } from "@/components/InstallAppButton";
import { EnableNotificationsButton } from "@/components/EnableNotificationsButton";
import { TeamManager } from "@/components/TeamManager";
import { BarbershopSettings } from "@/components/BarbershopSettings";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { WeeklyScheduleEditor } from "@/components/WeeklyScheduleEditor";
import { ScheduleBlocks } from "@/components/ScheduleBlocks";
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
  LayoutDashboard,
  Wrench,
  UserCog,
  CalendarCog,
  BarChart3,
  Plus,
  Trash2,
  Edit,
  Globe,
  Copy,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { QRCodeSVG } from "qrcode.react";

// ─── Types ───────────────────────────────────────────────

interface Appointment {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  client_id: string;
  barber_id: string;
  service: { name: string; price: number; duration_minutes: number } | null;
  client_profile: { full_name: string | null } | null;
  barber_profile: { full_name: string | null } | null;
}

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
  barber_id: string;
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

type AdminTab = "overview" | "services" | "team" | "schedule" | "settings";

const TABS: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Visão Geral", icon: LayoutDashboard },
  { id: "services", label: "Serviços", icon: Wrench },
  { id: "team", label: "Equipe", icon: UserCog },
  { id: "schedule", label: "Horários", icon: CalendarCog },
  { id: "settings", label: "Configurações", icon: Settings },
];

// ─── Main Component ──────────────────────────────────────

interface BarberDashboardProps {
  isAdmin?: boolean;
}

export function BarberDashboard({ isAdmin = false }: BarberDashboardProps) {
  const { user, signOut } = useAuth();
  const { barbershopId, barbershop } = useBarbershop();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const name = barbershop?.name || "BarbaFlow";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
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
              <p className="text-xs text-muted-foreground">
                {isAdmin ? "Administrador" : "Barbeiro"} · {user?.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/relatorios">
              <Button variant="ghost" size="sm">
                <BarChart3 className="w-4 h-4" />
                <span className="hidden sm:inline">Relatórios</span>
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

      {/* Tab navigation — only for admins */}
      {isAdmin && (
        <nav className="border-b border-border bg-card/50 overflow-x-auto">
          <div className="max-w-6xl mx-auto flex px-4 md:px-8">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8">
        {activeTab === "overview" && <OverviewTab isAdmin={isAdmin} />}
        {activeTab === "services" && <ServicesTab />}
        {activeTab === "team" && <TeamTab />}
        {activeTab === "schedule" && <ScheduleTab />}
        {activeTab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}

// ─── Overview Tab ────────────────────────────────────────

function OverviewTab({ isAdmin }: { isAdmin: boolean }) {
  const { user } = useAuth();
  const { barbershopId, barbershop } = useBarbershop();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [weekMetrics, setWeekMetrics] = useState({ totalWeek: 0, revenueWeek: 0 });
  const [selectedBarber, setSelectedBarber] = useState<string>("all");
  const [barbers, setBarbers] = useState<{ id: string; name: string }[]>([]);

  // Fetch barbers for admin filter
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("barbershop_id", barbershopId)
        .in("role", ["barbeiro", "admin_barbearia"]);
      if (!roles || roles.length === 0) return;
      const ids = roles.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ids);
      if (profiles) {
        setBarbers(profiles.map((p) => ({ id: p.user_id, name: p.full_name || "Sem nome" })));
      }
    })();
  }, [isAdmin, barbershopId]);

  const fetchAppointments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    let query = supabase
      .from("appointments")
      .select("id, date, start_time, end_time, status, notes, client_id, barber_id, service:services(name, price, duration_minutes)")
      .eq("barbershop_id", barbershopId)
      .eq("date", selectedDate)
      .order("start_time", { ascending: true });

    if (!isAdmin) {
      query = query.eq("barber_id", user.id);
    } else if (selectedBarber !== "all") {
      query = query.eq("barber_id", selectedBarber);
    }

    const { data, error: err } = await query;

    if (err) {
      setError("Erro ao carregar agendamentos.");
    } else {
      const clientIds = [...new Set((data || []).map((a) => a.client_id))];
      const barberIds = [...new Set((data || []).map((a) => a.barber_id))];
      const allUserIds = [...new Set([...clientIds, ...barberIds])];

      let profilesMap: Record<string, { full_name: string | null }> = {};
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", allUserIds);
        if (profiles) {
          profilesMap = Object.fromEntries(profiles.map((p) => [p.user_id, { full_name: p.full_name }]));
        }
      }

      setAppointments(
        (data || []).map((a) => ({
          ...a,
          service: Array.isArray(a.service) ? a.service[0] || null : a.service,
          client_profile: profilesMap[a.client_id] || null,
          barber_profile: profilesMap[a.barber_id] || null,
        })) as Appointment[]
      );
    }
    setLoading(false);
  }, [user, barbershopId, selectedDate, isAdmin, selectedBarber]);

  const fetchWeekMetrics = useCallback(async () => {
    if (!user) return;
    const today = new Date(selectedDate + "T12:00:00");
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);

    let query = supabase
      .from("appointments")
      .select("status, service:services(price)")
      .eq("barbershop_id", barbershopId)
      .gte("date", weekStart.toISOString().split("T")[0])
      .lte("date", weekEnd.toISOString().split("T")[0]);

    if (!isAdmin) {
      query = query.eq("barber_id", user.id);
    } else if (selectedBarber !== "all") {
      query = query.eq("barber_id", selectedBarber);
    }

    const { data } = await query;
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
  }, [user, barbershopId, selectedDate, isAdmin, selectedBarber]);

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
    <div className="space-y-6">
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

      {/* Barber filter (admin only) */}
      {isAdmin && barbers.length > 0 && (
        <div className="flex items-center gap-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <Select value={selectedBarber} onValueChange={setSelectedBarber}>
            <SelectTrigger className="w-[220px] h-9">
              <SelectValue placeholder="Filtrar por barbeiro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os barbeiros</SelectItem>
              {barbers.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Subdomain link for admin */}
      {isAdmin && barbershop?.subdomain && (
        <Card className="bg-card border-primary/20">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Link de agendamento</p>
                <p className="text-xs text-muted-foreground truncate">
                  {barbershop.subdomain}.barbaflow.pro
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = `https://${barbershop.subdomain}.barbaflow.pro`;
                  navigator.clipboard.writeText(url);
                  toast.success("Link copiado!");
                }}
              >
                <Copy className="w-4 h-4" />
                Copiar link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                asChild
              >
                <a href={`https://${barbershop.subdomain}.barbaflow.pro`} target="_blank" rel="noopener noreferrer">
                  Abrir
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metrics */}
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
            <p className="text-2xl font-display font-bold text-foreground">R$ {metrics.revenue.toFixed(0)}</p>
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
            <p className="text-2xl font-display font-bold text-foreground">R$ {weekMetrics.revenueWeek.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">concluídos</p>
          </CardContent>
        </Card>
      </div>

      <PlanCard />

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Appointments list */}
      <div>
        <h3 className="font-display text-lg font-semibold text-foreground mb-3">
          {isAdmin
            ? selectedBarber !== "all"
              ? `Agendamentos de ${barbers.find((b) => b.id === selectedBarber)?.name || "barbeiro"}`
              : "Agendamentos da barbearia"
            : "Agendamentos do dia"}
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
                      <div className="flex flex-col items-center justify-center px-4 py-3 bg-secondary/50 min-w-[72px]">
                        <span className="text-lg font-display font-bold text-foreground">
                          {apt.start_time.slice(0, 5)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {apt.end_time.slice(0, 5)}
                        </span>
                      </div>
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
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <StatusIcon className={`w-3 h-3 ${statusCfg.color}`} />
                              <span className={`text-[10px] ${statusCfg.color}`}>{statusCfg.label}</span>
                            </div>
                            {isAdmin && apt.barber_profile && (
                              <span className="text-[10px] text-muted-foreground">
                                Barbeiro: {apt.barber_profile.full_name}
                              </span>
                            )}
                          </div>
                        </div>
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
    </div>
  );
}

// ─── Services Tab ────────────────────────────────────────

function ServicesTab() {
  const { user } = useAuth();
  const { barbershopId } = useBarbershop();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState("30");
  const [newPrice, setNewPrice] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editName, setEditName] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const openEdit = (svc: Service) => {
    setEditingService(svc);
    setEditName(svc.name);
    setEditDuration(String(svc.duration_minutes));
    setEditPrice(String(svc.price));
  };

  const handleEdit = async () => {
    if (!editingService || !editName.trim() || !editPrice) return;
    setEditSaving(true);
    const { error } = await supabase
      .from("services")
      .update({
        name: editName.trim(),
        duration_minutes: parseInt(editDuration),
        price: parseFloat(editPrice),
      })
      .eq("id", editingService.id);
    setEditSaving(false);
    if (error) {
      toast.error("Erro ao atualizar serviço.");
    } else {
      toast.success("Serviço atualizado!");
      setEditingService(null);
      fetchServices();
    }
  };

  const fetchServices = useCallback(async () => {
    const { data } = await supabase
      .from("services")
      .select("id, name, duration_minutes, price, active, barber_id")
      .eq("barbershop_id", barbershopId)
      .order("name");
    setServices(data || []);
    setLoading(false);
  }, [barbershopId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleAdd = async () => {
    if (!newName.trim() || !newPrice || !user) return;
    setSaving(true);
    const { error } = await supabase.from("services").insert({
      name: newName.trim(),
      duration_minutes: parseInt(newDuration),
      price: parseFloat(newPrice),
      barbershop_id: barbershopId,
      barber_id: user.id,
      active: true,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao adicionar serviço.");
    } else {
      toast.success("Serviço adicionado!");
      setNewName("");
      setNewPrice("");
      setShowAdd(false);
      fetchServices();
    }
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    await supabase.from("services").update({ active: !currentActive }).eq("id", id);
    fetchServices();
    toast.success(currentActive ? "Serviço desativado." : "Serviço ativado!");
  };

  const deleteService = async (id: string) => {
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir serviço.");
    } else {
      toast.success("Serviço excluído!");
      fetchServices();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Serviços</h2>
          <p className="text-sm text-muted-foreground">Gerencie os serviços oferecidos pela barbearia.</p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Novo Serviço
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Serviço</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Nome</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Corte masculino" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Duração (min)</Label>
                  <Input type="number" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} />
                </div>
                <div>
                  <Label>Preço (R$)</Label>
                  <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <Button onClick={handleAdd} disabled={saving || !newName.trim() || !newPrice} className="w-full">
                {saving ? "Salvando..." : "Adicionar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingService} onOpenChange={(open) => !open && setEditingService(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Serviço</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Duração (min)</Label>
                <Input type="number" value={editDuration} onChange={(e) => setEditDuration(e.target.value)} />
              </div>
              <div>
                <Label>Preço (R$)</Label>
                <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
              </div>
            </div>
            <Button onClick={handleEdit} disabled={editSaving || !editName.trim() || !editPrice} className="w-full">
              {editSaving ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : services.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Wrench className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado ainda.</p>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" />
              Adicionar primeiro serviço
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => (
            <Card key={svc.id} className={`bg-card border-border ${!svc.active ? "opacity-50" : ""}`}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground truncate">{svc.name}</p>
                    {!svc.active && (
                      <Badge variant="secondary" className="text-[10px]">Inativo</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {svc.duration_minutes} min · R$ {Number(svc.price).toFixed(2)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => openEdit(svc)}
                  >
                    <Edit className="w-3.5 h-3.5" />
                    Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => toggleActive(svc.id, svc.active)}
                  >
                    {svc.active ? "Desativar" : "Ativar"}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 h-8"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir serviço</AlertDialogTitle>
                        <AlertDialogDescription>
                          Tem certeza que deseja excluir <strong>{svc.name}</strong>? Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteService(svc.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
// ─── Team Tab ────────────────────────────────────────────

function TeamTab() {
  const { barbershopId } = useBarbershop();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground">Equipe</h2>
        <p className="text-sm text-muted-foreground">Gerencie barbeiros e administradores da sua barbearia.</p>
      </div>
      <TeamManager barbershopId={barbershopId} />
    </div>
  );
}

// ─── Schedule Tab ────────────────────────────────────────

function ScheduleTab() {
  const { barbershopId } = useBarbershop();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground">Horários de Funcionamento</h2>
        <p className="text-sm text-muted-foreground">Configure a agenda semanal e bloqueios de datas.</p>
      </div>
      <div className="space-y-6">
        <WeeklyScheduleEditor barbershopId={barbershopId} />
        <ScheduleBlocks barbershopId={barbershopId} />
      </div>
    </div>
  );
}

// ─── Settings Tab ────────────────────────────────────────

function SettingsTab() {
  const { barbershopId, barbershop } = useBarbershop();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-display font-bold text-foreground">Configurações</h2>
        <p className="text-sm text-muted-foreground">Personalize seu perfil e a identidade visual da barbearia.</p>
      </div>

      {/* Booking link */}
      {barbershop?.subdomain && (() => {
        const bookingUrl = `https://${barbershop.subdomain}.barbaflow.pro`;
        const handlePrintQR = () => {
          const printWindow = window.open("", "_blank");
          if (!printWindow) return;
          const qrEl = document.getElementById("qr-code-settings");
          if (!qrEl) return;
          const svgData = qrEl.outerHTML;
          printWindow.document.write(`
            <html><head><title>QR Code - ${barbershop.name}</title>
            <style>
              body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; font-family: Arial, sans-serif; }
              h1 { font-size: 24px; margin-bottom: 4px; }
              p { font-size: 14px; color: #666; margin-bottom: 24px; }
              .url { font-size: 12px; color: #999; margin-top: 16px; }
            </style></head><body>
            <h1>${barbershop.name}</h1>
            <p>Escaneie para agendar</p>
            ${svgData}
            <p class="url">${bookingUrl}</p>
            <script>window.onload=function(){window.print();}<\/script>
            </body></html>
          `);
          printWindow.document.close();
        };

        return (
          <Card className="bg-card border-primary/20">
            <CardContent className="space-y-4 py-5">
              <div className="flex items-center gap-2">
                <Globe className="w-5 h-5 text-primary" />
                <h3 className="text-sm font-display font-semibold text-foreground">Link de Agendamento</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Compartilhe este link ou imprima o QR Code para seus clientes agendarem online.
              </p>
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-background border border-border">
                <span className="text-sm text-foreground truncate flex-1">
                  {bookingUrl}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(bookingUrl);
                    toast.success("Link copiado!");
                  }}
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copiar
                </Button>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-4 pt-2">
                <div className="bg-white p-4 rounded-xl">
                  <QRCodeSVG
                    id="qr-code-settings"
                    value={bookingUrl}
                    size={180}
                    level="H"
                    includeMargin={false}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Escaneie para agendar</p>
                <Button variant="outline" size="sm" onClick={handlePrintQR}>
                  Imprimir QR Code
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <ProfilePhotoUpload />
      <BarbershopSettings barbershopId={barbershopId} />
    </div>
  );
}
