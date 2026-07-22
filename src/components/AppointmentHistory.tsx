import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toISODateInTenantTZ } from "@/lib/tz";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarIcon, Clock, Scissors, AlertCircle, History, X, User, Star, Phone, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { notifyBookingCancelled, getAppointmentNotificationData } from "@/lib/notifications";
import { format } from "date-fns";
import { getActiveTenantTZ, tenantDateTimeToUTCms, weekdayOfISO } from "@/lib/tz";
import { agendaErrorMessage } from "@/lib/agenda-errors";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { ReviewDialog } from "./ReviewDialog";
import { RescheduleDialog, type RescheduleTarget } from "./RescheduleDialog";
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

const WEEKDAY_SHORT = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

// Datas de calendário são lidas direto da string YYYY-MM-DD. Construir um
// `Date` local aqui misturaria o relógio do dispositivo numa data que não tem
// fuso — a mesma estratégia adotada na agenda.
function formatDateBR(dateStr: string) {
  return `${Number(dateStr.slice(8, 10))} de ${MONTH_NAMES[Number(dateStr.slice(5, 7)) - 1]}`;
}

function formatWeekday(dateStr: string) {
  return WEEKDAY_SHORT[weekdayOfISO(dateStr)];
}

function dayOfMonth(dateStr: string) {
  return Number(dateStr.slice(8, 10));
}

interface AppointmentHistoryProps {
  /**
   * Filtro OPCIONAL de exibição por barbearia. Nunca é fonte de autorização:
   * quem decide o que o usuário enxerga é a policy de `appointments`, por
   * `client_id = auth.uid()`. Omitir mostra as reservas do usuário em todas as
   * barbearias — que é o comportamento da área pessoal.
   */
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
  const [rescheduling, setRescheduling] = useState<RescheduleTarget | null>(null);
  const [clientPhone, setClientPhone] = useState<string | null>(null);
  // Per-barbershop reschedule minimum-hours limit (default 2)
  const [rescheduleMinHoursMap, setRescheduleMinHoursMap] = useState<Record<string, number>>({});
  // Per-barbershop cancel minimum-hours limit (default 2)
  const [cancelMinHoursMap, setCancelMinHoursMap] = useState<Record<string, number>>({});
  // Fuso de cada barbearia: a lista mistura reservas de lugares diferentes, e
  // "agora" precisa ser o da barbearia da reserva, não o do dispositivo.
  const [shopTzMap, setShopTzMap] = useState<Record<string, string>>({});
  // Bloqueios ativos por falta, para explicar ao cliente em vez de deixá-lo
  // descobrir só na hora de agendar.
  const [blocks, setBlocks] = useState<Array<{ barbershop_id: string; blocked_until: string }>>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  // Trava síncrona: `setState` só vale no próximo render, então dois cliques no
  // mesmo tick disparariam dois cancelamentos.
  const cancelInFlight = useRef(false);

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
      query = query.gte("date", toISODateInTenantTZ(dateRange.from));
    }
    if (dateRange?.to) {
      query = query.lte("date", toISODateInTenantTZ(dateRange.to));
    }

    const { data, error: err } = await query;

    if (err) {
      // Falha de consulta não pode virar lista vazia: são estados diferentes.
      setError(err.message || "Erro ao carregar agendamentos.");
      setAppointments([]);
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

      // Fetch per-barbershop reschedule/cancel min-hours settings (one query for all shops)
      const shopIds = Array.from(new Set(finalAppointments.map((a) => a.barbershop_id)));
      if (shopIds.length > 0) {
        const { data: shops } = await supabase
          .from("barbershops")
          .select("id, reschedule_min_hours, cancel_min_hours, timezone")
          .in("id", shopIds);
        const rMap: Record<string, number> = {};
        const cMap: Record<string, number> = {};
        const tzMap: Record<string, string> = {};
        (shops || []).forEach((s: any) => {
          if (typeof s.timezone === "string" && s.timezone) tzMap[s.id] = s.timezone;
          rMap[s.id] = typeof s.reschedule_min_hours === "number" ? s.reschedule_min_hours : 2;
          cMap[s.id] = typeof s.cancel_min_hours === "number" ? s.cancel_min_hours : 2;
        });
        setRescheduleMinHoursMap(rMap);
        setCancelMinHoursMap(cMap);
        setShopTzMap(tzMap);
      }

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

  // A policy "Clients can view their own active blocks" já limita a
  // `client_id = auth.uid() AND blocked_until > now()`: não chega nenhum dado
  // administrativo aqui, só o fato e o prazo.
  useEffect(() => {
    if (!user) return;
    let cancelado = false;
    supabase
      .from("client_blocks")
      .select("barbershop_id, blocked_until")
      .eq("client_id", user.id)
      .then(({ data }) => {
        if (!cancelado) setBlocks((data as Array<{ barbershop_id: string; blocked_until: string }>) ?? []);
      });
    return () => {
      cancelado = true;
    };
  }, [user]);

  // Cancel appointment
  const handleCancel = async (id: string) => {
    if (cancelInFlight.current) return;
    cancelInFlight.current = true;
    setCancellingId(id);
    setError(null);

    // Dados da notificação antes de cancelar (depois o status já mudou).
    const notifData = await getAppointmentNotificationData(id);

    // `select()` para saber QUANTAS linhas mudaram. Sem isso, uma recusa da RLS
    // — 0 linhas, sem erro — era comemorada como sucesso.
    const { data, error: err } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "scheduled")
      .select("id");

    if (err) {
      const { title, description } = agendaErrorMessage(err, "Erro ao cancelar agendamento.");
      toast.error(title, { description });
      setError(title);
    } else if (!data || data.length === 0) {
      toast.error("Não foi possível cancelar.", {
        description:
          "O agendamento pode já ter sido cancelado ou atendido. A lista foi atualizada.",
      });
    } else {
      toast.success("Agendamento cancelado.");
      if (notifData) {
        notifyBookingCancelled(notifData).catch(console.error);
      }
    }

    await fetchAppointments();
    cancelInFlight.current = false;
    setCancellingId(null);
  };

  /**
   * Próximos x histórico.
   *
   * A regra usa STATUS e DATA juntos, como o modelo do banco exige. Os status
   * reais são só quatro: scheduled, completed, cancelled, no_show — não existe
   * "reagendado" como status próprio; reagendar altera data/hora e mantém
   * scheduled.
   *
   * "Próximo" = ainda `scheduled` E cujo TÉRMINO ainda não passou. Assim um
   * agendamento futuro já cancelado não aparece como próximo, e um antigo que
   * ficou `scheduled` (a barbearia esqueceu de concluir) cai no histórico em
   * vez de fingir que ainda vai acontecer.
   *
   * O "agora" é medido no fuso da barbearia DAQUELA reserva — a lista mistura
   * barbearias. Enquanto as configurações não chegaram, o fallback é o fuso do
   * tenant ativo (`getActiveTenantTZ()`), que é o mesmo default do banco.
   */
  const fimEmMs = useCallback(
    (apt: Appointment) =>
      tenantDateTimeToUTCms(apt.date, apt.end_time, shopTzMap[apt.barbershop_id] ?? getActiveTenantTZ()),
    [shopTzMap],
  );

  const { proximos, historico } = useMemo(() => {
    const agora = Date.now();
    const prox: Appointment[] = [];
    const hist: Appointment[] = [];
    for (const apt of appointments) {
      if (apt.status === "scheduled" && fimEmMs(apt) > agora) prox.push(apt);
      else hist.push(apt);
    }
    // Próximos: o mais perto primeiro. Histórico: o mais recente primeiro.
    prox.sort((a, b) => fimEmMs(a) - fimEmMs(b));
    hist.sort((a, b) => fimEmMs(b) - fimEmMs(a));
    return { proximos: prox, historico: hist };
  }, [appointments, fimEmMs]);

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
        <Link to="/configuracoes" search={{ barbershop: undefined }}>
          <Button variant="outline" size="sm">
            {clientPhone ? "Alterar" : "Adicionar"}
          </Button>
        </Link>
      </div>

      {/* Bloqueio por falta: o cliente precisa saber por que não consegue
          agendar. Nenhum detalhe administrativo — só o fato e o prazo. */}
      {blocks.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-foreground font-medium">
              Novos agendamentos temporariamente bloqueados
            </p>
            <p className="text-muted-foreground text-xs">
              Por faltas registradas, você não pode marcar novos horários
              {blocks.length === 1 ? " nesta barbearia" : " em algumas barbearias"} até{" "}
              {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" }).format(
                new Date(blocks[0].blocked_until),
              )}
              . Seus agendamentos já existentes seguem abaixo e você continua podendo cancelá-los.
            </p>
          </div>
        </div>
      )}

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

      {/* Próximos e histórico, nesta ordem */}
      {!loading && appointments.length > 0 && (
        <div className="space-y-6">
          {[
            { titulo: "Próximos", itens: proximos, vazio: "Nenhum agendamento futuro." },
            { titulo: "Histórico", itens: historico, vazio: "Nada no histórico ainda." },
          ].map((secao) => (
            <div key={secao.titulo} className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-lg text-foreground">{secao.titulo}</h2>
                <span className="text-xs text-muted-foreground">
                  {secao.itens.length} agendamento{secao.itens.length !== 1 ? "s" : ""}
                </span>
              </div>

              {secao.itens.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">{secao.vazio}</p>
              )}

              {secao.itens.map((apt) => {
            const status = STATUS_MAP[apt.status] || STATUS_MAP.scheduled;
            // O término, e não só a data: um horário que já passou hoje não é futuro.
            const isFutureScheduled = apt.status === "scheduled" && fimEmMs(apt) > Date.now();
            // Per-barbershop limits (default 2h, 0 = no limit). Configurable in settings.
            const minHours = rescheduleMinHoursMap[apt.barbershop_id] ?? 2;
            const cancelMinHours = cancelMinHoursMap[apt.barbershop_id] ?? 2;
            // Instante absoluto do agendamento no fuso do tenant (estável independente
            // do fuso do dispositivo do usuário).
            const apptStartMs = tenantDateTimeToUTCms(apt.date, apt.start_time);
            const hoursUntil = (apptStartMs - Date.now()) / (1000 * 60 * 60);
            const canReschedule = isFutureScheduled && (minHours <= 0 || hoursUntil >= minHours);
            const canCancel = isFutureScheduled && (cancelMinHours <= 0 || hoursUntil >= cancelMinHours);
            const rescheduleLocked = isFutureScheduled && !canReschedule;
            const cancelLocked = isFutureScheduled && !canCancel;

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
                        {dayOfMonth(apt.date)}
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

                      {!barbershopId && apt.barbershop?.name && (
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/80">
                          {apt.barbershop.name}
                        </p>
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
                      {isFutureScheduled && (
                        <>
                          {rescheduleLocked ? (
                            <div
                              className="text-[10px] text-amber-500 flex items-center gap-1 max-w-[160px] leading-tight"
                              title={`Para reagendar com menos de ${minHours}h de antecedência, entre em contato com a barbearia.`}
                            >
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              <span>Reagendamento bloqueado (menos de {minHours}h)</span>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setRescheduling({
                                  id: apt.id,
                                  date: apt.date,
                                  start_time: apt.start_time,
                                  barber_id: apt.barber_id,
                                  barbershop_id: apt.barbershop_id,
                                  duration_minutes: apt.service?.duration_minutes ?? 30,
                                  client_name: null,
                                  service_name: apt.service?.name ?? null,
                                  original_date: apt.date,
                                })
                              }
                            >
                              <CalendarClock className="w-3.5 h-3.5" />
                              Reagendar
                            </Button>
                          )}
                          {cancelLocked ? (
                            <div
                              className="text-[10px] text-amber-500 flex items-center gap-1 max-w-[160px] leading-tight"
                              title={`Para cancelar com menos de ${cancelMinHours}h de antecedência, entre em contato com a barbearia.`}
                            >
                              <AlertCircle className="w-3 h-3 flex-shrink-0" />
                              <span>Cancelamento bloqueado (menos de {cancelMinHours}h)</span>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={cancellingId !== null}
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleCancel(apt.id)}
                            >
                              {cancellingId === apt.id ? "Cancelando…" : "Cancelar"}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
              })}
            </div>
          ))}
        </div>
      )}

      {reviewing && (
        <ReviewDialog
          open={!!reviewing}
          onOpenChange={(o) => !o && setReviewing(null)}
          appointmentId={reviewing.id}
          barbershopId={reviewing.barbershop_id}
          barberName={reviewing.barber_profile?.full_name}
          onSubmitted={() => {
            setReviewedIds((prev) => new Set(prev).add(reviewing.id));
            setReviewing(null);
          }}
        />
      )}

      <RescheduleDialog
        open={!!rescheduling}
        onOpenChange={(o) => !o && setRescheduling(null)}
        appointment={rescheduling}
        onRescheduled={() => {
          setRescheduling(null);
          fetchAppointments();
        }}
        onDateChange={(newDate) =>
          setRescheduling((prev) => (prev ? { ...prev, date: newDate } : prev))
        }
      />
    </div>
  );
}
