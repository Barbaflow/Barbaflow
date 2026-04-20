import { useState, useEffect, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Search,
  User,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { displayBRPhone } from "@/lib/phone";

// Local YYYY-MM-DD (avoids timezone shift from toISOString)
const dateToISO = (d: Date) =>
  `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
    .getDate()
    .toString()
    .padStart(2, "0")}`;
const isoToDate = (iso: string) => new Date(`${iso}T12:00:00`);

interface Client {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
}

interface Barber {
  id: string;
  name: string;
}

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id: string;
}

interface Slot {
  time: string; // HH:MM
  available: boolean;
  reason?: "ocupado" | "passado";
}

interface ManualAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbershopId: string;
  barbers: Barber[];
  defaultDate: string;
  onCreated: () => void;
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

export function ManualAppointmentDialog({
  open,
  onOpenChange,
  barbershopId,
  barbers,
  defaultDate,
  onCreated,
}: ManualAppointmentDialogProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedBarber, setSelectedBarber] = useState<string>("");
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<string>("");
  const [date, setDate] = useState(defaultDate);
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeWeekdays, setActiveWeekdays] = useState<Set<number>>(new Set());
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedClient(null);
      setSelectedBarber(barbers[0]?.id ?? "");
      setSelectedService("");
      setDate(defaultDate);
      setSelectedTime("");
      setNotes("");
      setSlots([]);
    }
  }, [open, defaultDate, barbers]);

  // Load clients with prior appointments at this barbershop
  useEffect(() => {
    if (!open) return;
    setLoadingClients(true);
    (async () => {
      const { data: appts } = await supabase
        .from("appointments")
        .select("client_id")
        .eq("barbershop_id", barbershopId);
      const ids = Array.from(new Set((appts ?? []).map((a) => a.client_id)));
      if (ids.length === 0) {
        setClients([]);
        setLoadingClients(false);
        return;
      }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, phone, avatar_url")
        .in("user_id", ids)
        .order("full_name", { ascending: true });
      setClients((profiles ?? []) as Client[]);
      setLoadingClients(false);
    })();
  }, [open, barbershopId]);

  // Load services when barber changes
  useEffect(() => {
    if (!selectedBarber) {
      setServices([]);
      setSelectedService("");
      return;
    }
    supabase
      .from("services")
      .select("id, name, duration_minutes, price, barber_id")
      .eq("barbershop_id", barbershopId)
      .eq("barber_id", selectedBarber)
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Service[];
        setServices(list);
        setSelectedService((prev) => (list.find((s) => s.id === prev) ? prev : list[0]?.id ?? ""));
      });
  }, [selectedBarber, barbershopId]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        (c.full_name ?? "").toLowerCase().includes(q) ||
        (c.phone ?? "").toLowerCase().includes(q)
    );
  }, [clients, search]);

  const service = services.find((s) => s.id === selectedService) ?? null;

  // Generate slots from weekly_schedule, then mark conflicts with existing appointments + blocks
  useEffect(() => {
    setSelectedTime("");
    setSlots([]);
    if (!selectedBarber || !service || !date) return;
    setLoadingSlots(true);
    const ctrl = new AbortController();

    (async () => {
      // day_of_week in JS: 0 Sun ... 6 Sat — assume same convention used elsewhere
      const dow = new Date(`${date}T12:00:00`).getDay();

      const [weeklyRes, apptRes, blockRes] = await Promise.all([
        supabase
          .from("weekly_schedule")
          .select("start_time, end_time, is_active")
          .eq("barbershop_id", barbershopId)
          .eq("barber_id", selectedBarber)
          .eq("day_of_week", dow)
          .eq("is_active", true),
        supabase
          .from("appointments")
          .select("start_time, end_time, status")
          .eq("barbershop_id", barbershopId)
          .eq("barber_id", selectedBarber)
          .eq("date", date)
          .neq("status", "cancelled"),
        supabase
          .from("schedule_blocks")
          .select("id")
          .eq("barbershop_id", barbershopId)
          .eq("barber_id", selectedBarber)
          .eq("block_date", date),
      ]);

      if (ctrl.signal.aborted) return;

      const isBlocked = (blockRes.data ?? []).length > 0;
      const windows = (weeklyRes.data ?? []).map((w) => ({
        s: toMin(w.start_time),
        e: toMin(w.end_time),
      }));
      const busy = (apptRes.data ?? []).map((a) => ({
        s: toMin(a.start_time),
        e: toMin(a.end_time),
      }));

      const today = new Date();
      const isToday =
        date ===
        `${today.getFullYear()}-${(today.getMonth() + 1)
          .toString()
          .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      const nowMin = today.getHours() * 60 + today.getMinutes();

      const generated: Slot[] = [];
      if (!isBlocked) {
        for (const w of windows) {
          for (let t = w.s; t + service.duration_minutes <= w.e; t += service.duration_minutes) {
            const slotEnd = t + service.duration_minutes;
            const conflicts = busy.some((b) => t < b.e && slotEnd > b.s);
            const isPast = isToday && t <= nowMin;
            generated.push({
              time: fmtShort(t),
              available: !conflicts && !isPast,
              reason: conflicts ? "ocupado" : isPast ? "passado" : undefined,
            });
          }
        }
      }

      setSlots(generated);
      setLoadingSlots(false);
    })();

    return () => ctrl.abort();
  }, [selectedBarber, service, date, barbershopId]);

  const handleSubmit = async () => {
    if (!selectedClient || !selectedBarber || !service || !selectedTime) {
      toast.error("Preencha todos os campos.");
      return;
    }
    setSubmitting(true);
    const startMin = toMin(selectedTime);
    const endTime = fmt(startMin + service.duration_minutes);

    const { error } = await supabase.from("appointments").insert({
      barbershop_id: barbershopId,
      client_id: selectedClient.user_id,
      barber_id: selectedBarber,
      service_id: service.id,
      date,
      start_time: `${selectedTime}:00`,
      end_time: endTime,
      notes: notes.trim() || null,
    });

    if (error) {
      toast.error(error.message || "Erro ao criar agendamento.");
    } else {
      toast.success("Agendamento criado!");
      onCreated();
      onOpenChange(false);
    }
    setSubmitting(false);
  };

  const canSubmit =
    !!selectedClient && !!selectedBarber && !!service && !!date && !!selectedTime && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Novo agendamento</DialogTitle>
          <DialogDescription>
            Selecione um cliente cadastrado e preencha os detalhes do agendamento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Client picker */}
          <div className="space-y-2">
            <Label>Cliente</Label>
            {selectedClient ? (
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-9 w-9">
                    {selectedClient.avatar_url && <AvatarImage src={selectedClient.avatar_url} />}
                    <AvatarFallback>
                      <User className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {selectedClient.full_name || "Cliente sem nome"}
                    </p>
                    {selectedClient.phone && (
                      <p className="text-xs text-muted-foreground">
                        {displayBRPhone(selectedClient.phone)}
                      </p>
                    )}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                  Trocar
                </Button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nome ou telefone..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <div className="border border-border rounded-lg max-h-56 overflow-y-auto divide-y divide-border">
                  {loadingClients ? (
                    <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando clientes...
                    </div>
                  ) : filteredClients.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      {clients.length === 0
                        ? "Nenhum cliente cadastrado ainda."
                        : "Nenhum cliente corresponde à busca."}
                    </div>
                  ) : (
                    filteredClients.slice(0, 50).map((c) => (
                      <button
                        key={c.user_id}
                        type="button"
                        onClick={() => setSelectedClient(c)}
                        className="w-full text-left p-3 hover:bg-secondary/50 transition-colors flex items-center gap-3"
                      >
                        <Avatar className="h-8 w-8">
                          {c.avatar_url && <AvatarImage src={c.avatar_url} />}
                          <AvatarFallback>
                            <User className="w-4 h-4" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">
                            {c.full_name || "Cliente sem nome"}
                          </p>
                          {c.phone && (
                            <p className="text-xs text-muted-foreground">
                              {displayBRPhone(c.phone)}
                            </p>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Barber */}
          <div className="space-y-2">
            <Label>Barbeiro</Label>
            <Select value={selectedBarber} onValueChange={setSelectedBarber}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um barbeiro" />
              </SelectTrigger>
              <SelectContent>
                {barbers.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Service */}
          <div className="space-y-2">
            <Label>Serviço</Label>
            <Select
              value={selectedService}
              onValueChange={setSelectedService}
              disabled={services.length === 0}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    services.length === 0
                      ? "Sem serviços para este barbeiro"
                      : "Selecione o serviço"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {s.duration_minutes}min · R$ {Number(s.price).toFixed(2)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="ma-date">Data</Label>
            <Input
              id="ma-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Time slots grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Horário disponível
              </Label>
              {service && selectedTime && (
                <Badge variant="outline" className="text-xs">
                  Termina às {fmtShort(toMin(selectedTime) + service.duration_minutes)}
                </Badge>
              )}
            </div>

            {!service ? (
              <div className="p-4 rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                Selecione o serviço para ver os horários.
              </div>
            ) : loadingSlots ? (
              <div className="p-4 rounded-lg border border-border flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Calculando horários...
              </div>
            ) : slots.length === 0 ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/40 text-sm text-muted-foreground">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  Sem horários disponíveis nesta data. Verifique o horário semanal e bloqueios do
                  barbeiro.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
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
                        !slot.available &&
                          "bg-muted/40 border-transparent text-muted-foreground line-through cursor-not-allowed"
                      )}
                      title={
                        slot.available
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
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="ma-notes">Observações (opcional)</Label>
            <Textarea
              id="ma-notes"
              placeholder="Ex: cliente prefere navalha, alergia a perfume..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Criar agendamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
