import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PlanCard } from "@/components/PlanCard";
import { NotificationBell } from "@/components/NotificationBell";
import { InstallAppButton } from "@/components/InstallAppButton";
import { EnableNotificationsButton } from "@/components/EnableNotificationsButton";
import { TeamManager } from "@/components/TeamManager";
import { BarbershopSettings } from "@/components/BarbershopSettings";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { WeeklyScheduleEditor } from "@/components/WeeklyScheduleEditor";
import { ScheduleBlocks } from "@/components/ScheduleBlocks";
import { ManualAppointmentDialog } from "@/components/ManualAppointmentDialog";
import { RescheduleDialog, type RescheduleTarget } from "@/components/RescheduleDialog";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  DragOverlay,
} from "@dnd-kit/core";
import {
  Scissors,
  LogOut,
  Calendar as CalendarIcon,
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
  Package,
  ImagePlus,
  X,
  MessageCircle,
  GripVertical,
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { QRCodeSVG } from "qrcode.react";
import { fetchBarberDisplayNames } from "@/lib/barber-names";
import { displayBRPhone, whatsappUrl } from "@/lib/phone";

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
  service_id: string;
  service: { name: string; price: number; duration_minutes: number } | null;
  client_profile: { full_name: string | null; phone: string | null } | null;
  barber_profile: { full_name: string | null; avatar_url: string | null } | null;
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

type AdminTab = "overview" | "services" | "products" | "team" | "schedule" | "settings";

const TABS: { id: AdminTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Visão Geral", icon: LayoutDashboard },
  { id: "services", label: "Serviços", icon: Wrench },
  { id: "products", label: "Produtos", icon: Package },
  { id: "team", label: "Equipe", icon: UserCog },
  { id: "schedule", label: "Horários", icon: CalendarCog },
  { id: "settings", label: "Configurações", icon: Settings },
];

// ─── Main Component ──────────────────────────────────────

interface BarberDashboardProps {
  isAdmin?: boolean;
}

// ─── Drag-and-drop helpers (dnd-kit) ─────────────────────
// Wraps a Card so it becomes draggable AND keeps its onClick/keyboard
// activation behavior. Uses dnd-kit which works on touch devices, unlike
// the HTML5 drag API.
function DraggableCard({
  id,
  enabled,
  isDragging,
  onActivate,
  children,
}: {
  id: string;
  enabled: boolean;
  isDragging: boolean;
  onActivate: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id, disabled: !enabled });
  return (
    <Card
      ref={setNodeRef}
      {...(enabled ? attributes : {})}
      {...(enabled ? listeners : {})}
      className={`bg-card border-border overflow-hidden transition-all ${
        enabled ? "cursor-grab active:cursor-grabbing hover:border-primary/40 touch-none" : ""
      } ${isDragging ? "opacity-40 scale-[0.98]" : ""}`}
      onClick={() => {
        if (enabled) onActivate();
      }}
      role={enabled ? "button" : undefined}
      tabIndex={enabled ? 0 : undefined}
      onKeyDown={(e) => {
        if (enabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
      title={enabled ? "Arraste para reagendar · Clique para editar" : undefined}
    >
      {children}
    </Card>
  );
}

function DroppableList({
  isActive,
  children,
}: {
  isActive: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "appt-list-dropzone" });
  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 rounded-xl transition-colors ${
        isActive
          ? `ring-2 ring-offset-2 ring-offset-background bg-primary/5 p-2 ${
              isOver ? "ring-primary" : "ring-primary/40"
            }`
          : ""
      }`}
    >
      {children}
    </div>
  );
}

// Wraps the prev/next date chevrons so they accept a hovering drag and
// trigger a delayed day shift (handled by the parent's onDragOver timer).
function DateNavDroppable({
  id,
  isDragging,
  isPending,
  children,
}: {
  id: "date-prev" | "date-next";
  isDragging: boolean;
  isPending: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`relative rounded-md transition-all ${
        isDragging ? "ring-1 ring-primary/30" : ""
      } ${isOver ? "ring-2 ring-primary bg-primary/10 scale-110" : ""}`}
    >
      {children}
      {isPending && (
        <span
          className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-primary animate-pulse"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// Wraps the date title so it accepts a hovering drag — when active, the
// parent opens its calendar popover so the user can pick a target day.
function DateTitleDroppable({
  isDragging,
  children,
}: {
  isDragging: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "date-title" });
  return (
    <div
      ref={setNodeRef}
      className={`inline-block rounded-md -mx-2 px-2 transition-all ${
        isDragging ? "ring-1 ring-primary/30 cursor-pointer" : ""
      } ${isOver ? "ring-2 ring-primary bg-primary/10" : ""}`}
    >
      {children}
    </div>
  );
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
            {barbershop?.subdomain && barbershop.subdomain !== "_system" && (
              <>
                <a
                  href={`/agendar/${barbershop.subdomain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ver minha página pública"
                >
                  <Button variant="ghost" size="sm">
                    <Globe className="w-4 h-4" />
                    <span className="hidden md:inline">Ver página pública</span>
                  </Button>
                </a>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Copiar link público"
                  onClick={async () => {
                    const url = `${window.location.origin}/agendar/${barbershop.subdomain}`;
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success("Link copiado!", { description: url });
                    } catch {
                      toast.error("Não foi possível copiar o link");
                    }
                  }}
                >
                  <Copy className="w-4 h-4" />
                  <span className="hidden md:inline">Copiar link</span>
                </Button>
              </>
            )}
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
        {activeTab === "products" && <ProductsTab />}
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
  const [showNewAppt, setShowNewAppt] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appointment | null>(null);
  const [reschedTarget, setReschedTarget] = useState<RescheduleTarget | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showDragHint, setShowDragHint] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("barbaflow:drag-hint-dismissed") !== "1";
  });
  const dismissDragHint = useCallback(() => {
    setShowDragHint(false);
    try {
      localStorage.setItem("barbaflow:drag-hint-dismissed", "1");
    } catch {
      /* ignore quota errors */
    }
  }, []);

  // Drag-to-navigate-day: when the user hovers a card over the prev/next
  // chevrons for ~1 second, the day shifts. The timer resets if they move off,
  // and re-arms while still hovering so they can advance multiple days.
  const [pendingDateNav, setPendingDateNav] = useState<"date-prev" | "date-next" | null>(null);
  const dateNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDateNavTimer = useCallback(() => {
    if (dateNavTimerRef.current) {
      clearTimeout(dateNavTimerRef.current);
      dateNavTimerRef.current = null;
    }
    setPendingDateNav(null);
  }, []);
  useEffect(() => () => clearDateNavTimer(), [clearDateNavTimer]);

  // Calendar popover for picking a target date during a drag (or by clicking
  // the date title normally). When a card is dragged over the title, the
  // popover opens immediately and the dragged appointment id is stashed so
  // the chosen date can be wired into the Reschedule dialog.
  const [dateCalendarOpen, setDateCalendarOpen] = useState(false);
  const dragForCalendarRef = useRef<string | null>(null);

  // Per-day appointment counts for the calendar popover (current visible month).
  // Re-fetched whenever the popover opens, the visible month changes, the
  // tenant changes, or the admin barber filter changes. Keyed by YYYY-MM-DD.
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!dateCalendarOpen || !barbershopId) return;
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    const start = `${y}-${(m + 1).toString().padStart(2, "0")}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${(m + 1).toString().padStart(2, "0")}-${lastDay
      .toString()
      .padStart(2, "0")}`;
    let cancelled = false;
    (async () => {
      let q = supabase
        .from("appointments")
        .select("date, barber_id, status")
        .eq("barbershop_id", barbershopId)
        .gte("date", start)
        .lte("date", end)
        .neq("status", "cancelled");
      if (isAdmin && selectedBarber !== "all") {
        q = q.eq("barber_id", selectedBarber);
      } else if (!isAdmin && user) {
        q = q.eq("barber_id", user.id);
      }
      const { data } = await q;
      if (cancelled) return;
      const counts: Record<string, number> = {};
      (data ?? []).forEach((row) => {
        counts[row.date] = (counts[row.date] ?? 0) + 1;
      });
      setDayCounts(counts);
    })();
    return () => {
      cancelled = true;
    };
  }, [dateCalendarOpen, calendarMonth, barbershopId, isAdmin, selectedBarber, user]);

  // dnd-kit sensors: pointer (mouse) + touch (mobile) + keyboard.
  // PointerSensor with distance:8 prevents accidental drag on simple click.
  // TouchSensor with delay:200 lets vertical scroll work normally on mobile;
  // a long-press starts the drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // Fetch barbers: admin sees all, barber sees only themselves (used for the
  // "Novo agendamento" dialog and the admin filter dropdown).
  useEffect(() => {
    if (!barbershopId) return;
    (async () => {
      if (isAdmin) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("barbershop_id", barbershopId)
          .in("role", ["barbeiro", "admin_barbearia"]);
        if (!roles || roles.length === 0) return;
        const ids = [...new Set(roles.map((r) => r.user_id))];
        const namesMap = await fetchBarberDisplayNames(ids);
        setBarbers(
          ids.map((id) => ({
            id,
            name: namesMap[id]?.display_name || "Sem nome",
          }))
        );
      } else if (user) {
        const namesMap = await fetchBarberDisplayNames([user.id]);
        setBarbers([{ id: user.id, name: namesMap[user.id]?.display_name || "Você" }]);
      }
    })();
  }, [isAdmin, barbershopId, user]);

  const fetchAppointments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    let query = supabase
      .from("appointments")
      .select("id, date, start_time, end_time, status, notes, client_id, barber_id, service_id, service:services(name, price, duration_minutes)")
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

      // Clients: profiles table (name) + RPC for phone (RLS-safe)
      let clientMap: Record<string, { full_name: string | null; phone: string | null }> = {};
      if (clientIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", clientIds);
        if (profiles) {
          clientMap = Object.fromEntries(
            profiles.map((p) => [p.user_id, { full_name: p.full_name, phone: null as string | null }])
          );
        }
        // Phone via SECURITY DEFINER (only returns if caller is barbeiro/admin of a barbershop the client booked at)
        const phoneResults = await Promise.all(
          clientIds.map(async (cid) => {
            const { data } = await supabase.rpc("get_client_phone", { _client_id: cid });
            return [cid, (data as string | null) ?? null] as const;
          })
        );
        for (const [cid, phone] of phoneResults) {
          clientMap[cid] = { ...(clientMap[cid] || { full_name: null, phone: null }), phone };
        }
      }

      // Barbers: standardized RPC
      const barberMap = await fetchBarberDisplayNames(barberIds);

      setAppointments(
        (data || []).map((a) => ({
          ...a,
          service: Array.isArray(a.service) ? a.service[0] || null : a.service,
          client_profile: clientMap[a.client_id] || null,
          barber_profile: barberMap[a.barber_id]
            ? {
                full_name: barberMap[a.barber_id].display_name,
                avatar_url: barberMap[a.barber_id].avatar_url,
              }
            : null,
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
    <DndContext
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => {
        setDraggingId(String(e.active.id));
        dismissDragHint();
      }}
      onDragOver={(e: DragOverEvent) => {
        const overId = e.over?.id;
        if (overId === "date-title") {
          // Instantly open the calendar picker and stash the dragged appt.
          dragForCalendarRef.current = String(e.active.id);
          if (!dateCalendarOpen) setDateCalendarOpen(true);
          clearDateNavTimer();
          return;
        }
        if (overId === "date-prev" || overId === "date-next") {
          if (pendingDateNav === overId) return;
          // Switched zones (or first hover): restart the timer.
          if (dateNavTimerRef.current) clearTimeout(dateNavTimerRef.current);
          setPendingDateNav(overId);
          const draggedId = String(e.active.id);
          dateNavTimerRef.current = setTimeout(() => {
            const dir = overId === "date-prev" ? -1 : 1;
            // Compute the new day from the *current* selectedDate at fire time.
            const apt = appointments.find((a) => a.id === draggedId);
            const baseDate = new Date(selectedDate + "T12:00:00");
            baseDate.setDate(baseDate.getDate() + dir);
            const newDate = baseDate.toISOString().split("T")[0];
            shiftDate(dir);
            // Also open the reschedule dialog targeted at the new day.
            // dnd-kit will end the drag automatically when the source card
            // unmounts on the day-change re-render.
            if (apt && barbershopId && apt.service) {
              setReschedTarget({
                id: apt.id,
                date: newDate,
                start_time: apt.start_time,
                barber_id: apt.barber_id,
                barbershop_id: barbershopId,
                duration_minutes: apt.service.duration_minutes,
                client_name: apt.client_profile?.full_name ?? null,
                service_name: apt.service.name,
                original_date: apt.date,
              });
            }
            dateNavTimerRef.current = null;
            setPendingDateNav(null);
          }, 1000);
        } else {
          clearDateNavTimer();
        }
      }}
      onDragEnd={(e: DragEndEvent) => {
        const id = String(e.active.id);
        setDraggingId(null);
        clearDateNavTimer();
        // Drops on the date-nav zones don't reschedule — they only navigate.
        if (!e.over || e.over.id !== "appt-list-dropzone") return;
        const apt = appointments.find((a) => a.id === id);
        if (!apt || !barbershopId || !apt.service) return;
        setReschedTarget({
          id: apt.id,
          date: apt.date,
          start_time: apt.start_time,
          barber_id: apt.barber_id,
          barbershop_id: barbershopId,
          duration_minutes: apt.service.duration_minutes,
          client_name: apt.client_profile?.full_name ?? null,
          service_name: apt.service.name,
        });
      }}
      onDragCancel={() => {
        setDraggingId(null);
        clearDateNavTimer();
      }}
    >
    <div className="space-y-6">
      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <Popover
          open={dateCalendarOpen}
          onOpenChange={(o) => {
            setDateCalendarOpen(o);
            if (!o) dragForCalendarRef.current = null;
          }}
        >
          <DateTitleDroppable isDragging={!!draggingId}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-left rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Escolher data"
              >
                <h2 className="text-xl md:text-2xl font-display font-bold text-foreground inline-flex items-center gap-2">
                  {isToday ? "Hoje" : formatDateFull(selectedDate)}
                  <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                </h2>
                {isToday && (
                  <p className="text-sm text-muted-foreground">{formatDateFull(selectedDate)}</p>
                )}
              </button>
            </PopoverTrigger>
          </DateTitleDroppable>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={new Date(selectedDate + "T12:00:00")}
              onSelect={(d) => {
                if (!d) return;
                const y = d.getFullYear();
                const m = (d.getMonth() + 1).toString().padStart(2, "0");
                const day = d.getDate().toString().padStart(2, "0");
                const newDate = `${y}-${m}-${day}`;
                // If a card was being dragged when this opened, route the
                // chosen day into the Reschedule dialog. Otherwise just
                // navigate to the picked day.
                const draggedId = dragForCalendarRef.current;
                dragForCalendarRef.current = null;
                setDateCalendarOpen(false);
                if (draggedId) {
                  const apt = appointments.find((a) => a.id === draggedId);
                  setSelectedDate(newDate);
                  if (apt && barbershopId && apt.service) {
                    setReschedTarget({
                      id: apt.id,
                      date: newDate,
                      start_time: apt.start_time,
                      barber_id: apt.barber_id,
                      barbershop_id: barbershopId,
                      duration_minutes: apt.service.duration_minutes,
                      client_name: apt.client_profile?.full_name ?? null,
                      service_name: apt.service.name,
                      original_date: apt.date,
                    });
                  }
                } else {
                  setSelectedDate(newDate);
                }
              }}
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              initialFocus
              className="p-3 pointer-events-auto"
              components={{
                DayButton: (dayProps) => {
                  const d = dayProps.day.date;
                  const key = `${d.getFullYear()}-${(d.getMonth() + 1)
                    .toString()
                    .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
                  const count = dayCounts[key] ?? 0;
                  return (
                    <div className="relative w-full h-full">
                      <CalendarDayButton {...dayProps} />
                      {count > 0 && (
                        <span
                          className={cn(
                            "pointer-events-none absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full text-[9px] font-semibold leading-[14px] text-center shadow-sm",
                            count >= 8
                              ? "bg-destructive text-destructive-foreground ring-1 ring-destructive/40 animate-pulse"
                              : count >= 5
                                ? "bg-amber-500 text-white"
                                : "bg-primary text-primary-foreground"
                          )}
                          aria-label={`${count} agendamento${count > 1 ? "s" : ""}${
                            count >= 8 ? " — dia lotado" : count >= 5 ? " — dia cheio" : ""
                          }`}
                        >
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </div>
                  );
                },
              }}
            />
            <div className="border-t border-border px-3 py-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                Normal
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                Cheio
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-destructive" />
                Lotado
              </span>
            </div>
          </PopoverContent>
        </Popover>
        <div className="flex items-center gap-1">
          <DateNavDroppable
            id="date-prev"
            isDragging={!!draggingId}
            isPending={pendingDateNav === "date-prev"}
          >
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </DateNavDroppable>
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
          <DateNavDroppable
            id="date-next"
            isDragging={!!draggingId}
            isPending={pendingDateNav === "date-next"}
          >
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftDate(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </DateNavDroppable>
          <Button
            size="sm"
            className="ml-2"
            onClick={() => setShowNewAppt(true)}
            disabled={barbers.length === 0}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Novo agendamento</span>
          </Button>
        </div>
      </div>

      {barbershopId && (
        <ManualAppointmentDialog
          open={showNewAppt || !!editingAppt}
          onOpenChange={(o) => {
            if (!o) {
              setShowNewAppt(false);
              setEditingAppt(null);
            } else {
              setShowNewAppt(true);
            }
          }}
          barbershopId={barbershopId}
          barbers={barbers}
          defaultDate={selectedDate}
          editAppointment={
            editingAppt
              ? {
                  id: editingAppt.id,
                  date: editingAppt.date,
                  start_time: editingAppt.start_time,
                  barber_id: editingAppt.barber_id,
                  service_id: editingAppt.service_id,
                  client_id: editingAppt.client_id,
                  client_full_name: editingAppt.client_profile?.full_name ?? null,
                  client_phone: editingAppt.client_profile?.phone ?? null,
                  client_avatar_url: null,
                  notes: editingAppt.notes,
                }
              : null
          }
          onCreated={() => {
            fetchAppointments();
            fetchWeekMetrics();
          }}
        />
      )}

      <RescheduleDialog
        open={!!reschedTarget}
        onOpenChange={(o) => {
          if (!o) setReschedTarget(null);
        }}
        appointment={reschedTarget}
        onDateChange={(newDate) => {
          // User picked another day from the "all full" warning calendar.
          // Update both the dialog target and the dashboard's selected day
          // so the underlying agenda follows along.
          setReschedTarget((prev) =>
            prev ? { ...prev, date: newDate } : prev
          );
          setSelectedDate(newDate);
        }}
        onRescheduled={() => {
          fetchAppointments();
          fetchWeekMetrics();
        }}
      />

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
                  barbaflow.pro/agendar/{barbershop.subdomain}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const url = `https://barbaflow.pro/agendar/${barbershop.subdomain}`;
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
                <a href={`https://barbaflow.pro/agendar/${barbershop.subdomain}`} target="_blank" rel="noopener noreferrer">
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
              <CalendarIcon className="w-4 h-4 text-primary" />
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
                <CalendarIcon className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                Nenhum agendamento para este dia.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <DroppableList isActive={!!draggingId}>
              {draggingId && (
                <div className="text-xs text-center text-primary font-medium py-1">
                  Solte para escolher o novo horário
                </div>
              )}
              {(() => {
                const firstScheduledId = appointments.find((a) => a.status === "scheduled")?.id;
                return appointments.map((apt) => {
                  const statusCfg = STATUS_CONFIG[apt.status] || STATUS_CONFIG.scheduled;
                  const StatusIcon = statusCfg.icon;
                  const isScheduled = apt.status === "scheduled";
                  const isDragging = draggingId === apt.id;
                  const showHintHere =
                    showDragHint && !draggingId && isScheduled && apt.id === firstScheduledId;

                  return (
                    <div key={apt.id} className="space-y-2">
                      {showHintHere && (
                        <div
                          className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary animate-in fade-in slide-in-from-top-1"
                          role="status"
                        >
                          <GripVertical className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                          <span className="flex-1">
                            Dica: arraste o card para reagendar para outro horário
                          </span>
                          <button
                            type="button"
                            onClick={dismissDragHint}
                            className="flex-shrink-0 rounded p-0.5 text-primary/70 hover:text-primary hover:bg-primary/10 transition-colors"
                            aria-label="Dispensar dica"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      <DraggableCard
                        id={apt.id}
                        enabled={isScheduled}
                        isDragging={isDragging}
                        onActivate={() => setEditingAppt(apt)}
                      >
                    <CardContent className="p-0">
                      <div className="flex">
                        <div className="relative flex flex-col items-center justify-center px-4 py-3 bg-secondary/50 min-w-[72px]">
                          {isScheduled && (
                            <GripVertical
                              className="absolute left-0.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60"
                              aria-hidden="true"
                            />
                          )}
                          <span className="text-lg font-display font-bold text-foreground">
                            {apt.start_time.slice(0, 5)}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {apt.end_time.slice(0, 5)}
                          </span>
                        </div>
                        <div className="flex-1 p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                          <div className="flex-1 min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Users className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <span className="text-sm font-medium text-foreground truncate">
                                {apt.client_profile?.full_name || "Cliente"}
                              </span>
                              {apt.client_profile?.phone && (
                                <a
                                  href={whatsappUrl(apt.client_profile.phone) || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 text-[11px] text-green-500 hover:text-green-400 hover:underline"
                                  title={`Chamar no WhatsApp: ${displayBRPhone(apt.client_profile.phone)}`}
                                >
                                  <MessageCircle className="w-3 h-3" />
                                  {displayBRPhone(apt.client_profile.phone)}
                                </a>
                              )}
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
                                <div className="flex items-center gap-1.5">
                                  <Avatar className="w-4 h-4">
                                    <AvatarImage
                                      src={apt.barber_profile.avatar_url || undefined}
                                      alt={apt.barber_profile.full_name || "Barbeiro"}
                                    />
                                    <AvatarFallback className="text-[8px] bg-primary/10 text-primary">
                                      {(apt.barber_profile.full_name || "B").charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-[10px] text-muted-foreground truncate">
                                    {apt.barber_profile.full_name}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          {isScheduled && (
                            <div
                              className="flex gap-1.5 flex-shrink-0"
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-green-500 hover:text-green-400 hover:bg-green-500/10 text-xs h-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStatusChange(apt.id, "completed");
                                }}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                Concluir
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:bg-destructive/10 text-xs h-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleStatusChange(apt.id, "no_show");
                                }}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Faltou
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </DraggableCard>
                    </div>
                  );
                });
              })()}
            </DroppableList>
            <DragOverlay dropAnimation={null}>
              {draggingId ? (
                <div className="rounded-xl border border-primary bg-card shadow-2xl px-4 py-3 text-sm font-medium text-foreground opacity-95">
                  {appointments.find((a) => a.id === draggingId)?.client_profile?.full_name ||
                    "Reagendando..."}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {appointments.find((a) => a.id === draggingId)?.start_time.slice(0, 5)}
                  </span>
                </div>
              ) : null}
            </DragOverlay>
          </>
        )}
      </div>
    </div>
    </DndContext>
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
// ─── Products Tab ────────────────────────────────────────

function ProductsTab() {
  const { user } = useAuth();
  const { barbershopId } = useBarbershop();
  const [products, setProducts] = useState<{ id: string; name: string; description: string | null; price: number; stock_quantity: number; active: boolean; image_url: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newStock, setNewStock] = useState("0");
  const [newImageFile, setNewImageFile] = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editStock, setEditStock] = useState("");
  const [editImageFile, setEditImageFile] = useState<File | null>(null);
  const [editImagePreview, setEditImagePreview] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .order("name");
    setProducts(data || []);
    setLoading(false);
  }, [barbershopId]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const uploadImage = async (file: File, productId: string): Promise<string | null> => {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${barbershopId}/${productId}.${ext}`;
    const { error } = await supabase.storage.from("product-images").upload(path, file, { upsert: true });
    if (error) {
      toast.error("Erro ao enviar imagem.");
      return null;
    }
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    return urlData.publicUrl + "?t=" + Date.now();
  };

  const handleImageSelect = (file: File | null, setFile: (f: File | null) => void, setPreview: (s: string | null) => void) => {
    if (!file) { setFile(null); setPreview(null); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem deve ter no máximo 5MB."); return; }
    setFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newPrice || !user) return;
    setSaving(true);
    const { data: inserted, error } = await supabase.from("products").insert({
      barbershop_id: barbershopId,
      name: newName.trim(),
      description: newDescription.trim() || null,
      price: parseFloat(newPrice),
      stock_quantity: parseInt(newStock) || 0,
    }).select("id").single();
    if (error) {
      setSaving(false);
      toast.error("Erro ao adicionar produto.");
      return;
    }
    if (newImageFile && inserted) {
      const imageUrl = await uploadImage(newImageFile, inserted.id);
      if (imageUrl) {
        await supabase.from("products").update({ image_url: imageUrl }).eq("id", inserted.id);
      }
    }
    setSaving(false);
    toast.success("Produto adicionado!");
    setNewName(""); setNewDescription(""); setNewPrice(""); setNewStock("0");
    setNewImageFile(null); setNewImagePreview(null);
    setShowAdd(false);
    fetchProducts();
  };

  const openEdit = (p: typeof products[0]) => {
    setEditingProduct(p.id);
    setEditName(p.name);
    setEditDescription(p.description || "");
    setEditPrice(String(p.price));
    setEditStock(String(p.stock_quantity));
    setEditImageFile(null);
    setEditImagePreview(p.image_url || null);
  };

  const handleEdit = async () => {
    if (!editingProduct || !editName.trim() || !editPrice) return;
    setEditSaving(true);
    const updateData: {
      name: string;
      description: string | null;
      price: number;
      stock_quantity: number;
      image_url?: string;
    } = {
      name: editName.trim(),
      description: editDescription.trim() || null,
      price: parseFloat(editPrice),
      stock_quantity: parseInt(editStock) || 0,
    };
    if (editImageFile) {
      const imageUrl = await uploadImage(editImageFile, editingProduct);
      if (imageUrl) updateData.image_url = imageUrl;
    }
    await supabase.from("products").update(updateData).eq("id", editingProduct);
    setEditSaving(false);
    setEditingProduct(null);
    setEditImageFile(null); setEditImagePreview(null);
    toast.success("Produto atualizado!");
    fetchProducts();
  };

  const removeImage = async (productId: string) => {
    await supabase.from("products").update({ image_url: null }).eq("id", productId);
    toast.success("Imagem removida.");
    fetchProducts();
  };

  const toggleActive = async (id: string, currentActive: boolean) => {
    await supabase.from("products").update({ active: !currentActive }).eq("id", id);
    fetchProducts();
    toast.success(currentActive ? "Produto desativado." : "Produto ativado!");
  };

  const deleteProduct = async (id: string) => {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) {
      toast.error("Erro ao excluir produto.");
    } else {
      toast.success("Produto excluído!");
      fetchProducts();
    }
  };

  const ImageUploadField = ({ preview, onSelect, onClear }: { preview: string | null; onSelect: (f: File) => void; onClear: () => void }) => (
    <div>
      <Label>Imagem do produto</Label>
      {preview ? (
        <div className="relative mt-1 w-24 h-24">
          <img src={preview} alt="Preview" className="w-24 h-24 rounded-lg object-cover border border-border" />
          <button
            type="button"
            onClick={onClear}
            className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <label className="mt-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border cursor-pointer hover:border-primary/50 transition-colors">
          <ImagePlus className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Selecionar imagem</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onSelect(file);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Produtos</h2>
          <p className="text-sm text-muted-foreground">Gerencie os produtos vendidos na barbearia.</p>
        </div>
        <Dialog open={showAdd} onOpenChange={(open) => { setShowAdd(open); if (!open) { setNewImageFile(null); setNewImagePreview(null); } }}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Novo Produto
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Produto</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <ImageUploadField
                preview={newImagePreview}
                onSelect={(f) => handleImageSelect(f, setNewImageFile, setNewImagePreview)}
                onClear={() => { setNewImageFile(null); setNewImagePreview(null); }}
              />
              <div>
                <Label>Nome</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Pomada modeladora" />
              </div>
              <div>
                <Label>Descrição (opcional)</Label>
                <Input value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="Breve descrição do produto" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Preço (R$)</Label>
                  <Input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <Label>Estoque</Label>
                  <Input type="number" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
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
      <Dialog open={!!editingProduct} onOpenChange={(open) => { if (!open) { setEditingProduct(null); setEditImageFile(null); setEditImagePreview(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Produto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <ImageUploadField
              preview={editImagePreview}
              onSelect={(f) => handleImageSelect(f, setEditImageFile, setEditImagePreview)}
              onClear={() => { setEditImageFile(null); setEditImagePreview(null); }}
            />
            <div>
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Preço (R$)</Label>
                <Input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
              </div>
              <div>
                <Label>Estoque</Label>
                <Input type="number" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
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
      ) : products.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Package className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum produto cadastrado ainda.</p>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" />
              Adicionar primeiro produto
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {products.map((prod) => (
            <Card key={prod.id} className={`bg-card border-border ${!prod.active ? "opacity-50" : ""}`}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {prod.image_url ? (
                    <img src={prod.image_url} alt={prod.name} className="w-12 h-12 rounded-lg object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">{prod.name}</p>
                      {!prod.active && (
                        <Badge variant="secondary" className="text-[10px]">Inativo</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      R$ {Number(prod.price).toFixed(2)} · Estoque: {prod.stock_quantity}
                    </p>
                    {prod.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{prod.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => openEdit(prod)}>
                    <Edit className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Editar</span>
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => toggleActive(prod.id, prod.active)}>
                    <span className="hidden sm:inline">{prod.active ? "Desativar" : "Ativar"}</span>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-8">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir produto</AlertDialogTitle>
                        <AlertDialogDescription>
                          Tem certeza que deseja excluir <strong>{prod.name}</strong>? Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deleteProduct(prod.id)}
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
        const bookingUrl = `https://barbaflow.pro/agendar/${barbershop.subdomain}`;
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
