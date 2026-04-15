import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface ScheduleManagerProps {
  barbershopId: string;
}

interface AvailabilitySlot {
  id: string;
  barber_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface Appointment {
  id: string;
  client_id: string;
  barber_id: string;
  service_id: string;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
}

const WEEKDAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

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

const STATUS_COLORS: Record<string, string> = {
  livre: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  ocupado: "bg-gold/20 text-gold border-gold/30",
  folga: "bg-muted text-muted-foreground border-border",
  scheduled: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  cancelled: "bg-destructive/20 text-destructive border-destructive/30",
};

export function ScheduleManager({ barbershopId }: ScheduleManagerProps) {
  const { user } = useAuth();
  const [weekStart, setWeekStart] = useState(() => {
    const now = new Date();
    now.setDate(now.getDate() - now.getDay());
    return now;
  });
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newSlot, setNewSlot] = useState({ date: "", start_time: "09:00", end_time: "10:00", status: "livre" as string });

  const days = getDaysOfWeek(weekStart);

  const fetchData = useCallback(async () => {
    const startDate = formatDate(days[0]);
    const endDate = formatDate(days[6]);

    const [avail, appts] = await Promise.all([
      supabase
        .from("availability")
        .select("*")
        .eq("barbershop_id", barbershopId)
        .gte("date", startDate)
        .lte("date", endDate),
      supabase
        .from("appointments")
        .select("*")
        .eq("barbershop_id", barbershopId)
        .gte("date", startDate)
        .lte("date", endDate),
    ]);

    if (avail.data) setAvailability(avail.data);
    if (appts.data) setAppointments(appts.data);
  }, [barbershopId, weekStart]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time
  useEffect(() => {
    const channel = supabase
      .channel("schedule-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "availability", filter: `barbershop_id=eq.${barbershopId}` }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `barbershop_id=eq.${barbershopId}` }, () => fetchData())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [barbershopId, fetchData]);

  const addAvailability = async () => {
    if (!user || !newSlot.date) return;

    const { error } = await supabase.from("availability").insert({
      barbershop_id: barbershopId,
      barber_id: user.id,
      date: newSlot.date,
      start_time: newSlot.start_time + ":00",
      end_time: newSlot.end_time + ":00",
      status: newSlot.status as "livre" | "ocupado" | "folga",
    });

    if (error) {
      toast.error("Erro ao adicionar disponibilidade.");
    } else {
      toast.success("Disponibilidade adicionada!");
      setDialogOpen(false);
      fetchData();
    }
  };

  const deleteAvailability = async (id: string) => {
    const { error } = await supabase.from("availability").delete().eq("id", id);
    if (!error) {
      toast.success("Removido!");
      fetchData();
    }
  };

  const cancelAppointment = async (id: string) => {
    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (!error) {
      toast.success("Agendamento cancelado.");
      fetchData();
    }
  };

  const slotsForDay = (date: Date) => availability.filter((s) => s.date === formatDate(date));
  const apptsForDay = (date: Date) => appointments.filter((a) => a.date === formatDate(date));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() - 7);
            setWeekStart(d);
          }}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h3 className="font-display text-lg font-semibold">
            Semana de {days[0].getDate()}/{days[0].getMonth() + 1} — {days[6].getDate()}/{days[6].getMonth() + 1}
          </h3>
          <Button variant="ghost" size="icon" onClick={() => {
            const d = new Date(weekStart);
            d.setDate(d.getDate() + 7);
            setWeekStart(d);
          }}>
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="gold" size="sm">
              <Plus className="w-4 h-4" />
              Adicionar horário
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display">Novo Horário</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Data</Label>
                <Input type="date" value={newSlot.date} onChange={(e) => setNewSlot({ ...newSlot, date: e.target.value })} className="bg-input" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Início</Label>
                  <Input type="time" value={newSlot.start_time} onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })} className="bg-input" />
                </div>
                <div>
                  <Label>Fim</Label>
                  <Input type="time" value={newSlot.end_time} onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })} className="bg-input" />
                </div>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={newSlot.status} onValueChange={(v) => setNewSlot({ ...newSlot, status: v })}>
                  <SelectTrigger className="bg-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="livre">Livre</SelectItem>
                    <SelectItem value="folga">Folga</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="gold" className="w-full" onClick={addAvailability}>
                Salvar
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Weekly grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const slots = slotsForDay(day);
          const appts = apptsForDay(day);
          const isToday = formatDate(day) === formatDate(new Date());

          return (
            <Card key={i} className={`bg-card border-border min-h-[200px] ${isToday ? "border-gold" : ""}`}>
              <CardHeader className="p-3 pb-2">
                <CardTitle className={`text-xs uppercase tracking-wider ${isToday ? "text-gold" : "text-muted-foreground"}`}>
                  {WEEKDAY_NAMES[i]} {day.getDate()}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                {/* Availability slots */}
                {slots.map((slot) => (
                  <div key={slot.id} className={`text-[10px] px-2 py-1 rounded border flex items-center justify-between ${STATUS_COLORS[slot.status] || ""}`}>
                    <span>{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</span>
                    <button onClick={() => deleteAvailability(slot.id)} className="opacity-50 hover:opacity-100">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {/* Appointments */}
                {appts.map((appt) => (
                  <div key={appt.id} className={`text-[10px] px-2 py-1 rounded border ${STATUS_COLORS[appt.status] || ""}`}>
                    <div className="flex items-center justify-between">
                      <span>{appt.start_time.slice(0, 5)}-{appt.end_time.slice(0, 5)}</span>
                      {appt.status === "scheduled" && (
                        <button onClick={() => cancelAppointment(appt.id)} className="opacity-50 hover:opacity-100">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[8px] mt-1">{appt.status}</Badge>
                  </div>
                ))}
                {slots.length === 0 && appts.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
