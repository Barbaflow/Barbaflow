import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Loader2, Clock, AlertCircle, Check, ArrowRight, User, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchBarberDisplayNames, type BarberDisplay } from "@/lib/barber-names";

interface Slot {
  time: string; // HH:MM
  available: boolean;
  reason?: "ocupado" | "passado" | "atual";
}

export interface RescheduleTarget {
  id: string;
  date: string; // YYYY-MM-DD — the day to show available slots for
  start_time: string; // HH:MM:SS — original start time
  barber_id: string;
  barbershop_id: string;
  duration_minutes: number;
  client_name: string | null;
  service_name: string | null;
  // Optional: original date when rescheduling across days. When omitted,
  // assumes same-day reschedule (date === original_date).
  original_date?: string;
}

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: RescheduleTarget | null;
  onRescheduled: () => void;
  // Optional: when the user picks a different date inside the dialog (via the
  // "all full" warning calendar), the parent should re-issue the appointment
  // prop with the new date so slots/counts re-fetch for the new day.
  onDateChange?: (newDate: string) => void;
}

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (mins: number) =>
  `${Math.floor(mins / 60).toString().padStart(2, "0")}:${(mins % 60)
    .toString()
    .padStart(2, "0")}:00`;
const fmtShort = (mins: number) =>
  `${Math.floor(mins / 60).toString().padStart(2, "0")}:${(mins % 60)
    .toString()
    .padStart(2, "0")}`;

export function RescheduleDialog({
  open,
  onOpenChange,
  appointment,
  onRescheduled,
  onDateChange,
}: RescheduleDialogProps) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedBarberId, setSelectedBarberId] = useState<string>("");
  const [barbers, setBarbers] = useState<Array<{ user_id: string; display: BarberDisplay }>>([]);
  const [barbersLoading, setBarbersLoading] = useState(false);
  const [freeCounts, setFreeCounts] = useState<Record<string, number>>({});
  const [freeCountsLoading, setFreeCountsLoading] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const currentTime = appointment ? appointment.start_time.slice(0, 5) : "";
  const originalBarberId = appointment?.barber_id ?? "";

  // Sort barbers for the dropdown: current barber always first, then by
  // most free slots descending, falling back to alphabetical name.
  const sortedBarbers = useMemo(() => {
    return [...barbers].sort((a, b) => {
      if (a.user_id === originalBarberId) return -1;
      if (b.user_id === originalBarberId) return 1;
      const fa = freeCounts[a.user_id];
      const fb = freeCounts[b.user_id];
      const ka = fa !== undefined;
      const kb = fb !== undefined;
      if (ka && kb && fa !== fb) return fb - fa;
      if (ka && !kb) return -1;
      if (!ka && kb) return 1;
      return a.display.display_name.localeCompare(b.display.display_name);
    });
  }, [barbers, freeCounts, originalBarberId]);

  // True only when we have at least one barber, all counts have been
  // computed, and every single barber has zero free slots on the chosen day.
  const allFull =
    barbers.length > 0 &&
    !freeCountsLoading &&
    barbers.every((b) => freeCounts[b.user_id] === 0);

  // Load barbers list when dialog opens
  useEffect(() => {
    if (!open || !appointment) {
      setBarbers([]);
      setSelectedBarberId("");
      return;
    }
    setSelectedBarberId(appointment.barber_id);
    setBarbersLoading(true);
    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .eq("barbershop_id", appointment.barbershop_id)
        .in("role", ["barbeiro", "admin_barbearia"]);
      const ids = [...new Set((roles ?? []).map((r) => r.user_id))];
      if (ids.length === 0) {
        setBarbers([]);
        setBarbersLoading(false);
        return;
      }
      const map = await fetchBarberDisplayNames(ids);
      const list = ids.map((id) => ({
        user_id: id,
        display: map[id] ?? { display_name: "Barbeiro", avatar_url: null },
      }));
      list.sort((a, b) => a.display.display_name.localeCompare(b.display.display_name));
      setBarbers(list);
      setBarbersLoading(false);
    })();
  }, [open, appointment]);

  // For each barber in the list, compute how many free slots exist on the
  // target day, given the appointment duration. Mirrors the slot-generation
  // logic but aggregates a count per barber for the dropdown summary.
  useEffect(() => {
    if (!open || !appointment || barbers.length === 0) {
      setFreeCounts({});
      return;
    }
    let cancelled = false;
    setFreeCountsLoading(true);
    (async () => {
      const dow = new Date(`${appointment.date}T12:00:00`).getDay();
      const barberIds = barbers.map((b) => b.user_id);
      const [weeklyRes, apptRes, blockRes] = await Promise.all([
        supabase
          .from("weekly_schedule")
          .select("barber_id, start_time, end_time")
          .eq("barbershop_id", appointment.barbershop_id)
          .in("barber_id", barberIds)
          .eq("day_of_week", dow)
          .eq("is_active", true),
        supabase
          .from("appointments")
          .select("id, barber_id, start_time, end_time, status")
          .eq("barbershop_id", appointment.barbershop_id)
          .in("barber_id", barberIds)
          .eq("date", appointment.date)
          .neq("status", "cancelled"),
        supabase
          .from("schedule_blocks")
          .select("barber_id")
          .eq("barbershop_id", appointment.barbershop_id)
          .in("barber_id", barberIds)
          .eq("block_date", appointment.date),
      ]);
      if (cancelled) return;

      const today = new Date();
      const isToday =
        appointment.date ===
        `${today.getFullYear()}-${(today.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      const nowMin = today.getHours() * 60 + today.getMinutes();
      const dur = appointment.duration_minutes;
      const blocked = new Set((blockRes.data ?? []).map((b) => b.barber_id));

      const windowsByBarber: Record<string, Array<{ s: number; e: number }>> = {};
      (weeklyRes.data ?? []).forEach((w) => {
        (windowsByBarber[w.barber_id] ??= []).push({
          s: toMin(w.start_time),
          e: toMin(w.end_time),
        });
      });
      const busyByBarber: Record<string, Array<{ s: number; e: number }>> = {};
      (apptRes.data ?? []).forEach((a) => {
        // Same barber as the original appointment: ignore the slot we're moving.
        if (a.barber_id === originalBarberId && a.id === appointment.id) return;
        (busyByBarber[a.barber_id] ??= []).push({
          s: toMin(a.start_time),
          e: toMin(a.end_time),
        });
      });

      const counts: Record<string, number> = {};
      for (const id of barberIds) {
        if (blocked.has(id)) {
          counts[id] = 0;
          continue;
        }
        const windows = windowsByBarber[id] ?? [];
        const busy = busyByBarber[id] ?? [];
        let free = 0;
        for (const w of windows) {
          for (let t = w.s; t + dur <= w.e; t += dur) {
            const slotEnd = t + dur;
            if (busy.some((b) => t < b.e && slotEnd > b.s)) continue;
            if (isToday && t <= nowMin) continue;
            free += 1;
          }
        }
        counts[id] = free;
      }
      setFreeCounts(counts);
      setFreeCountsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, appointment, barbers, originalBarberId]);

  useEffect(() => {
    if (!open || !appointment || !selectedBarberId) {
      setSlots([]);
      setSelectedTime("");
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();

    (async () => {
      const dow = new Date(`${appointment.date}T12:00:00`).getDay();
      const [weeklyRes, apptRes, blockRes] = await Promise.all([
        supabase
          .from("weekly_schedule")
          .select("start_time, end_time, is_active")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("barber_id", selectedBarberId)
          .eq("day_of_week", dow)
          .eq("is_active", true),
        supabase
          .from("appointments")
          .select("id, start_time, end_time, status")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("barber_id", selectedBarberId)
          .eq("date", appointment.date)
          .neq("status", "cancelled"),
        supabase
          .from("schedule_blocks")
          .select("id")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("barber_id", selectedBarberId)
          .eq("block_date", appointment.date),
      ]);

      if (ctrl.signal.aborted) return;

      const isBlocked = (blockRes.data ?? []).length > 0;
      const windows = (weeklyRes.data ?? []).map((w) => ({
        s: toMin(w.start_time),
        e: toMin(w.end_time),
      }));
      const sameBarber = selectedBarberId === originalBarberId;
      const busy = (apptRes.data ?? [])
        .filter((a) => !(sameBarber && a.id === appointment.id))
        .map((a) => ({ s: toMin(a.start_time), e: toMin(a.end_time) }));

      const today = new Date();
      const isToday =
        appointment.date ===
        `${today.getFullYear()}-${(today.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      const nowMin = today.getHours() * 60 + today.getMinutes();
      // The "atual" badge only applies when reviewing the SAME day as the
      // original appointment — on cross-day reschedules the same clock time
      // on another day is a perfectly valid target.
      const isSameDay =
        !appointment.original_date || appointment.original_date === appointment.date;
      const isSameContext = isSameDay && sameBarber;
      const currentMin = toMin(currentTime);
      const dur = appointment.duration_minutes;

      const generated: Slot[] = [];
      if (!isBlocked) {
        for (const w of windows) {
          for (let t = w.s; t + dur <= w.e; t += dur) {
            const slotEnd = t + dur;
            const conflicts = busy.some((b) => t < b.e && slotEnd > b.s);
            const isPast = isToday && t <= nowMin;
            const isCurrent = isSameContext && t === currentMin;
            generated.push({
              time: fmtShort(t),
              available: !conflicts && !isPast && !isCurrent,
              reason: isCurrent
                ? "atual"
                : conflicts
                  ? "ocupado"
                  : isPast
                    ? "passado"
                    : undefined,
            });
          }
        }
      }

      setSlots(generated);
      setSelectedTime("");
      setLoading(false);
    })();

    return () => ctrl.abort();
  }, [open, appointment, currentTime, selectedBarberId, originalBarberId]);

  const handleConfirm = async () => {
    if (!appointment || !selectedTime || !selectedBarberId) return;
    setSubmitting(true);
    const startMin = toMin(selectedTime);
    const endTime = fmt(startMin + appointment.duration_minutes);
    const { error } = await supabase
      .from("appointments")
      .update({
        // Persist the new date too — supports cross-day reschedules
        // when the parent passed appointment.date as the target day.
        date: appointment.date,
        start_time: `${selectedTime}:00`,
        end_time: endTime,
        barber_id: selectedBarberId,
      })
      .eq("id", appointment.id);

    if (error) {
      toast.error(error.message || "Erro ao reagendar.");
    } else {
      const crossDay =
        appointment.original_date && appointment.original_date !== appointment.date;
      const changedBarber = selectedBarberId !== originalBarberId;
      const newBarberName = barbers.find((b) => b.user_id === selectedBarberId)?.display.display_name;
      const parts: string[] = [];
      if (crossDay) parts.push(appointment.date);
      parts.push(`às ${selectedTime}`);
      if (changedBarber && newBarberName) parts.push(`com ${newBarberName}`);
      toast.success(`Reagendado ${parts.join(" ")}!`);
      onRescheduled();
      onOpenChange(false);
    }
    setSubmitting(false);
  };

  if (!appointment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Reagendar
          </DialogTitle>
          <DialogDescription>
            Escolha um novo horário para{" "}
            <span className="font-medium text-foreground">
              {appointment.client_name || "este cliente"}
            </span>
            {appointment.service_name ? ` (${appointment.service_name})` : ""}
            {appointment.original_date && appointment.original_date !== appointment.date && (
              <>
                {" "}
                <span className="block mt-1 text-xs text-primary">
                  Movendo de {appointment.original_date} → {appointment.date}
                </span>
              </>
            )}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center justify-center gap-3 p-3 rounded-lg bg-secondary/40 border border-border">
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Atual</p>
              <p className="text-lg font-display font-bold text-foreground">{currentTime}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="text-center">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Novo</p>
              <p className="text-lg font-display font-bold text-primary">
                {selectedTime || "—"}
              </p>
            </div>
          </div>

          {allFull && (
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full flex items-start gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-left hover:bg-destructive/15 transition-colors"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-destructive" />
                  <div className="flex-1 text-xs">
                    <p className="font-medium text-destructive">
                      Nenhum profissional tem horário livre em {appointment.date}.
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      {onDateChange
                        ? "Toque aqui para escolher outra data no calendário."
                        : "Feche este popup e escolha outra data no calendário do dashboard."}
                    </p>
                  </div>
                  <CalendarDays className="w-4 h-4 mt-0.5 flex-shrink-0 text-destructive" />
                </button>
              </PopoverTrigger>
              {onDateChange && (
                <PopoverContent className="w-auto p-0" align="center">
                  <Calendar
                    mode="single"
                    selected={new Date(appointment.date + "T12:00:00")}
                    onSelect={(d) => {
                      if (!d) return;
                      const y = d.getFullYear();
                      const m = (d.getMonth() + 1).toString().padStart(2, "0");
                      const day = d.getDate().toString().padStart(2, "0");
                      onDateChange(`${y}-${m}-${day}`);
                      setDatePickerOpen(false);
                    }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              )}
            </Popover>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" />
              Profissional
            </label>
            <Select
              value={selectedBarberId}
              onValueChange={setSelectedBarberId}
              disabled={barbersLoading || submitting}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder={barbersLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                {sortedBarbers.map((b, idx) => {
                  const free = freeCounts[b.user_id];
                  const knownCount = !freeCountsLoading && free !== undefined;
                  const isCurrent = b.user_id === originalBarberId;
                  const showSeparator =
                    isCurrent && idx === 0 && sortedBarbers.length > 1;
                  return (
                    <Fragment key={b.user_id}>
                      <SelectItem value={b.user_id}>
                        <div className="flex items-center gap-2 w-full">
                          <Avatar className="w-5 h-5">
                            {b.display.avatar_url && <AvatarImage src={b.display.avatar_url} />}
                            <AvatarFallback className="text-[9px]">
                              {b.display.display_name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm flex-1">
                            {b.display.display_name}
                            {isCurrent && (
                              <span className="ml-1.5 text-[10px] text-muted-foreground">(atual)</span>
                            )}
                          </span>
                          <span
                            className={cn(
                              "ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full border",
                              knownCount && free === 0 && "bg-muted/40 text-muted-foreground border-transparent",
                              knownCount && free > 0 && free <= 2 && "bg-secondary text-foreground border-border",
                              knownCount && free > 2 && "bg-primary/10 text-primary border-primary/30",
                              !knownCount && "bg-muted/40 text-muted-foreground border-transparent"
                            )}
                          >
                            {knownCount ? `${free} ${free === 1 ? "slot" : "slots"}` : "…"}
                          </span>
                        </div>
                      </SelectItem>
                      {showSeparator && (
                        <>
                          <SelectSeparator />
                          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Outros profissionais
                          </div>
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="p-6 rounded-lg border border-border flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Buscando horários disponíveis...
            </div>
          ) : slots.length === 0 ? (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p>
                Sem horários disponíveis nesta data para este barbeiro.
                Para mudar de barbeiro ou data, clique no card e use a edição completa.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {slots.map((slot) => {
                  const isSelected = selectedTime === slot.time;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => setSelectedTime(slot.time)}
                      className={cn(
                        "px-2 py-2 rounded-md text-sm font-medium border transition-colors",
                        isSelected &&
                          "bg-primary text-primary-foreground border-primary shadow-sm",
                        !isSelected &&
                          slot.available &&
                          "bg-background border-border hover:bg-secondary text-foreground",
                        !isSelected &&
                          slot.reason === "atual" &&
                          "bg-secondary/60 border-primary/40 text-muted-foreground cursor-not-allowed",
                        !isSelected &&
                          (slot.reason === "ocupado" || slot.reason === "passado") &&
                          "bg-muted/40 border-transparent text-muted-foreground line-through cursor-not-allowed"
                      )}
                      title={
                        slot.reason === "atual"
                          ? "Horário atual"
                          : slot.available
                            ? "Disponível"
                            : slot.reason === "ocupado"
                              ? "Já agendado"
                              : "Horário passado"
                      }
                    >
                      {slot.time}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <Badge variant="outline" className="bg-secondary/60 border-primary/40">
                  Atual
                </Badge>
                <Badge variant="outline" className="line-through">
                  Indisponível
                </Badge>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedTime || submitting}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Confirmar reagendamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
