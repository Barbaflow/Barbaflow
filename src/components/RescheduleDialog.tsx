import { useEffect, useState } from "react";
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
import { Loader2, Clock, AlertCircle, Check, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Slot {
  time: string; // HH:MM
  available: boolean;
  reason?: "ocupado" | "passado" | "atual";
}

export interface RescheduleTarget {
  id: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  barber_id: string;
  barbershop_id: string;
  duration_minutes: number;
  client_name: string | null;
  service_name: string | null;
}

interface RescheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: RescheduleTarget | null;
  onRescheduled: () => void;
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
}: RescheduleDialogProps) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const currentTime = appointment ? appointment.start_time.slice(0, 5) : "";

  useEffect(() => {
    if (!open || !appointment) {
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
          .eq("barber_id", appointment.barber_id)
          .eq("day_of_week", dow)
          .eq("is_active", true),
        supabase
          .from("appointments")
          .select("id, start_time, end_time, status")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("barber_id", appointment.barber_id)
          .eq("date", appointment.date)
          .neq("status", "cancelled"),
        supabase
          .from("schedule_blocks")
          .select("id")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("barber_id", appointment.barber_id)
          .eq("block_date", appointment.date),
      ]);

      if (ctrl.signal.aborted) return;

      const isBlocked = (blockRes.data ?? []).length > 0;
      const windows = (weeklyRes.data ?? []).map((w) => ({
        s: toMin(w.start_time),
        e: toMin(w.end_time),
      }));
      const busy = (apptRes.data ?? [])
        .filter((a) => a.id !== appointment.id)
        .map((a) => ({ s: toMin(a.start_time), e: toMin(a.end_time) }));

      const today = new Date();
      const isToday =
        appointment.date ===
        `${today.getFullYear()}-${(today.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      const nowMin = today.getHours() * 60 + today.getMinutes();
      // Only mark a slot as "atual" when reviewing the SAME day as the
      // original appointment — on cross-day reschedules the same time on
      // another day is a perfectly valid target.
      const sameDay = appointment.date === appointment.date; // placeholder, see below
      const currentMin = toMin(currentTime);
      const dur = appointment.duration_minutes;

      const generated: Slot[] = [];
      if (!isBlocked) {
        for (const w of windows) {
          for (let t = w.s; t + dur <= w.e; t += dur) {
            const slotEnd = t + dur;
            const conflicts = busy.some((b) => t < b.e && slotEnd > b.s);
            const isPast = isToday && t <= nowMin;
            const isCurrent = t === currentMin;
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
  }, [open, appointment, currentTime]);

  const handleConfirm = async () => {
    if (!appointment || !selectedTime) return;
    setSubmitting(true);
    const startMin = toMin(selectedTime);
    const endTime = fmt(startMin + appointment.duration_minutes);
    const { error } = await supabase
      .from("appointments")
      .update({
        start_time: `${selectedTime}:00`,
        end_time: endTime,
      })
      .eq("id", appointment.id);

    if (error) {
      toast.error(error.message || "Erro ao reagendar.");
    } else {
      toast.success(`Reagendado para ${selectedTime}!`);
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
            {appointment.service_name ? ` (${appointment.service_name})` : ""}.
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
