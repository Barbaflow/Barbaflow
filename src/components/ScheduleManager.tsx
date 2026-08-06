import { useEffect, useId, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { addDaysISO, formatISODateBR, todayISOInTenantTZ, weekdayOfISO } from "@/lib/tz";
import { fetchBarberDisplayNames, type BarberDisplayMap } from "@/lib/barber-names";
import { logTechnicalError } from "@/lib/error-reporting";

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

/**
 * A grade trabalha com datas YYYY-MM-DD, nunca com `Date`.
 *
 * Antes, `formatDate` fazia `date.toISOString().split("T")[0]`: isso converte
 * para UTC ANTES de cortar a data, então em America/Sao_Paulo (UTC−3) qualquer
 * horário a partir das 21:00 já caía no dia seguinte — a semana exibida, o
 * intervalo consultado e o destaque de "hoje" ficavam todos um dia à frente
 * toda noite. `date DATE` no banco não tem fuso; a conta certa é sobre a
 * string, e o "hoje" vem do fuso da barbearia.
 */
function getDaysOfWeekISO(anyDayISO: string): string[] {
  const domingo = addDaysISO(anyDayISO, -weekdayOfISO(anyDayISO));
  return Array.from({ length: 7 }, (_, i) => addDaysISO(domingo, i));
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
  const [weekStartISO, setWeekStartISO] = useState(() => todayISOInTenantTZ());
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newSlot, setNewSlot] = useState({ date: "", start_time: "09:00", end_time: "10:00", status: "livre" as string });
  /** Janela de OUTRA pessoa aguardando confirmação. `null` = nenhum diálogo. */
  const [slotParaApagar, setSlotParaApagar] = useState<AvailabilitySlot | null>(null);
  /**
   * Nome de exibição por `user_id`. Esta tela sempre leu a barbearia INTEIRA
   * (nunca houve filtro por `barber_id`), e até aqui desenhava tudo misturado,
   * sem dizer de quem era cada faixa. Com dois profissionais na mesma semana o
   * resultado era indistinguível.
   */
  const [nomes, setNomes] = useState<BarberDisplayMap>({});

  const days = getDaysOfWeekISO(weekStartISO);
  const startDate = days[0];
  const endDate = days[6];
  const hoje = todayISOInTenantTZ();

  const fetchData = useCallback(async () => {

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

    // Um lote só para as duas listas: os ids se repetem bastante entre elas, e
    // `fetchBarberDisplayNames` já deduplica.
    const ids = [
      ...(avail.data ?? []).map((s) => s.barber_id),
      ...(appts.data ?? []).map((a) => a.barber_id),
    ].filter(Boolean);
    if (ids.length > 0) setNomes(await fetchBarberDisplayNames(ids));
  }, [barbershopId, startDate, endDate]);

  /**
   * Nome do dono da linha. Degrada como o resto do projeto: quando a RPC de
   * nomes não devolve o id, o rótulo vira "Profissional" em vez de sumir — uma
   * faixa sem dono identificado é pior que uma com dono genérico, porque
   * reintroduz a mistura que esta mudança existe para acabar.
   */
  const nomeDoDono = (barberId: string) =>
    barberId === user?.id ? "Você" : nomes[barberId]?.display_name || "Profissional";

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // O callback do canal sempre chama a versão mais recente de fetchData sem
  // que `fetchData` precise entrar nas dependências do efeito: se entrasse,
  // trocar de semana derrubaria e recriaria o canal.
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  // Realtime.
  //
  // O tópico inclui um id ÚNICO por instância do componente. O cliente Supabase
  // deduplica canais por tópico (RealtimeClient.channel → channels.find) e
  // devolve o mesmo objeto já inscrito; um segundo consumidor do mesmo tópico
  // que chamasse `.on("postgres_changes", …)` receberia
  // "cannot add postgres_changes callbacks after subscribe()" — o mesmo defeito
  // já corrigido em usePlan. Com id por instância, duas telas (ou duas abas do
  // mesmo app) nunca disputam o mesmo canal.
  const instanceId = useId();
  useEffect(() => {
    if (!barbershopId) return;

    const channel = supabase
      .channel(`schedule-${barbershopId}-${instanceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "availability", filter: `barbershop_id=eq.${barbershopId}` }, () => fetchDataRef.current())
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `barbershop_id=eq.${barbershopId}` }, () => fetchDataRef.current())
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [barbershopId, instanceId]);

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

  /**
   * Apaga direto quando a janela é DO PRÓPRIO usuário; pede confirmação quando
   * é de outra pessoa.
   *
   * A tela mostra a barbearia inteira, e o admin pode apagar linha de qualquer
   * profissional (policy de `availability`). Fazer isso com um clique de `x`
   * idêntico ao da própria linha é apagar agenda alheia sem que a pessoa saiba
   * — o diálogo existe para tornar a decisão explícita, e para dizer DE QUEM é
   * a janela antes do irreversível.
   */
  const pedirParaApagar = (slot: AvailabilitySlot) => {
    if (slot.barber_id === user?.id) {
      apagarSlot(slot);
      return;
    }
    setSlotParaApagar(slot);
  };

  const apagarSlot = async (slot: AvailabilitySlot) => {
    // `.select("id")` não é enfeite: é o que torna a recusa DETECTÁVEL.
    //
    // Num DELETE, a RLS do Postgres não levanta 42501 — ela FILTRA as linhas
    // que o `USING` não deixa passar, e o comando sucede afetando zero. Sem
    // pedir as linhas de volta, `error` vem nulo e não há como distinguir
    // "apagou" de "não tinha permissão": a tela dizia "Removido!" e a faixa
    // continuava lá depois do refetch. Falso sucesso, não erro silencioso.
    //
    // Medido no banco em 06/08/2026, com a 20260806150000 já aplicada: um
    // barbeiro apagando faixa alheia devolve 0 linhas e NENHUMA exceção.
    //
    // As duas formas de recusa precisam ser tratadas, e são diferentes:
    //   • `error` preenchido  — falha de rede, constraint, ou o mock, que
    //     modela autorização como erro;
    //   • zero linhas         — a RLS do banco real, que modela como sucesso
    //     vazio.
    const { data, error } = await supabase
      .from("availability")
      .delete()
      .eq("id", slot.id)
      .select("id");

    if (error) {
      logTechnicalError("ScheduleManager", "remover disponibilidade", error);
      toast.error("Não foi possível remover este horário.");
      return;
    }

    if (!data || data.length === 0) {
      // Duas causas possíveis e indistinguíveis pela resposta: a RLS recusou,
      // ou a linha já não existia (outra pessoa apagou antes). A mensagem cobre
      // a primeira, que é a que a pessoa pode corrigir; o `fetchData()` resolve
      // a tela nos dois casos, porque ressincroniza com o que o banco tem.
      toast.error("Você só pode remover os seus próprios horários.");
      fetchData();
      return;
    }

    toast.success("Removido!");
    fetchData();
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

  const slotsForDay = (dateISO: string) => availability.filter((s) => s.date === dateISO);
  const apptsForDay = (dateISO: string) => appointments.filter((a) => a.date === dateISO);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setWeekStartISO((w) => addDaysISO(w, -7))}>
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <h3 className="font-display text-lg font-semibold">
            Semana de {formatISODateBR(days[0])} — {formatISODateBR(days[6])}
          </h3>
          <Button variant="ghost" size="icon" onClick={() => setWeekStartISO((w) => addDaysISO(w, 7))}>
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
          const isToday = day === hoje;

          return (
            <Card key={i} className={`bg-card border-border min-h-[200px] ${isToday ? "border-gold" : ""}`}>
              <CardHeader className="p-3 pb-2">
                <CardTitle className={`text-xs uppercase tracking-wider ${isToday ? "text-gold" : "text-muted-foreground"}`}>
                  {WEEKDAY_NAMES[i]} {day.slice(8, 10)}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 space-y-1">
                {/* Availability slots */}
                {slots.map((slot) => (
                  <div key={slot.id} className={`text-[10px] px-2 py-1 rounded border ${STATUS_COLORS[slot.status] || ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="min-w-0 truncate">{slot.start_time.slice(0, 5)}-{slot.end_time.slice(0, 5)}</span>
                      <button
                        onClick={() => pedirParaApagar(slot)}
                        className="shrink-0 opacity-50 hover:opacity-100"
                        title={`Remover horário de ${nomeDoDono(slot.barber_id)}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    {/* De quem é esta faixa. `truncate` + `min-w-0` porque nome
                        longo numa coluna de dia da semana estoura a célula. */}
                    <p className="min-w-0 truncate opacity-70">{nomeDoDono(slot.barber_id)}</p>
                  </div>
                ))}
                {/* Appointments */}
                {appts.map((appt) => (
                  <div key={appt.id} className={`text-[10px] px-2 py-1 rounded border ${STATUS_COLORS[appt.status] || ""}`}>
                    <div className="flex items-center justify-between gap-1">
                      <span className="min-w-0 truncate">{appt.start_time.slice(0, 5)}-{appt.end_time.slice(0, 5)}</span>
                      {appt.status === "scheduled" && (
                        <button
                          onClick={() => cancelAppointment(appt.id)}
                          className="shrink-0 opacity-50 hover:opacity-100"
                          title={`Cancelar agendamento de ${nomeDoDono(appt.barber_id)}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="min-w-0 truncate opacity-70">{nomeDoDono(appt.barber_id)}</p>
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

      {/* Só aparece para janela de OUTRA pessoa — a própria é apagada direto,
          sem cerimônia. O texto nomeia o dono, o dia e o horário porque a
          coluna do dia é estreita e o clique pode ter sido no item errado. */}
      <AlertDialog open={slotParaApagar !== null} onOpenChange={(aberto) => !aberto && setSlotParaApagar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover horário de outro profissional?</AlertDialogTitle>
            <AlertDialogDescription>
              {slotParaApagar && (
                <>
                  Este horário é de <strong>{nomeDoDono(slotParaApagar.barber_id)}</strong> —{" "}
                  {formatISODateBR(slotParaApagar.date)}, das{" "}
                  {slotParaApagar.start_time.slice(0, 5)} às {slotParaApagar.end_time.slice(0, 5)}.
                  Removê-lo tira essa faixa da agenda dessa pessoa, e ela não é avisada.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const alvo = slotParaApagar;
                setSlotParaApagar(null);
                if (alvo) apagarSlot(alvo);
              }}
            >
              Remover mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
