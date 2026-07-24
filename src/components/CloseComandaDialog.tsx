import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtBRL, friendlyTicketError } from "@/lib/comandas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CreditCard, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  barbershopId: string;
  ticket: { id: string; subtotal: number; discount_amount: number; total: number } | null;
  /** Resumo dos itens já persistidos, só para conferência (somente leitura). */
  items: { id: string; description: string; quantity: number; total: number }[];
  onClosed: () => void;
}

interface PaymentMethodRow {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}
interface DraftPayment {
  key: string;
  payment_method_id: string | null;
  method_name: string;
  amount: number;
}

const uid = () => Math.random().toString(36).slice(2);

export function CloseComandaDialog({ open, onOpenChange, barbershopId, ticket, items, onClosed }: Props) {
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [payments, setPayments] = useState<DraftPayment[]>([]);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);

  const total = Number(ticket?.total ?? 0);

  useEffect(() => {
    if (!open) return;
    setPayments([]);
    let cancelled = false;
    supabase
      .from("payment_methods")
      .select("id,name,active,sort_order")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => {
        if (!cancelled && data) setMethods(data as PaymentMethodRow[]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, barbershopId]);

  const paid = useMemo(
    () => payments.reduce((a, p) => a + (Number(p.amount) || 0), 0),
    [payments],
  );
  const remaining = Math.max(0, total - paid);

  const addPayment = (methodId: string) => {
    const m = methods.find((x) => x.id === methodId);
    if (!m) return;
    setPayments((prev) => [
      ...prev,
      { key: uid(), payment_method_id: m.id, method_name: m.name, amount: Number(remaining.toFixed(2)) || 0 },
    ]);
  };
  const updatePayment = (key: string, patch: Partial<DraftPayment>) =>
    setPayments((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const removePayment = (key: string) => setPayments((prev) => prev.filter((p) => p.key !== key));

  const handleConfirm = async () => {
    if (!ticket) return;
    if (submittingRef.current) return; // duplo clique
    if (payments.length === 0) {
      toast.error("Adicione ao menos uma forma de pagamento.");
      return;
    }
    if (Math.abs(paid - total) > 0.01) {
      toast.error(`Os pagamentos (${fmtBRL(paid)}) devem somar o total (${fmtBRL(total)}).`);
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("close_ticket", {
        _ticket_id: ticket.id,
        _payments: payments.map((p) => ({
          method_name: p.method_name,
          amount: p.amount,
          payment_method_id: p.payment_method_id,
        })),
      });
      if (error) throw error;
      toast.success(`Comanda fechada — ${fmtBRL(total)}`);
      onClosed();
    } catch (e) {
      // Em caso de falha a comanda PERMANECE aberta (o banco não a fechou).
      console.error(e);
      toast.error(friendlyTicketError(e));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Fechar comanda
          </DialogTitle>
          <DialogDescription>
            Confira o resumo, registre as formas de pagamento e confirme o fechamento.
          </DialogDescription>
        </DialogHeader>

        {/* Resumo (somente leitura) */}
        <div className="space-y-1 text-sm">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between text-muted-foreground">
              <span className="truncate">
                {it.quantity}× {it.description}
              </span>
              <span>{fmtBRL(it.total)}</span>
            </div>
          ))}
          <Separator className="my-2" />
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>{fmtBRL(ticket?.subtotal ?? 0)}</span>
          </div>
          {Number(ticket?.discount_amount ?? 0) > 0 && (
            <div className="flex justify-between text-yellow-500">
              <span>Desconto</span>
              <span>- {fmtBRL(Number(ticket?.subtotal ?? 0) - total)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-primary pt-1">
            <span>Total</span>
            <span>{fmtBRL(total)}</span>
          </div>
        </div>

        <Separator />

        {/* Pagamentos */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">
              Pagamento {payments.length > 1 && <span className="text-muted-foreground">(dividido)</span>}
            </Label>
            <div className="text-xs text-muted-foreground">
              Pago: <span className={paid > total + 0.01 ? "text-destructive" : "text-foreground"}>{fmtBRL(paid)}</span>
              {remaining > 0.01 && (
                <>
                  {" "}· Falta: <span className="text-yellow-500">{fmtBRL(remaining)}</span>
                </>
              )}
            </div>
          </div>

          {payments.length === 0 && (
            <p className="text-xs text-muted-foreground">Nenhum pagamento adicionado ainda.</p>
          )}

          <div className="space-y-2">
            {payments.map((p) => (
              <div key={p.key} className="flex items-center gap-2 p-2 rounded-md border border-border bg-background/40">
                <Select
                  value={p.payment_method_id || ""}
                  onValueChange={(v) => {
                    const m = methods.find((x) => x.id === v);
                    if (m) updatePayment(p.key, { payment_method_id: m.id, method_name: m.name });
                  }}
                >
                  <SelectTrigger className="bg-input h-9 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={p.amount}
                  onChange={(e) => updatePayment(p.key, { amount: Math.max(0, parseFloat(e.target.value) || 0) })}
                  className="bg-input w-32 h-9"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-destructive"
                  onClick={() => removePayment(p.key)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {methods.map((m) => (
              <Button key={m.id} variant="outline" size="sm" className="h-8" onClick={() => addPayment(m.id)}>
                <Plus className="w-3 h-3" /> {m.name}
              </Button>
            ))}
            {methods.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Cadastre formas de pagamento em Configurações.
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="gold" onClick={handleConfirm} disabled={saving}>
            {saving ? "Fechando..." : `Confirmar — ${fmtBRL(total)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
