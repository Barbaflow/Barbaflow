import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Clock, Check } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id: string;
}

interface AvailabilitySlot {
  id: string;
  barber_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface BookingCalendarProps {
  barbershopId: string;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function getDaysOfWeek(startDate: Date): Date[] {
  const days: Date[] = [];
  const start = new Date(startDate);
  start.setDate(start.getDate() - start.getDay());
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

const WEEKDAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function BookingCalendar({ barbershopId }: BookingCalendarProps) {
  const { user } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<string>("");
  const [selectedBarber, setSelectedBarber] = useState<string>("");
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    now.setDate(now.getDate() - now.getDay());
    return now;
  });
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [booking, setBooking] = useState(false);
  const [barbers, setBarbers] = useState<{ user_id: string }[]>([]);

  // Fetch services
  useEffect(() => {
    supabase
      .from("services")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .then(({ data }) => {
        if (data) setServices(data);
      });
  }, [barbershopId]);

  // Fetch barbers
  useEffect(() => {
    supabase
      .from("user_roles")
      .select("user_id")
      .eq("barbershop_id", barbershopId)
      .eq("role", "barbeiro")
      .then(({ data }) => {
        if (data) setBarbers(data);
      });
  }, [barbershopId]);

  // Fetch availability
  const fetchAvailability = useCallback(async () => {
    const days = getDaysOfWeek(weekStart);
    const startDate = formatDate(days[0]);
    const endDate = formatDate(days[6]);

    let query = supabase
      .from("availability")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .eq("status", "livre")
      .gte("date", startDate)
      .lte("date", endDate);

    if (selectedBarber) {
      query = query.eq("barber_id", selectedBarber);
    }

    const { data } = await query;
    if (data) setAvailability(data);
  }, [barbershopId, weekStart, selectedBarber]);

  useEffect(() => {
    fetchAvailability();
  }, [fetchAvailability]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("availability-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "availability", filter: `barbershop_id=eq.${barbershopId}` },
        () => fetchAvailability()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barbershopId, fetchAvailability]);

  const days = getDaysOfWeek(weekStart);

  const handleBook = async () => {
    if (!selectedSlot || !selectedService || !user) return;

    const service = services.find((s) => s.id === selectedService);
    if (!service) return;

    setBooking(true);

    // Calculate end time
    const [h, m] = selectedSlot.start_time.split(":").map(Number);
    const startMinutes = h * 60 + m;
    const endMinutes = startMinutes + service.duration_minutes;
    const endH = Math.floor(endMinutes / 60).toString().padStart(2, "0");
    const endM = (endMinutes % 60).toString().padStart(2, "0");
    const endTime = `${endH}:${endM}:00`;

    const { error } = await supabase.from("appointments").insert({
      barbershop_id: barbershopId,
      client_id: user.id,
      barber_id: selectedSlot.barber_id,
      service_id: selectedService,
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      end_time: endTime,
    });

    if (error) {
      toast.error("Erro ao agendar. Tente novamente.");
    } else {
      // Mark availability as occupied
      await supabase
        .from("availability")
        .update({ status: "ocupado" })
        .eq("id", selectedSlot.id);

      toast.success("Agendamento confirmado!");
      setSelectedSlot(null);
      fetchAvailability();
    }

    setBooking(false);
  };

  const prevWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  };

  const nextWeek = () => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  };

  const slotsForDay = (date: Date) =>
    availability.filter((s) => s.date === formatDate(date));

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <Select value={selectedService} onValueChange={setSelectedService}>
          <SelectTrigger className="w-[220px] bg-card border-border">
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
            <SelectTrigger className="w-[200px] bg-card border-border">
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

      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={prevWeek}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h3 className="font-display text-lg font-semibold">
          {MONTH_NAMES[days[0].getMonth()]} {days[0].getFullYear()}
        </h3>
        <Button variant="ghost" size="icon" onClick={nextWeek}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const slots = slotsForDay(day);
          const isToday = formatDate(day) === formatDate(new Date());
          return (
            <div key={i} className="min-h-[120px]">
              <div
                className={`text-center text-xs font-medium uppercase tracking-wider mb-2 pb-2 border-b ${
                  isToday ? "text-gold border-gold" : "text-muted-foreground border-border"
                }`}
              >
                <div>{WEEKDAY_NAMES[i]}</div>
                <div className={`text-lg font-display ${isToday ? "text-gold" : "text-foreground"}`}>
                  {day.getDate()}
                </div>
              </div>
              <div className="space-y-1">
                {slots.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground text-center">—</p>
                ) : (
                  slots.map((slot) => (
                    <button
                      key={slot.id}
                      onClick={() => setSelectedSlot(slot)}
                      className={`w-full text-[11px] px-1 py-1 rounded transition-colors ${
                        selectedSlot?.id === slot.id
                          ? "bg-gold text-gold-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-gold/20"
                      }`}
                    >
                      {slot.start_time.slice(0, 5)}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Booking confirmation */}
      {selectedSlot && selectedService && (
        <Card className="border-gold bg-card">
          <CardHeader className="pb-3">
            <CardTitle className="font-display text-lg text-gold">Confirmar Agendamento</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-foreground">
              <Clock className="w-4 h-4 text-gold" />
              {selectedSlot.date} às {selectedSlot.start_time.slice(0, 5)}
            </div>
            <div className="text-sm text-muted-foreground">
              {services.find((s) => s.id === selectedService)?.name} —{" "}
              R$ {Number(services.find((s) => s.id === selectedService)?.price || 0).toFixed(2)}
            </div>
            <Button
              variant="gold"
              onClick={handleBook}
              disabled={booking || !user}
              className="w-full"
            >
              <Check className="w-4 h-4" />
              {booking ? "Agendando..." : user ? "Confirmar" : "Faça login para agendar"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
