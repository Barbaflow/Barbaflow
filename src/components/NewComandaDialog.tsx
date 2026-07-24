import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { fetchBarberDisplayNames } from "@/lib/barber-names";
import { friendlyTicketError } from "@/lib/comandas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ReceiptText } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  barbershopId: string;
  /** Chamado com o id da comanda recém-aberta. */
  onOpened: (ticketId: string) => void;
}

interface BarberOption {
  user_id: string;
  name: string;
}
interface ClientOption {
  client_id: string;
  name: string;
}

const NO_CLIENT = "__none__";

export function NewComandaDialog({ open, onOpenChange, barbershopId, onOpened }: Props) {
  const { user } = useAuth();
  const [barbers, setBarbers] = useState<BarberOption[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [barberId, setBarberId] = useState<string>("");
  const [clientId, setClientId] = useState<string>(NO_CLIENT);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false); // trava síncrona contra duplo clique

  useEffect(() => {
    if (!open) return;
    setClientId(NO_CLIENT);

    let cancelled = false;
    (async () => {
      const [barbersRes, clientsRes] = await Promise.all([
        supabase.rpc("get_public_barbers", { _barbershop_id: barbershopId }),
        supabase.rpc("get_barbershop_clients", { _barbershop_id: barbershopId }),
      ]);
      if (cancelled) return;

      const barberIds = ((barbersRes.data ?? []) as { user_id: string }[]).map((r) => r.user_id);
      const nameMap = await fetchBarberDisplayNames(barberIds);
      if (cancelled) return;

      const barberOptions: BarberOption[] = barberIds.map((id) => ({
        user_id: id,
        name: nameMap[id]?.display_name || "Barbeiro",
      }));
      setBarbers(barberOptions);

      // Pré-seleciona o próprio usuário quando ele atende, senão o primeiro.
      const mine = user?.id && barberOptions.some((b) => b.user_id === user.id) ? user.id : "";
      setBarberId(mine || barberOptions[0]?.user_id || "");

      setClients(
        ((clientsRes.data ?? []) as { client_id: string; client_name: string | null }[]).map((c) => ({
          client_id: c.client_id,
          name: c.client_name || "Cliente",
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [open, barbershopId, user?.id]);

  const handleConfirm = async () => {
    if (submittingRef.current) return; // duplo clique: ignora reentrância síncrona
    if (!barberId) {
      toast.error("Selecione o profissional responsável.");
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    try {
      const { data: ticketId, error } = await supabase.rpc("open_ticket", {
        _barbershop_id: barbershopId,
        _barber_id: barberId,
        _client_id: clientId === NO_CLIENT ? undefined : clientId,
      });
      if (error || !ticketId) throw error || new Error("Falha ao abrir comanda");
      toast.success("Comanda aberta.");
      onOpened(ticketId as string);
    } catch (e) {
      console.error(e);
      toast.error(friendlyTicketError(e));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="bg-card border-border max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <ReceiptText className="w-5 h-5 text-primary" /> Nova comanda
          </DialogTitle>
          <DialogDescription>
            Abra uma comanda avulsa. O cliente é opcional; o profissional responsável é obrigatório.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm">Profissional responsável</Label>
            <Select value={barberId} onValueChange={setBarberId}>
              <SelectTrigger className="bg-input">
                <SelectValue placeholder="Selecione o profissional" />
              </SelectTrigger>
              <SelectContent>
                {barbers.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhum profissional cadastrado
                  </div>
                ) : (
                  barbers.map((b) => (
                    <SelectItem key={b.user_id} value={b.user_id}>
                      {b.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm">Cliente (opcional)</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger className="bg-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CLIENT}>Sem cliente</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.client_id} value={c.client_id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="gold" onClick={handleConfirm} disabled={saving || !barberId}>
            {saving ? "Abrindo..." : "Abrir comanda"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
