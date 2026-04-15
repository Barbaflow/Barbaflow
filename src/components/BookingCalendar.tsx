import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { usePlan } from "@/hooks/use-plan";
import { toast } from "sonner";
import { notifyBookingConfirmed } from "@/lib/notifications";
import { useBookingData } from "./booking/useBookingData";
import { DateSelector } from "./booking/DateSelector";
import { TimeSlotGrid } from "./booking/TimeSlotGrid";
import { BookingConfirmation } from "./booking/BookingConfirmation";
import { PlanPaywallModal } from "./PlanPaywallModal";
import { AlertTriangle } from "lucide-react";
import type { AvailabilitySlot } from "./booking/types";

interface BookingCalendarProps {
  barbershopId: string;
}

export function BookingCalendar({ barbershopId }: BookingCalendarProps) {
  const { user } = useAuth();
  const {
    services,
    barbers,
    availability,
    selectedDate,
    setSelectedDate,
    loadingSlots,
    error,
    fetchAvailability,
  } = useBookingData(barbershopId);

  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedBarber, setSelectedBarber] = useState<string>("");
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [booking, setBooking] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);

  const { planName, appointmentLimit, appointmentsUsed } = usePlan();
  const isFree = planName === "free";
  const usagePercent = appointmentLimit ? Math.round((appointmentsUsed / appointmentLimit) * 100) : 0;
  const isAtLimit = isFree && appointmentLimit !== null && appointmentsUsed >= appointmentLimit;
  const isWarning = isFree && usagePercent >= 80 && !isAtLimit;

  // Fetch slots when date or barber changes
  useEffect(() => {
    fetchAvailability(selectedBarber || undefined);
  }, [fetchAvailability, selectedBarber]);

  // Reset slot selection on date change
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate]);

  const handleBook = async () => {
    if (!selectedSlot || !selectedService || !user) return;

    if (isAtLimit) {
      setShowPaywall(true);
      return;
    }

    const service = services.find((s) => s.id === selectedService);
    if (!service) return;

    setBooking(true);

    const [h, m] = selectedSlot.start_time.split(":").map(Number);
    const endMinutes = h * 60 + m + service.duration_minutes;
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, "0")}:${(endMinutes % 60).toString().padStart(2, "0")}:00`;

    const { error: insertError } = await supabase.from("appointments").insert({
      barbershop_id: barbershopId,
      client_id: user.id,
      barber_id: selectedSlot.barber_id,
      service_id: selectedService,
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      end_time: endTime,
    });

    if (insertError) {
      toast.error("Erro ao agendar. Tente novamente.");
    } else {
      await supabase
        .from("availability")
        .update({ status: "ocupado" })
        .eq("id", selectedSlot.id);

      toast.success("Agendamento confirmado!");

      // Fire notification (non-blocking)
      notifyBookingConfirmed({
        appointmentId: crypto.randomUUID(),
        serviceName: service.name,
        date: selectedSlot.date,
        startTime: selectedSlot.start_time,
      }).catch(console.error);

      setSelectedSlot(null);
      fetchAvailability(selectedBarber || undefined);
    }

    setBooking(false);
  };

  const selectedServiceObj = services.find((s) => s.id === selectedService);

  return (
    <div className="space-y-5">
      {/* Filters — stacked on mobile, inline on desktop */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={selectedService} onValueChange={setSelectedService}>
          <SelectTrigger className="w-full sm:w-[240px] bg-card border-border">
            <SelectValue placeholder="Selecione o serviço" />
          </SelectTrigger>
          <SelectContent>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name} — R$ {Number(s.price).toFixed(2)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {barbers.length > 1 && (
          <Select value={selectedBarber} onValueChange={setSelectedBarber}>
            <SelectTrigger className="w-full sm:w-[200px] bg-card border-border">
              <SelectValue placeholder="Qualquer barbeiro" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Qualquer barbeiro</SelectItem>
              {barbers.map((b) => (
                <SelectItem key={b.user_id} value={b.user_id}>
                  Barbeiro {b.user_id.slice(0, 6)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Date selector */}
      <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />

      {/* Time slots */}
      <TimeSlotGrid
        slots={availability}
        selectedSlotId={selectedSlot?.id ?? null}
        onSelect={setSelectedSlot}
        loading={loadingSlots}
        error={error}
      />

      {/* Confirmation bar — fixed bottom on mobile */}
      {selectedSlot && selectedServiceObj && (
        <BookingConfirmation
          slot={selectedSlot}
          service={selectedServiceObj}
          isLoggedIn={!!user}
          booking={booking}
          onConfirm={handleBook}
          onCancel={() => setSelectedSlot(null)}
        />
      )}

      {/* Spacer for fixed bottom bar on mobile */}
      {selectedSlot && selectedServiceObj && (
        <div className="h-36 md:hidden" />
      )}
    </div>
  );
}
