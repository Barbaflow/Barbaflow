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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  User,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  CalendarIcon,
  Ban,
  ShieldAlert,
  UserPlus,
  ArrowLeft,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { displayBRPhone, maskBRPhone, toStorageBRPhone, isValidBRPhone } from "@/lib/phone";

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

export interface EditAppointmentInput {
  id: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS or HH:MM
  barber_id: string;
  service_id: string;
  client_id: string;
  client_full_name: string | null;
  client_phone: string | null;
  client_avatar_url: string | null;
  notes: string | null;
}

interface ManualAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  barbershopId: string;
  barbers: Barber[];
  defaultDate: string;
  onCreated: () => void;
  editAppointment?: EditAppointmentInput | null;
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
  editAppointment = null,
}: ManualAppointmentDialogProps) {
  const isEditing = !!editAppointment;
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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Quick-add walk-in client form
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  // Track the most recently created walk-in client (to show "Invite via WhatsApp" CTA)
  const [lastWalkinId, setLastWalkinId] = useState<string | null>(null);
  const [shopInfo, setShopInfo] = useState<{ name: string; subdomain: string | null } | null>(null);
  // Map clientId -> noshow block info (loaded after clients load)
  const [blockMap, setBlockMap] = useState<Map<string, { blocked: boolean; unblock_at: string | null; noshow_count: number; max_count: number }>>(new Map());

  // Reset on open — populate from editAppointment when editing
  useEffect(() => {
    if (!open) return;
    if (editAppointment) {
      setSearch("");
      setSelectedClient({
        user_id: editAppointment.client_id,
        full_name: editAppointment.client_full_name,
        phone: editAppointment.client_phone,
        avatar_url: editAppointment.client_avatar_url,
      });
      setSelectedBarber(editAppointment.barber_id);
      setSelectedService(editAppointment.service_id);
      setDate(editAppointment.date);
      setSelectedTime(editAppointment.start_time.slice(0, 5));
      setNotes(editAppointment.notes ?? "");
      setSlots([]);
    } else {
      setSearch("");
      setSelectedClient(null);
      setSelectedBarber(barbers[0]?.id ?? "");
      setSelectedService("");
      setDate(defaultDate);
      setSelectedTime("");
      setNotes("");
      setSlots([]);
    }
    // Reset quick-add form whenever dialog opens
    setShowQuickAdd(false);
    setNewClientName("");
    setNewClientPhone("");
    setLastWalkinId(null);
  }, [open, defaultDate, barbers, editAppointment]);

  // Load clients with prior appointments at this barbershop
  useEffect(() => {
    if (!open) return;
    setLoadingClients(true);
    setBlockMap(new Map());
    // Load barbershop name + subdomain for the WhatsApp invite link
    supabase
      .from("barbershops")
      .select("name, subdomain")
      .eq("id", barbershopId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setShopInfo({ name: data.name, subdomain: data.subdomain ?? null });
      });
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

      // Batch-check noshow block status (parallel RPCs, one per client)
      const results = await Promise.all(
        ids.map((cid) =>
          supabase.rpc("check_client_noshow_block", {
            _client_id: cid,
            _barbershop_id: barbershopId,
          }).then(({ data }) => [cid, data] as const)
        )
      );
      const map = new Map<string, any>();
      for (const [cid, data] of results) {
        const d = (data as any) ?? {};
        if (d.blocked) {
          map.set(cid, {
            blocked: true,
            unblock_at: d.unblock_at ?? null,
            noshow_count: d.noshow_count ?? 0,
            max_count: d.max_count ?? 0,
          });
        }
      }
      setBlockMap(map);
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

  // Load active weekdays + blocked dates whenever barber changes (powers the calendar)
  useEffect(() => {
    if (!selectedBarber) {
      setActiveWeekdays(new Set());
      setBlockedDates(new Set());
      return;
    }
    (async () => {
      const today = new Date();
      const horizon = new Date();
      horizon.setMonth(horizon.getMonth() + 6);

      const [wkRes, blkRes] = await Promise.all([
        supabase
          .from("weekly_schedule")
          .select("day_of_week, is_active")
          .eq("barbershop_id", barbershopId)
          .eq("barber_id", selectedBarber)
          .eq("is_active", true),
        supabase
          .from("schedule_blocks")
          .select("block_date")
          .eq("barbershop_id", barbershopId)
          .eq("barber_id", selectedBarber)
          .gte("block_date", dateToISO(today))
          .lte("block_date", dateToISO(horizon)),
      ]);

      setActiveWeekdays(new Set((wkRes.data ?? []).map((w) => w.day_of_week as number)));
      setBlockedDates(new Set((blkRes.data ?? []).map((b) => b.block_date as string)));
    })();
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

  // Generate slots from weekly_schedule, then mark conflicts with existing appointments + blocks.
  // Preserve the currently selected slot if it's still valid (esp. relevant when editing).
  useEffect(() => {
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
          .select("id, start_time, end_time, status")
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
      // Exclude the appointment being edited from "busy" so its own slot stays free
      const busy = (apptRes.data ?? [])
        .filter((a) => !editAppointment || a.id !== editAppointment.id)
        .map((a) => ({
          s: toMin(a.start_time),
          e: toMin(a.end_time),
        }));

      const today = new Date();
      const todayISO = `${today.getFullYear()}-${(today.getMonth() + 1)
        .toString()
        .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
      const isToday = date === todayISO;
      const isPastDate = date < todayISO;
      const nowMin = today.getHours() * 60 + today.getMinutes();

      const generated: Slot[] = [];
      if (!isBlocked) {
        for (const w of windows) {
          for (let t = w.s; t + service.duration_minutes <= w.e; t += service.duration_minutes) {
            const slotEnd = t + service.duration_minutes;
            const conflicts = busy.some((b) => t < b.e && slotEnd > b.s);
            // Datas passadas: todos os horários ficam disponíveis (encaixe no histórico)
            const isPast = isToday && t <= nowMin && !isPastDate;
            generated.push({
              time: fmtShort(t),
              available: !conflicts && !isPast,
              reason: conflicts ? "ocupado" : isPast ? "passado" : undefined,
            });
          }
        }
      }

      setSlots(generated);
      // If current selection no longer exists/available, clear it
      setSelectedTime((prev) => {
        if (!prev) return prev;
        const match = generated.find((s) => s.time === prev);
        return match && match.available ? prev : "";
      });
      setLoadingSlots(false);
    })();

    return () => ctrl.abort();
  }, [selectedBarber, service, date, barbershopId, editAppointment]);

  const handleCreateClient = async () => {
    const name = newClientName.trim();
    if (!name) {
      toast.error("Informe o nome do cliente.");
      return;
    }
    const phoneRaw = newClientPhone.trim();
    if (phoneRaw && !isValidBRPhone(phoneRaw)) {
      toast.error("Telefone inválido. Use o formato (11) 91234-5678.");
      return;
    }
    setCreatingClient(true);
    const { data: newId, error } = await supabase.rpc("create_walkin_client", {
      _barbershop_id: barbershopId,
      _full_name: name,
      _phone: phoneRaw ? toStorageBRPhone(phoneRaw) : undefined,
    });
    if (error || !newId) {
      const msg = error?.message ?? "";
      if (msg.includes("forbidden")) toast.error("Você não tem permissão para cadastrar clientes nesta barbearia.");
      else if (msg.includes("name_required")) toast.error("Nome é obrigatório.");
      else if (msg.includes("name_too_long")) toast.error("Nome muito longo (máximo 120 caracteres).");
      else if (msg.includes("phone_too_long")) toast.error("Telefone muito longo.");
      else toast.error(msg || "Erro ao cadastrar cliente.");
      setCreatingClient(false);
      return;
    }
    const created: Client = {
      user_id: newId as string,
      full_name: name,
      phone: phoneRaw ? toStorageBRPhone(phoneRaw) : null,
      avatar_url: null,
    };
    setClients((prev) => [created, ...prev]);
    setSelectedClient(created);
    setLastWalkinId(newId as string);
    setShowQuickAdd(false);
    setNewClientName("");
    setNewClientPhone("");
    setCreatingClient(false);
    toast.success("Cliente cadastrado!");
  };

  const handleSubmit = async () => {
    if (!selectedClient || !selectedBarber || !service || !selectedTime) {
      toast.error("Preencha todos os campos.");
      return;
    }
    setSubmitting(true);
    const startMin = toMin(selectedTime);
    const endTime = fmt(startMin + service.duration_minutes);

    const today = new Date();
    const todayISO = `${today.getFullYear()}-${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
    const isPastDate = date < todayISO;

    const payload: any = {
      barbershop_id: barbershopId,
      client_id: selectedClient.user_id,
      barber_id: selectedBarber,
      service_id: service.id,
      date,
      start_time: `${selectedTime}:00`,
      end_time: endTime,
      notes: notes.trim() || null,
    };

    // Encaixe / pré-registro de histórico: datas passadas entram como concluído
    if (isPastDate && !isEditing) {
      payload.status = "completed";
    }

    const { error } = isEditing
      ? await supabase.from("appointments").update(payload).eq("id", editAppointment!.id)
      : await supabase.from("appointments").insert(payload);

    if (error) {
      toast.error(error.message || (isEditing ? "Erro ao atualizar." : "Erro ao criar agendamento."));
    } else {
      toast.success(isEditing ? "Agendamento atualizado!" : "Agendamento criado!");
      onCreated();
      onOpenChange(false);
    }
    setSubmitting(false);
  };

  const handleCancelAppointment = async () => {
    if (!editAppointment) return;
    setCancelling(true);
    const { error } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", editAppointment.id);
    if (error) {
      toast.error(error.message || "Erro ao cancelar agendamento.");
    } else {
      toast.success("Agendamento cancelado. O cliente será notificado.");
      onCreated();
      setCancelOpen(false);
      onOpenChange(false);
    }
    setCancelling(false);
  };

  const canSubmit =
    !!selectedClient && !!selectedBarber && !!service && !!date && !!selectedTime && !submitting;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEditing ? "Editar agendamento" : "Novo agendamento"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Altere data, hora, barbeiro ou serviço deste agendamento."
              : "Selecione um cliente cadastrado e preencha os detalhes do agendamento."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Client picker */}
          <div className="space-y-2">
            <Label>Cliente</Label>
            {selectedClient ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-9 w-9">
                      {selectedClient.avatar_url && <AvatarImage src={selectedClient.avatar_url} />}
                      <AvatarFallback>
                        <User className="w-4 h-4" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground truncate">
                          {selectedClient.full_name || "Cliente sem nome"}
                        </p>
                        {blockMap.get(selectedClient.user_id)?.blocked && (
                          <Badge variant="destructive" className="h-5 text-[10px] gap-1 px-1.5">
                            <ShieldAlert className="w-3 h-3" />
                            Bloqueado
                          </Badge>
                        )}
                      </div>
                      {selectedClient.phone && (
                        <p className="text-xs text-muted-foreground">
                          {displayBRPhone(selectedClient.phone)}
                        </p>
                      )}
                    </div>
                  </div>
                  {!isEditing && (
                    <Button variant="ghost" size="sm" onClick={() => setSelectedClient(null)}>
                      Trocar
                    </Button>
                  )}
                </div>

                {(() => {
                  const block = blockMap.get(selectedClient.user_id);
                  if (!block?.blocked) return null;
                  const unblock = block.unblock_at ? new Date(block.unblock_at) : null;
                  return (
                    <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/10 text-xs text-foreground">
                      <ShieldAlert className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                      <div className="leading-relaxed">
                        <p className="font-medium text-destructive">
                          Cliente bloqueado por no-show
                        </p>
                        <p className="text-muted-foreground mt-0.5">
                          {block.noshow_count} {block.noshow_count === 1 ? "falta" : "faltas"} nos últimos 30 dias
                          {unblock && (
                            <> · desbloqueia em <span className="text-foreground font-medium">{format(unblock, "dd/MM 'às' HH:mm", { locale: ptBR })}</span></>
                          )}
                          . Você pode agendar manualmente, mas confirme com o cliente antes.
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {/* WhatsApp invite for newly-created walk-in clients */}
                {selectedClient.user_id === lastWalkinId && shopInfo && (() => {
                  const shopName = shopInfo.name;
                  const link = shopInfo.subdomain
                    ? `https://${shopInfo.subdomain}.barbaflow.pro`
                    : `https://barbaflow.pro`;
                  const greeting = selectedClient.full_name?.split(" ")[0] || "Olá";
                  const message =
                    `Olá, ${greeting}! 👋\n\n` +
                    `Você foi cadastrado(a) na *${shopName}*. ` +
                    `Baixe o app para acompanhar seus agendamentos, receber lembretes e avaliar seus atendimentos:\n\n` +
                    `${link}\n\n` +
                    `Até breve! ✂️`;
                  // Normaliza qualquer formato salvo (com máscara, espaços, etc.) para "55DDDNUMERO"
                  const waNumber = selectedClient.phone ? toStorageBRPhone(selectedClient.phone) : "";
                  // Válido apenas com 12 (fixo) ou 13 (celular) dígitos incluindo DDI 55
                  const isValidWa = waNumber.length === 12 || waNumber.length === 13;
                  const encodedMessage = encodeURIComponent(message);
                  // api.whatsapp.com/send abre a conversa com a mensagem pré-preenchida de forma confiável
                  // tanto no mobile (deep link) quanto no desktop (WhatsApp Web)
                  const url = isValidWa
                    ? `https://api.whatsapp.com/send?phone=${waNumber}&text=${encodedMessage}`
                    : `https://api.whatsapp.com/send?text=${encodedMessage}`;
                  return (
                    <div className="flex items-start gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
                      <MessageCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0 space-y-2">
                        <p className="text-xs text-foreground leading-relaxed">
                          <span className="font-medium">Cliente cadastrado!</span>{" "}
                          {isValidWa
                            ? "Envie o link do app para ele acompanhar os agendamentos."
                            : selectedClient.phone
                              ? "Telefone inválido — abra o WhatsApp e envie a mensagem manualmente."
                              : "Sem telefone cadastrado — você pode copiar a mensagem e enviar manualmente."}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs border-primary/40 hover:bg-primary/10"
                          onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
                        >
                          <MessageCircle className="w-3 h-3 mr-1.5" />
                          Convidar para baixar o app
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : showQuickAdd ? (
              <div className="space-y-3 border border-border rounded-lg p-4 bg-secondary/30">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    <UserPlus className="w-4 h-4 text-primary" />
                    Cadastrar novo cliente
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => {
                      setShowQuickAdd(false);
                      setNewClientName("");
                      setNewClientPhone("");
                    }}
                    disabled={creatingClient}
                  >
                    <ArrowLeft className="w-3 h-3 mr-1" />
                    Voltar
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-client-name" className="text-xs">
                    Nome <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="new-client-name"
                    placeholder="Ex: João Silva"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    maxLength={120}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-client-phone" className="text-xs">
                    Telefone (opcional)
                  </Label>
                  <Input
                    id="new-client-phone"
                    placeholder="(11) 91234-5678"
                    value={newClientPhone}
                    onChange={(e) => setNewClientPhone(maskBRPhone(e.target.value))}
                    inputMode="tel"
                  />
                </div>
                <div className="rounded-md bg-muted/50 border border-border p-2 text-[11px] text-muted-foreground leading-relaxed">
                  Cliente presencial (sem login). Você poderá enviar o link da
                  barbearia por WhatsApp depois para ele criar a conta e
                  acompanhar os agendamentos pelo app.
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="w-full"
                  onClick={handleCreateClient}
                  disabled={creatingClient || !newClientName.trim()}
                >
                  {creatingClient ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-2 animate-spin" />
                      Cadastrando...
                    </>
                  ) : (
                    <>
                      <Check className="w-3 h-3 mr-2" />
                      Cadastrar e selecionar
                    </>
                  )}
                </Button>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por nome ou telefone..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowQuickAdd(true)}
                    className="flex-shrink-0"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span className="hidden sm:inline ml-1">Novo</span>
                  </Button>
                </div>
                <div className="border border-border rounded-lg max-h-56 overflow-y-auto divide-y divide-border">
                  {loadingClients ? (
                    <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Carregando clientes...
                    </div>
                  ) : filteredClients.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground space-y-2">
                      <p>
                        {clients.length === 0
                          ? "Nenhum cliente cadastrado ainda."
                          : "Nenhum cliente corresponde à busca."}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowQuickAdd(true);
                          // Pré-preenche com o termo buscado se parecer com nome
                          if (search.trim() && !/\d/.test(search)) {
                            setNewClientName(search.trim());
                          }
                        }}
                      >
                        <UserPlus className="w-3 h-3 mr-1" />
                        Cadastrar novo cliente
                      </Button>
                    </div>
                  ) : (
                    filteredClients.slice(0, 50).map((c) => {
                      const isBlocked = blockMap.get(c.user_id)?.blocked;
                      return (
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
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-foreground truncate">
                                {c.full_name || "Cliente sem nome"}
                              </p>
                              {isBlocked && (
                                <Badge variant="destructive" className="h-4 text-[9px] gap-0.5 px-1 flex-shrink-0">
                                  <ShieldAlert className="w-2.5 h-2.5" />
                                  Bloqueado
                                </Badge>
                              )}
                            </div>
                            {c.phone && (
                              <p className="text-xs text-muted-foreground">
                                {displayBRPhone(c.phone)}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })
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
            <Label>Data</Label>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!selectedBarber}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date
                    ? format(isoToDate(date), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })
                    : "Selecione uma data"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  locale={ptBR}
                  selected={date ? isoToDate(date) : undefined}
                  onSelect={(d) => {
                    if (d) {
                      setDate(dateToISO(d));
                      setDatePickerOpen(false);
                    }
                  }}
                  disabled={(d) => {
                    // Datas passadas são permitidas (encaixe / pré-registro no histórico)
                    if (activeWeekdays.size > 0 && !activeWeekdays.has(d.getDay())) return true;
                    if (blockedDates.has(dateToISO(d))) return true;
                    return false;
                  }}
                  modifiers={{
                    blocked: (d) => blockedDates.has(dateToISO(d)),
                    closed: (d) =>
                      activeWeekdays.size > 0 && !activeWeekdays.has(d.getDay()),
                  }}
                  modifiersClassNames={{
                    blocked:
                      "relative text-destructive line-through opacity-60 after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:bg-destructive/60 after:rounded-full",
                    closed: "text-muted-foreground/50 italic",
                  }}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
                <div className="px-3 pb-3 pt-0 flex flex-wrap gap-3 text-[11px] text-muted-foreground border-t border-border/40">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary/70" /> Disponível
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="italic">Ter</span> Sem expediente
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="line-through text-destructive">15</span> Bloqueado
                  </span>
                </div>
              </PopoverContent>
            </Popover>
            {!selectedBarber && (
              <p className="text-xs text-muted-foreground">
                Selecione um barbeiro para ver os dias disponíveis.
              </p>
            )}
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

        <DialogFooter className="gap-2 sm:gap-2">
          {isEditing && (
            <Button
              variant="destructive"
              onClick={() => setCancelOpen(true)}
              disabled={submitting || cancelling}
              className="sm:mr-auto"
            >
              <Ban className="w-4 h-4" />
              Cancelar agendamento
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting || cancelling}>
            Fechar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || cancelling}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {isEditing ? "Salvar alterações" : "Criar agendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Cancelar este agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O agendamento será marcado como cancelado e o cliente
              {selectedClient?.full_name ? ` (${selectedClient.full_name})` : ""} receberá uma
              notificação automática. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleCancelAppointment();
              }}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
              Sim, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
