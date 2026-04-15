import { Check, Clock, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Service, AvailabilitySlot } from "./types";

const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

function formatDateBR(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getDate()} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
}

interface BookingConfirmationProps {
  slot: AvailabilitySlot;
  service: Service;
  isLoggedIn: boolean;
  booking: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function BookingConfirmation({
  slot,
  service,
  isLoggedIn,
  booking,
  onConfirm,
  onCancel,
}: BookingConfirmationProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 md:static md:mt-4">
      <div className="bg-card border-t md:border md:rounded-xl border-border p-4 md:p-5 shadow-lg md:shadow-md space-y-3 max-w-lg mx-auto">
        <div className="flex items-start justify-between">
          <h3 className="font-display text-base font-semibold text-primary">
            Confirmar Agendamento
          </h3>
          <button
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            Cancelar
          </button>
        </div>

        <div className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-center gap-2 text-foreground">
            <Clock className="w-4 h-4 text-primary flex-shrink-0" />
            <span>{formatDateBR(slot.date)} às {slot.start_time.slice(0, 5)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Scissors className="w-4 h-4 text-primary flex-shrink-0" />
            <span>
              {service.name} — R$ {Number(service.price).toFixed(2)}
              <span className="text-xs ml-1">({service.duration_minutes}min)</span>
            </span>
          </div>
        </div>

        <Button
          onClick={onConfirm}
          disabled={booking || !isLoggedIn}
          className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Check className="w-4 h-4" />
          {booking ? "Agendando..." : isLoggedIn ? "Confirmar" : "Faça login para agendar"}
        </Button>
      </div>
    </div>
  );
}
