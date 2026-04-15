import { Clock, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AvailabilitySlot } from "./types";

interface TimeSlotGridProps {
  slots: AvailabilitySlot[];
  selectedSlotId: string | null;
  onSelect: (slot: AvailabilitySlot) => void;
  loading: boolean;
  error: string | null;
}

export function TimeSlotGrid({ slots, selectedSlotId, onSelect, loading, error }: TimeSlotGridProps) {
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <AlertCircle className="w-6 h-6 text-destructive" />
        </div>
        <p className="text-sm text-destructive font-medium">{error}</p>
        <p className="text-xs text-muted-foreground">Tente recarregar a página.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  const freeSlots = slots.filter((s) => s.status === "livre");
  const occupiedCount = slots.filter((s) => s.status === "ocupado").length;

  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
          <Clock className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">
          Nenhum horário disponível neste dia.
        </p>
        <p className="text-xs text-muted-foreground">
          Tente outra data ou outro barbeiro.
        </p>
      </div>
    );
  }

  if (freeSlots.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <Clock className="w-6 h-6 text-destructive" />
        </div>
        <p className="text-sm text-destructive font-medium">
          Todos os {occupiedCount} horários estão ocupados.
        </p>
        <p className="text-xs text-muted-foreground">
          Selecione outra data para encontrar horários livres.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {freeSlots.length} horário{freeSlots.length !== 1 ? "s" : ""} disponíve{freeSlots.length !== 1 ? "is" : "l"}
        </p>
        {occupiedCount > 0 && (
          <p className="text-xs text-destructive/70">
            {occupiedCount} ocupado{occupiedCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {slots.map((slot) => {
          const isFree = slot.status === "livre";
          const isSelected = slot.id === selectedSlotId;

          return (
            <button
              key={slot.id}
              disabled={!isFree}
              onClick={() => isFree && onSelect(slot)}
              className={`
                relative flex items-center justify-center h-12 rounded-lg text-sm font-medium
                transition-all duration-150
                ${
                  !isFree
                    ? "bg-muted/50 text-muted-foreground line-through cursor-not-allowed opacity-50"
                    : isSelected
                      ? "bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30 scale-[1.03]"
                      : "bg-card text-foreground hover:bg-secondary border border-border hover:border-primary/40"
                }
              `}
            >
              {slot.start_time.slice(0, 5)}
              {!isFree && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-destructive border-2 border-background" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
