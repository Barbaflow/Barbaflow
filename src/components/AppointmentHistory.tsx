import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Clock, Scissors, AlertCircle, History, X, User, Star, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { notifyBookingCancelled, getAppointmentNotificationData } from "@/lib/notifications";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { ReviewDialog } from "./ReviewDialog";
import { fetchBarberDisplayNames } from "@/lib/barber-names";
import { displayBRPhone } from "@/lib/phone";
import { Link } from "@tanstack/react-router";

interface Appointment {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  notes: string | null;
  created_at: string;
  barber_id: string;
  barbershop_id: string;
  barbershop: { name: string | null } | null;
  service: { name: string; price: number; duration_minutes: number } | null;
  barber_profile: { full_name: string | null; avatar_url: string | null } | null;
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  scheduled: { label: "Agendado", variant: "default" },
  completed: { label: "Concluído", variant: "secondary" },
  cancelled: { label: "Cancelado", variant: "destructive" },
  no_show: { label: "Não compareceu", variant: "outline" },
};

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatDateBR(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getDate()} de ${MONTH_NAMES[d.getMonth()]}`;
}

function formatWeekday(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { weekday: "short" });
}

interface AppointmentHistoryProps {
  /** When provided, filters to a single barbershop. Omit to show all of the client's appointments across barbershops. */
  barbershopId?: string;
}

export function AppointmentHistory({ barbershopId }: AppointmentHistoryProps) {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<Appointment | null>(null);
  const [clientPhone, setClientPhone] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => setClientPhone((data as any)?.phone || null));
  }, [user]);

  const fetchAppointments = useCallback(async () => {
    if (!user) return;

    setLoading(true);
    setError(null);

    let query = supabase
      .from("appointments")
      .select("id, date, start_time, end_time, status, notes, created_at, barber_id, barbershop_id, barbershop:barbershops(name), service:services(name, price, duration_minutes)")
      .eq("client_id", user.id)
      .order("date", { ascending: false })
      .order("start_time", { ascending: false });

    if (barbershopId) {
      query = query.eq("barbershop_id", barbershopId);
    }

    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter as "scheduled" | "completed" | "cancelled" | "no_show");
    }

    if (dateRange?.from) {
      query = query.gte("date", dateRange.from.toISOString().split("T")[0]);
    }
    if (dateRange?.to) {
      query = query.lte("date", dateRange.to.toISOString().split("T")[0]);
    }

    const { data, error: err } = await query;

    if (err) {
      setError("Erro ao carregar agendamentos.");
    } else {
      const rawAppointments = (data || []) as unknown as Omit<Appointment, "barber_profile">[];
      // Fetch standardized display names via RPC
      const barberIds = rawAppointments.map((a) => a.barber_id);
      const namesMap = await fetchBarberDisplayNames(barberIds);
      const finalAppointments = rawAppointments.map((a) => {
        const entry = namesMap[a.barber_id];
        return {
          ...a,
          barber_profile: entry
            ? { full_name: entry.display_name, avatar_url: entry.avatar_url }
            : { full_name: null, avatar_url: null },
        };
      });
      setAppointments(finalAppointments);

      // Fetch reviews already made by this user for these appointments
      const completedIds = finalAppointments
        .filter((a) => a.status === "completed")
        .map((a) => a.id);
      if (completedIds.length > 0) {
        const { data: reviews } = await supabase
          .from("reviews")
          .select("appointment_id")
          .eq("client_id", user.id)
          .in("appointment_id", completedIds);
        setReviewedIds(new Set((reviews || []).map((r) => r.appointment_id).filter((x): x is string => !!x)));
      } else {
        setReviewedIds(new Set());
      }
    }

    setLoading(false);
  }, [user, barbershopId, statusFilter, dateRange]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Cancel appointment
  const handleCancel = async (id: string) => {
    // Fetch notification data before cancelling
    const notifData = await getAppointmentNotificationData(id);

    const { error: err } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id);

    if (err) {
      setError("Erro ao cancelar agendamento.");
    } else {
      toast.success("Agendamento cancelado.");
      
      // Fire cancellation notification (non-blocking)
      if (notifData) {
        notifyBookingCancelled(notifData).catch(console.error);
      }

      fetchAppointments();
    }
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setDateRange(undefined);
  };

  const hasFilters = statusFilter !== "all" || dateRange?.from;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
          <History className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">
          Faça login para ver seu histórico de agendamentos.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Contact info banner */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border">
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Phone className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Telefone para contato
          </p>
          {clientPhone ? (
            <p className="text-sm font-medium text-foreground truncate">
              {displayBRPhone(clientPhone)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum telefone cadastrado
            </p>
          )}
        </div>
        <Link to="/configuracoes">
          <Button variant="outline" size="sm">
            {clientPhone ? "Alterar" : "Adicionar"}
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px] bg-card border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="scheduled">Agendado</SelectItem>
            <SelectItem value="completed">Concluído</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
            <SelectItem value="no_show">Não compareceu</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full sm:w-[260px] justify-start text-left font-normal bg-card border-border",
                !dateRange?.from && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="w-4 h-4" />
              {dateRange?.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "dd/MM/yy", { locale: ptBR })} —{" "}
                    {format(dateRange.to, "dd/MM/yy", { locale: ptBR })}
                  </>
                ) : (
                  format(dateRange.from, "dd/MM/yyyy", { locale: ptBR })
                )
              ) : (
                "Filtrar por data"
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={1}
              className="p-3 pointer-events-auto"
            />
          </PopoverContent>
        </Popover>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="w-4 h-4" />
            Limpar
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && appointments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <History className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">
            {hasFilters
              ? "Nenhum agendamento encontrado com esses filtros."
              : "Você ainda não tem agendamentos."}
          </p>
          {!hasFilters && (
            <p className="text-xs text-muted-foreground">
              Agende seu primeiro horário e ele aparecerá aqui.
            </p>
          )}
        </div>
      )}

      {/* Appointment list */}
      {!loading && appointments.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {appointments.length} agendamento{appointments.length !== 1 ? "s" : ""}
          </p>

          {appointments.map((apt) => {
            const status = STATUS_MAP[apt.status] || STATUS_MAP.scheduled;
            const isPast = apt.date < new Date().toISOString().split("T")[0];
            const canCancel = apt.status === "scheduled" && !isPast;

            return (
              <Card key={apt.id} className="bg-card border-border overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Date badge */}
                    <div className="flex sm:flex-col items-center gap-2 sm:gap-0 sm:min-w-[60px] sm:text-center">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {formatWeekday(apt.date)}
                      </span>
                      <span className="text-xl font-display font-bold text-foreground">
                        {new Date(apt.date + "T12:00:00").getDate()}
                      </span>
                      <span className="text-xs text-muted-foreground sm:hidden">
                        {formatDateBR(apt.date)}
                      </span>
                    </div>

                    {/* Divider */}
                    <div className="hidden sm:block w-px h-12 bg-border" />

                    {/* Details */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                          <Clock className="w-3.5 h-3.5 text-primary" />
                          {apt.start_time.slice(0, 5)} — {apt.end_time.slice(0, 5)}
                        </div>
                        <Badge variant={status.variant} className="text-[10px]">
                          {status.label}
                        </Badge>
                      </div>

                      {(apt.barber_profile?.full_name || apt.barber_profile?.avatar_url) && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {apt.barber_profile.avatar_url ? (
                            <img
                              src={apt.barber_profile.avatar_url}
                              alt={apt.barber_profile.full_name || "Barbeiro"}
                              className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                            />
                          ) : (
                            <User className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          )}
                          <span className="truncate">{apt.barber_profile.full_name || "Barbeiro"}</span>
                        </div>
                      )}

                      {apt.service && (
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Scissors className="w-3.5 h-3.5 text-primary" />
                          <span className="truncate">{apt.service.name}</span>
                          <span className="text-xs">
                            — R$ {Number(apt.service.price).toFixed(2)}
                          </span>
                        </div>
                      )}

                      {apt.notes && (
                        <p className="text-xs text-muted-foreground italic truncate">
                          {apt.notes}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      {apt.status === "completed" && (
                        reviewedIds.has(apt.id) ? (
                          <Badge variant="secondary" className="text-[10px] gap-1">
                            <Star className="w-3 h-3 fill-primary text-primary" />
                            Avaliado
                          </Badge>
                        ) : (
                          <Button
                            variant="gold"
                            size="sm"
                            onClick={() => setReviewing(apt)}
                          >
                            <Star className="w-3.5 h-3.5" />
                            Avaliar
                          </Button>
                        )
                      )}
                      {canCancel && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleCancel(apt.id)}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {reviewing && (
        <ReviewDialog
          open={!!reviewing}
          onOpenChange={(o) => !o && setReviewing(null)}
          appointmentId={reviewing.id}
          barbershopId={barbershopId}
          barberName={reviewing.barber_profile?.full_name}
          onSubmitted={() => {
            setReviewedIds((prev) => new Set(prev).add(reviewing.id));
            setReviewing(null);
          }}
        />
      )}
    </div>
  );
}
