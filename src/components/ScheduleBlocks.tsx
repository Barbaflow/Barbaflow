import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, CalendarOff, Palmtree, PartyPopper, UserX } from "lucide-react";
import { toast } from "sonner";

interface ScheduleBlocksProps {
  barbershopId: string;
}

interface ScheduleBlock {
  id: string;
  block_date: string;
  reason: string | null;
  block_type: "feriado" | "ferias" | "pessoal";
}

const BLOCK_TYPE_CONFIG = {
  feriado: { label: "Feriado", icon: PartyPopper, color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  ferias: { label: "Férias", icon: Palmtree, color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  pessoal: { label: "Pessoal", icon: UserX, color: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
};

export function ScheduleBlocks({ barbershopId }: ScheduleBlocksProps) {
  const { user } = useAuth();
  const [blocks, setBlocks] = useState<ScheduleBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newBlock, setNewBlock] = useState({
    start_date: "",
    end_date: "",
    reason: "",
    block_type: "pessoal" as "feriado" | "ferias" | "pessoal",
  });

  const fetchBlocks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("schedule_blocks")
      .select("id, block_date, reason, block_type")
      .eq("barbershop_id", barbershopId)
      .eq("barber_id", user.id)
      .gte("block_date", today)
      .order("block_date", { ascending: true });

    if (!error && data) {
      setBlocks(data as ScheduleBlock[]);
    }
    setLoading(false);
  }, [user, barbershopId]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const handleAdd = async () => {
    if (!user) return;
    if (!newBlock.start_date) {
      toast.error("Selecione pelo menos uma data.");
      return;
    }

    const endDate = newBlock.end_date || newBlock.start_date;
    if (endDate < newBlock.start_date) {
      toast.error("Data final deve ser igual ou posterior à data inicial.");
      return;
    }

    // Generate all dates in range
    const dates: string[] = [];
    const current = new Date(newBlock.start_date + "T12:00:00");
    const end = new Date(endDate + "T12:00:00");
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setDate(current.getDate() + 1);
    }

    const rows = dates.map((d) => ({
      barber_id: user.id,
      barbershop_id: barbershopId,
      block_date: d,
      reason: newBlock.reason || null,
      block_type: newBlock.block_type,
    }));

    const { error } = await supabase.from("schedule_blocks").insert(rows);

    if (error) {
      if (error.code === "23505") {
        toast.error("Algumas datas já estão bloqueadas.");
      } else {
        toast.error("Erro ao bloquear datas.");
      }
    } else {
      toast.success(`${dates.length} dia(s) bloqueado(s)!`);
      setDialogOpen(false);
      setNewBlock({ start_date: "", end_date: "", reason: "", block_type: "pessoal" });
      fetchBlocks();
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("schedule_blocks").delete().eq("id", id);
    if (!error) {
      toast.success("Bloqueio removido.");
      setBlocks((prev) => prev.filter((b) => b.id !== id));
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
  };

  // Group consecutive dates with same type/reason
  const grouped: { dates: ScheduleBlock[]; type: string; reason: string | null }[] = [];
  for (const block of blocks) {
    const last = grouped[grouped.length - 1];
    if (
      last &&
      last.type === block.block_type &&
      last.reason === block.reason
    ) {
      const prevDate = new Date(last.dates[last.dates.length - 1].block_date + "T12:00:00");
      const currDate = new Date(block.block_date + "T12:00:00");
      const diffDays = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays === 1) {
        last.dates.push(block);
        continue;
      }
    }
    grouped.push({ dates: [block], type: block.block_type, reason: block.reason });
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground">
            Bloqueios de Agenda
          </h3>
          <p className="text-xs text-muted-foreground">
            Feriados, férias e folgas que sobrepõem seus horários semanais.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="w-4 h-4" />
              Novo Bloqueio
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="font-display">Bloquear Datas</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground">Tipo</Label>
                <Select
                  value={newBlock.block_type}
                  onValueChange={(v) => setNewBlock({ ...newBlock, block_type: v as any })}
                >
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pessoal">🙋 Pessoal</SelectItem>
                    <SelectItem value="ferias">🌴 Férias</SelectItem>
                    <SelectItem value="feriado">🎉 Feriado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Data Início</Label>
                  <Input
                    type="date"
                    value={newBlock.start_date}
                    min={new Date().toISOString().split("T")[0]}
                    onChange={(e) => setNewBlock({ ...newBlock, start_date: e.target.value })}
                    className="bg-background border-border"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data Fim (opcional)</Label>
                  <Input
                    type="date"
                    value={newBlock.end_date}
                    min={newBlock.start_date || new Date().toISOString().split("T")[0]}
                    onChange={(e) => setNewBlock({ ...newBlock, end_date: e.target.value })}
                    className="bg-background border-border"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Motivo (opcional)</Label>
                <Input
                  placeholder="Ex: Natal, Viagem..."
                  value={newBlock.reason}
                  onChange={(e) => setNewBlock({ ...newBlock, reason: e.target.value })}
                  className="bg-background border-border"
                />
              </div>
              <Button
                onClick={handleAdd}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Bloquear
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {grouped.length > 0 ? (
        <div className="space-y-2">
          {grouped.map((group, gi) => {
            const config = BLOCK_TYPE_CONFIG[group.type as keyof typeof BLOCK_TYPE_CONFIG];
            const Icon = config.icon;
            const first = group.dates[0];
            const last = group.dates[group.dates.length - 1];
            const isRange = group.dates.length > 1;

            return (
              <Card key={gi} className="bg-card border-border">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex-shrink-0 p-2 rounded-lg border ${config.color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-foreground">
                            {isRange
                              ? `${formatDate(first.block_date)} → ${formatDate(last.block_date)}`
                              : formatDate(first.block_date)}
                          </span>
                          <Badge variant="secondary" className="text-[10px]">
                            {group.dates.length} dia{group.dates.length > 1 ? "s" : ""}
                          </Badge>
                        </div>
                        {group.reason && (
                          <p className="text-xs text-muted-foreground truncate">{group.reason}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {group.dates.map((b) => (
                        <button
                          key={b.id}
                          onClick={() => handleDelete(b.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          title={`Remover ${formatDate(b.block_date)}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <CalendarOff className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">
            Nenhum bloqueio futuro configurado.
          </p>
          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="w-4 h-4" />
            Adicionar Bloqueio
          </Button>
        </div>
      )}
    </div>
  );
}
