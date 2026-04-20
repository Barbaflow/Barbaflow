import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ShieldAlert, ShieldCheck, RefreshCw, Ban, Unlock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface NoShowReportProps {
  barbershopId: string;
}

interface ReportRow {
  client_id: string;
  client_name: string;
  client_avatar: string | null;
  noshow_count: number;
  total_appointments: number;
  last_noshow_at: string | null;
  manual_blocked_until: string | null;
  manual_block_reason: string | null;
}

type StatusFilter = "all" | "blocked" | "active";

export function NoShowReport({ barbershopId }: NoShowReportProps) {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<30 | 90>(30);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [blockTarget, setBlockTarget] = useState<ReportRow | null>(null);
  const [blockDays, setBlockDays] = useState(15);
  const [blockReason, setBlockReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Confirm admin role before doing anything
  useEffect(() => {
    if (!user || !barbershopId) return;
    supabase
      .rpc("has_role_in_barbershop", {
        _user_id: user.id,
        _barbershop_id: barbershopId,
        _role: "admin_barbearia",
      })
      .then(({ data }) => setIsAdmin(Boolean(data)));
  }, [user, barbershopId]);

  const fetchReport = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_noshow_report", {
      _barbershop_id: barbershopId,
      _days: period,
    });
    if (error) {
      toast.error("Não foi possível carregar o relatório");
      setLoading(false);
      return;
    }
    setRows((data as ReportRow[]) || []);
    setLoading(false);
  }, [isAdmin, barbershopId, period]);

  useEffect(() => {
    if (isAdmin) fetchReport();
  }, [isAdmin, fetchReport]);

  const handleBlock = async () => {
    if (!blockTarget || !user) return;
    if (blockDays < 1 || blockDays > 365) {
      toast.error("Informe entre 1 e 365 dias");
      return;
    }
    setSubmitting(true);
    const blockedUntil = new Date(Date.now() + blockDays * 86_400_000).toISOString();
    const { error } = await supabase.from("client_blocks").insert({
      barbershop_id: barbershopId,
      client_id: blockTarget.client_id,
      blocked_until: blockedUntil,
      reason: blockReason.trim() || null,
      blocked_by: user.id,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Erro ao bloquear cliente");
      return;
    }
    toast.success("Cliente bloqueado", {
      description: `Liberado em ${format(new Date(blockedUntil), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`,
    });
    setBlockTarget(null);
    setBlockReason("");
    setBlockDays(15);
    fetchReport();
  };

  const handleUnblock = async (row: ReportRow) => {
    const { error } = await supabase
      .from("client_blocks")
      .delete()
      .eq("barbershop_id", barbershopId)
      .eq("client_id", row.client_id)
      .gt("blocked_until", new Date().toISOString());
    if (error) {
      toast.error("Erro ao desbloquear");
      return;
    }
    toast.success(`${row.client_name} desbloqueado`);
    fetchReport();
  };

  if (isAdmin === null) return null;
  if (!isAdmin) return null;

  const filtered = rows.filter((r) => {
    if (statusFilter === "blocked") return Boolean(r.manual_blocked_until);
    if (statusFilter === "active") return !r.manual_blocked_until && r.noshow_count >= 1;
    return true;
  });

  return (
    <div>
      <h2 className="text-2xl font-display font-bold text-foreground mb-2">
        <span className="text-gradient-gold">Relatório de no-shows</span>
      </h2>
      <p className="text-muted-foreground mb-6">
        Clientes com mais faltas no período. Use o bloqueio manual para impedir novos agendamentos por um período definido.
      </p>

      <Card className="p-5 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Período</Label>
            <Select value={String(period)} onValueChange={(v) => setPeriod(Number(v) as 30 | 90)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <Label className="text-xs text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="blocked">Apenas bloqueados</SelectItem>
                <SelectItem value="active">Ativos com 1+ falta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={fetchReport} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? "Nenhum cliente com faltas no período selecionado. 🎉"
              : "Nenhum cliente corresponde ao filtro."}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((row) => {
              const blocked = Boolean(row.manual_blocked_until);
              const rate = row.total_appointments > 0
                ? Math.round((row.noshow_count / row.total_appointments) * 100)
                : 0;
              return (
                <div
                  key={row.client_id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/40"
                >
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={row.client_avatar || undefined} />
                    <AvatarFallback>{row.client_name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-foreground truncate">{row.client_name}</p>
                      {blocked && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                          <ShieldAlert className="w-3 h-3" />
                          Bloqueado
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {row.noshow_count} falta{row.noshow_count > 1 ? "s" : ""} de{" "}
                      {row.total_appointments} agendamento{row.total_appointments > 1 ? "s" : ""} ({rate}%)
                      {row.last_noshow_at && (
                        <> · última: {format(new Date(row.last_noshow_at), "dd/MM/yy", { locale: ptBR })}</>
                      )}
                      {blocked && row.manual_blocked_until && (
                        <> · libera em {format(new Date(row.manual_blocked_until), "dd/MM 'às' HH:mm", { locale: ptBR })}</>
                      )}
                    </p>
                  </div>
                  {blocked ? (
                    <Button size="sm" variant="outline" onClick={() => handleUnblock(row)}>
                      <Unlock className="w-3.5 h-3.5" />
                      Desbloquear
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => setBlockTarget(row)}>
                      <Ban className="w-3.5 h-3.5" />
                      Bloquear
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Dialog open={Boolean(blockTarget)} onOpenChange={(o) => !o && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              Bloquear {blockTarget?.client_name}
            </DialogTitle>
            <DialogDescription>
              Enquanto bloqueado, o cliente não conseguirá criar novos agendamentos nesta barbearia.
              Você ainda pode agendar manualmente por ele se necessário.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="block-days">Dias de bloqueio</Label>
              <Input
                id="block-days"
                type="number"
                min={1}
                max={365}
                value={blockDays}
                onChange={(e) => setBlockDays(Number(e.target.value))}
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Libera em{" "}
                {format(new Date(Date.now() + blockDays * 86_400_000), "dd/MM/yyyy 'às' HH:mm", {
                  locale: ptBR,
                })}
              </p>
            </div>
            <div>
              <Label htmlFor="block-reason">Motivo (opcional)</Label>
              <Textarea
                id="block-reason"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Ex: 3 faltas seguidas sem aviso"
                className="mt-1.5"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockTarget(null)} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleBlock} disabled={submitting}>
              <ShieldCheck className="w-4 h-4" />
              Confirmar bloqueio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
