import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Clock,
  Plus,
  Trash2,
  CalendarSync,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

interface WeeklyScheduleEditorProps {
  /** Tenant já resolvido — nunca um id "padrão". Ver useTenantScope. */
  barbershopId: string;
}

interface ScheduleSlot {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

const DAY_NAMES = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

const DAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function WeeklyScheduleEditor({ barbershopId }: WeeklyScheduleEditorProps) {
  const { user } = useAuth();
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newSlot, setNewSlot] = useState({
    day_of_week: 1,
    start_time: "09:00",
    end_time: "18:00",
  });

  const fetchSchedule = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("weekly_schedule")
      .select("id, day_of_week, start_time, end_time, is_active")
      .eq("barbershop_id", barbershopId)
      .eq("barber_id", user.id)
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true });

    if (!error && data) {
      setSchedule(data);
    }
    setLoading(false);
  }, [user, barbershopId]);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  const handleAdd = async () => {
    if (!user) return;

    if (newSlot.start_time >= newSlot.end_time) {
      toast.error("Horário de início deve ser antes do fim.");
      return;
    }

    const { error } = await supabase.from("weekly_schedule").insert({
      barber_id: user.id,
      barbershop_id: barbershopId,
      day_of_week: newSlot.day_of_week,
      start_time: newSlot.start_time + ":00",
      end_time: newSlot.end_time + ":00",
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("Este horário já existe para este dia.");
      } else {
        toast.error("Erro ao adicionar horário.");
      }
    } else {
      toast.success("Horário adicionado!");
      setAddDialogOpen(false);
      fetchSchedule();
    }
  };

  const handleToggle = async (id: string, active: boolean) => {
    const { error } = await supabase
      .from("weekly_schedule")
      .update({ is_active: active })
      // Escopo explícito do tenant: a tela nunca alcança a grade de outra
      // barbearia, mesmo que um id estranho chegue até aqui.
      .eq("barbershop_id", barbershopId)
      .eq("id", id);

    if (error) {
      toast.error("Erro ao atualizar o horário.", { description: error.message });
      return;
    }
    setSchedule((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: active } : s)));
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("weekly_schedule")
      .delete()
      .eq("barbershop_id", barbershopId)
      .eq("id", id);

    if (error) {
      toast.error("Erro ao remover o horário.", { description: error.message });
      return;
    }
    toast.success("Horário removido.");
    setSchedule((prev) => prev.filter((s) => s.id !== id));
  };

  const handleApplyTemplate = async () => {
    if (!user) return;
    const templateSlots = [];
    for (let day = 1; day <= 5; day++) {
      const exists = schedule.some(
        (s) => s.day_of_week === day && s.start_time.slice(0, 5) === "09:00" && s.end_time.slice(0, 5) === "18:00"
      );
      if (!exists) {
        templateSlots.push({
          barber_id: user.id,
          barbershop_id: barbershopId,
          day_of_week: day,
          start_time: "09:00:00",
          end_time: "18:00:00",
        });
      }
    }

    if (templateSlots.length === 0) {
      toast.info("Horário comercial já está configurado (Seg-Sex 09:00-18:00).");
      return;
    }

    const { error } = await supabase.from("weekly_schedule").insert(templateSlots);
    if (error) {
      toast.error("Erro ao aplicar template.");
    } else {
      toast.success(`Template aplicado! ${templateSlots.length} horários adicionados.`);
      fetchSchedule();
    }
  };

  const handleGenerateSlots = async () => {
    if (!user) return;
    setGenerating(true);

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 14);

    const { data, error } = await supabase.rpc("generate_availability_from_schedule", {
      _barber_id: user.id,
      _barbershop_id: barbershopId,
      _start_date: startDate.toISOString().split("T")[0],
      _end_date: endDate.toISOString().split("T")[0],
    });

    if (error) {
      toast.error("Erro ao gerar horários.", { description: error.message });
    } else {
      toast.success(`${data} horários gerados para os próximos 14 dias!`);
    }

    setGenerating(false);
  };

  // Group by day
  const groupedByDay = DAY_NAMES.map((name, idx) => ({
    name,
    short: DAY_SHORT[idx],
    dayIndex: idx,
    slots: schedule.filter((s) => s.day_of_week === idx),
  }));

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground">
            Horários Semanais
          </h3>
          <p className="text-xs text-muted-foreground">
            Defina seus horários recorrentes. Use "Gerar Agenda" para criar slots de disponibilidade.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                <Plus className="w-4 h-4" />
                Novo Horário
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-display">Adicionar Horário</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Dia da Semana</Label>
                  <div className="grid grid-cols-7 gap-1 mt-1.5">
                    {DAY_SHORT.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => setNewSlot({ ...newSlot, day_of_week: i })}
                        className={`text-xs py-2 rounded-md border transition-colors ${
                          newSlot.day_of_week === i
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background border-border text-muted-foreground hover:border-primary/50"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs text-muted-foreground">Início</Label>
                    <Input
                      type="time"
                      value={newSlot.start_time}
                      onChange={(e) =>
                        setNewSlot({ ...newSlot, start_time: e.target.value })
                      }
                      className="bg-background border-border"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Fim</Label>
                    <Input
                      type="time"
                      value={newSlot.end_time}
                      onChange={(e) =>
                        setNewSlot({ ...newSlot, end_time: e.target.value })
                      }
                      className="bg-background border-border"
                    />
                  </div>
                </div>
                <Button
                  onClick={handleAdd}
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Button
            size="sm"
            variant="outline"
            onClick={handleApplyTemplate}
          >
            <Clock className="w-4 h-4" />
            Seg-Sex 9h-18h
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleGenerateSlots}
            disabled={generating || schedule.filter((s) => s.is_active).length === 0}
          >
            {generating ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CalendarSync className="w-4 h-4" />
            )}
            Gerar Agenda
          </Button>
        </div>
      </div>

      {/* Schedule grid */}
      <div className="space-y-2">
        {groupedByDay.map((day) => {
          const hasSlots = day.slots.length > 0;
          const isWeekend = day.dayIndex === 0 || day.dayIndex === 6;

          return (
            <Card
              key={day.dayIndex}
              className={`bg-card border-border ${
                !hasSlots && isWeekend ? "opacity-50" : ""
              }`}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  {/* Day label */}
                  <div className="sm:w-[130px] flex-shrink-0">
                    <span className="text-sm font-medium text-foreground">
                      {day.name}
                    </span>
                  </div>

                  {/* Slots */}
                  <div className="flex-1">
                    {hasSlots ? (
                      <div className="flex flex-wrap gap-2">
                        {day.slots.map((slot) => (
                          <div
                            key={slot.id}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                              slot.is_active
                                ? "bg-primary/10 border-primary/30 text-foreground"
                                : "bg-muted/30 border-border text-muted-foreground line-through"
                            }`}
                          >
                            <Clock className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                            <span className="text-xs font-medium">
                              {slot.start_time.slice(0, 5)} — {slot.end_time.slice(0, 5)}
                            </span>
                            <Switch
                              checked={slot.is_active}
                              onCheckedChange={(v) => handleToggle(slot.id, v)}
                              className="scale-75"
                            />
                            <button
                              onClick={() => handleDelete(slot.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">
                        {isWeekend ? "Folga" : "Nenhum horário definido"}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Info */}
      {schedule.length > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p>
            <strong className="text-foreground">Dica:</strong> Após definir seus horários
            semanais, clique em <strong>"Gerar Agenda"</strong> para criar automaticamente
            os slots de disponibilidade para os próximos 14 dias. Slots já existentes não
            serão duplicados.
          </p>
        </div>
      )}

      {schedule.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <Clock className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">
            Defina seus horários semanais para gerar disponibilidade automaticamente.
          </p>
          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Adicionar Primeiro Horário
          </Button>
        </div>
      )}
    </div>
  );
}
