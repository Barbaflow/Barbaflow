import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileSummaries, type ProfileSummaryMap } from "@/lib/profile-summaries";
import {
  fmtBRL,
  friendlyTicketError,
  shortTicketId,
  TICKET_STATUS_META,
  type TicketStatus,
} from "@/lib/comandas";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Scissors,
  Package,
  Pencil,
  Minus,
  Plus,
  Trash2,
  User,
  CalendarDays,
  Ban,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";
import { CloseComandaDialog } from "@/components/CloseComandaDialog";

interface Props {
  ticketId: string | null;
  barbershopId: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

type ItemType = "service" | "product" | "custom";

interface ItemRow {
  id: string;
  item_type: ItemType;
  service_id: string | null;
  product_id: string | null;
  description: string;
  unit_price: number;
  quantity: number;
  total: number;
  created_at?: string;
}
interface PaymentRow {
  id: string;
  method_name: string;
  amount: number;
}
interface TicketRow {
  id: string;
  status: TicketStatus;
  barbershop_id: string;
  client_id: string | null;
  barber_id: string;
  appointment_id: string | null;
  subtotal: number;
  discount_type: string;
  discount_amount: number;
  total: number;
  created_at: string;
  closed_at: string | null;
  ticket_items: ItemRow[];
  ticket_payments: PaymentRow[];
}
interface ServiceOpt {
  id: string;
  name: string;
  price: number;
}
interface ProductOpt {
  id: string;
  name: string;
  price: number;
  stock_quantity: number;
}

const NO_VALUE = "__pick__";

const itemIcon = (t: ItemType) =>
  t === "service" ? <Scissors className="w-3 h-3" /> : t === "product" ? <Package className="w-3 h-3" /> : <Pencil className="w-3 h-3" />;

const fmtDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function ComandaDetailDialog({ ticketId, barbershopId, canManage, onOpenChange, onChanged }: Props) {
  const open = ticketId !== null;
  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const [names, setNames] = useState<ProfileSummaryMap>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountInput, setDiscountInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const busyRef = useRef(false); // trava síncrona contra duplo clique

  const isOpen = ticket?.status === "aberta";
  const editable = isOpen && canManage;

  const fetchTicket = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("tickets")
      .select("*, ticket_items(*), ticket_payments(*)")
      .eq("id", ticketId)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    if (!data) {
      setLoadError("Comanda não encontrada.");
      setTicket(null);
      setLoading(false);
      return;
    }
    const row = data as unknown as TicketRow;
    row.ticket_items = [...(row.ticket_items ?? [])].sort((a, b) =>
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    );
    setLoadError(null);
    setTicket(row);
    setDiscountType(row.discount_type === "percent" ? "percent" : "fixed");
    setDiscountInput(Number(row.discount_amount) > 0 ? String(Number(row.discount_amount)) : "");
    setLoading(false);

    const ids = [row.client_id, row.barber_id].filter(Boolean) as string[];
    if (ids.length) {
      const map = await fetchProfileSummaries(ids);
      setNames((prev) => ({ ...prev, ...map }));
    }
  }, [ticketId]);

  useEffect(() => {
    if (!open) {
      setTicket(null);
      setLoadError(null);
      return;
    }
    fetchTicket();
  }, [open, fetchTicket]);

  // Catálogo (serviços/produtos ativos) só quando dá para editar.
  useEffect(() => {
    if (!open || !editable) return;
    let cancelled = false;
    (async () => {
      const [svc, prod] = await Promise.all([
        supabase
          .from("services")
          .select("id,name,price")
          .eq("barbershop_id", barbershopId)
          .eq("active", true)
          .order("name"),
        supabase
          .from("products")
          .select("id,name,price,stock_quantity")
          .eq("barbershop_id", barbershopId)
          .eq("active", true)
          .order("name"),
      ]);
      if (cancelled) return;
      if (svc.data) setServices(svc.data as ServiceOpt[]);
      if (prod.data) setProducts(prod.data as ProductOpt[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, editable, barbershopId]);

  const refresh = useCallback(async () => {
    await fetchTicket();
    onChanged();
  }, [fetchTicket, onChanged]);

  /** Executa uma mutação com trava de duplo clique e tratamento de erro. */
  const mutate = useCallback(async (fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      toast.error(friendlyTicketError(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const nameOf = (id: string | null): string => (id && names[id]?.full_name) || (id ? "—" : "");

  const stockOf = (productId: string | null): number | null => {
    if (!productId) return null;
    const p = products.find((x) => x.id === productId);
    return p ? Number(p.stock_quantity) : null;
  };

  const addService = (serviceId: string) =>
    mutate(async () => {
      if (!ticket) return;
      const { error } = await supabase.from("ticket_items").insert({
        ticket_id: ticket.id,
        barbershop_id: barbershopId,
        item_type: "service",
        service_id: serviceId,
        description: "",
        quantity: 1,
      });
      if (error) throw error;
      await refresh();
    });

  const addProduct = (productId: string) =>
    mutate(async () => {
      if (!ticket) return;
      const stock = stockOf(productId);
      if (stock !== null && stock <= 0) {
        toast.error("Produto sem estoque disponível.");
        return;
      }
      const { error } = await supabase.from("ticket_items").insert({
        ticket_id: ticket.id,
        barbershop_id: barbershopId,
        item_type: "product",
        product_id: productId,
        description: "",
        quantity: 1,
      });
      if (error) throw error;
      await refresh();
    });

  const changeQty = (item: ItemRow, next: number) =>
    mutate(async () => {
      if (next < 1) return;
      if (item.item_type === "product") {
        const stock = stockOf(item.product_id);
        if (stock !== null && next > stock) {
          toast.error(`Estoque disponível: ${stock}.`);
          return;
        }
      }
      const { data, error } = await supabase
        .from("ticket_items")
        .update({ quantity: next })
        .eq("id", item.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Nada foi alterado. A comanda pode ter sido fechada.");
        await refresh();
        return;
      }
      await refresh();
    });

  const removeItem = (item: ItemRow) =>
    mutate(async () => {
      const { data, error } = await supabase.from("ticket_items").delete().eq("id", item.id).select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Nada foi removido. A comanda pode ter sido fechada.");
        await refresh();
        return;
      }
      await refresh();
    });

  const applyDiscount = () =>
    mutate(async () => {
      if (!ticket) return;
      const amount = Math.max(0, parseFloat(discountInput.replace(",", ".")) || 0);
      const { data, error } = await supabase
        .from("tickets")
        .update({ discount_type: discountType, discount_amount: amount })
        .eq("id", ticket.id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("Nada foi alterado. A comanda pode ter sido fechada.");
        await refresh();
        return;
      }
      toast.success("Desconto atualizado.");
      await refresh();
    });

  const cancelComanda = () =>
    mutate(async () => {
      if (!ticket) return;
      const { data, error } = await supabase
        .from("tickets")
        .update({ status: "cancelada" })
        .eq("id", ticket.id)
        .eq("status", "aberta")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error("A comanda não está mais aberta.");
        await refresh();
        return;
      }
      toast.success("Comanda cancelada.");
      onChanged();
      onOpenChange(false);
    });

  const meta = ticket ? TICKET_STATUS_META[ticket.status] : null;
  const discount = Number(ticket?.discount_amount ?? 0);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-primary" />
              Comanda {ticket && <span className="font-mono text-sm text-muted-foreground">#{shortTicketId(ticket.id)}</span>}
              {meta && <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.badgeClass}`}>{meta.label}</span>}
            </DialogTitle>
            <DialogDescription>
              {editable
                ? "Lance serviços e produtos, ajuste quantidades e aplique desconto. Os valores são calculados pelo banco."
                : "Comanda somente leitura."}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : loadError ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{loadError}</div>
          ) : ticket ? (
            <div className="space-y-4">
              {/* Cabeçalho de dados */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {ticket.client_id && (
                  <span className="inline-flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" /> Cliente:{" "}
                    <span className="text-foreground font-medium">{nameOf(ticket.client_id)}</span>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5" /> Profissional:{" "}
                  <span className="text-foreground font-medium">{nameOf(ticket.barber_id) || "—"}</span>
                </span>
                {ticket.appointment_id && (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" /> Agendamento #{shortTicketId(ticket.appointment_id)}
                  </span>
                )}
                <span>Aberta em {fmtDateTime(ticket.created_at)}</span>
                {ticket.closed_at && <span>Fechada em {fmtDateTime(ticket.closed_at)}</span>}
              </div>

              {/* Itens */}
              <div className="space-y-2">
                <Label className="text-sm">Itens</Label>
                {ticket.ticket_items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum item lançado ainda.</p>
                ) : (
                  ticket.ticket_items.map((it) => {
                    const stock = it.item_type === "product" ? stockOf(it.product_id) : null;
                    const atStockCap = stock !== null && it.quantity >= stock;
                    return (
                      <div
                        key={it.id}
                        className="flex items-center gap-2 p-2 rounded-md border border-border bg-background/40"
                      >
                        <Badge variant="outline" className="shrink-0">
                          {itemIcon(it.item_type)}
                        </Badge>
                        <span className="flex-1 min-w-0 truncate text-sm text-foreground">{it.description}</span>
                        <span className="text-xs text-muted-foreground shrink-0 w-20 text-right">
                          {fmtBRL(it.unit_price)}
                        </span>
                        {editable ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={busy || it.quantity <= 1}
                              onClick={() => changeQty(it, it.quantity - 1)}
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </Button>
                            <span className="w-7 text-center text-sm">{it.quantity}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={busy || atStockCap}
                              onClick={() => changeQty(it, it.quantity + 1)}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground shrink-0 w-16 text-center">×{it.quantity}</span>
                        )}
                        <span className="w-20 text-right text-sm text-foreground shrink-0">{fmtBRL(it.total)}</span>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive shrink-0"
                            disabled={busy}
                            onClick={() => removeItem(it)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Adicionar itens (só quando editável) */}
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Select value={NO_VALUE} onValueChange={(v) => v !== NO_VALUE && addService(v)}>
                    <SelectTrigger className="bg-input h-9 w-auto min-w-[180px]" disabled={busy}>
                      <SelectValue placeholder="+ Adicionar serviço" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VALUE} disabled>
                        + Adicionar serviço
                      </SelectItem>
                      {services.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem serviços ativos</div>
                      ) : (
                        services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name} — {fmtBRL(s.price)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>

                  <Select value={NO_VALUE} onValueChange={(v) => v !== NO_VALUE && addProduct(v)}>
                    <SelectTrigger className="bg-input h-9 w-auto min-w-[180px]" disabled={busy}>
                      <SelectValue placeholder="+ Adicionar produto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VALUE} disabled>
                        + Adicionar produto
                      </SelectItem>
                      {products.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem produtos ativos</div>
                      ) : (
                        products.map((p) => {
                          const out = Number(p.stock_quantity) <= 0;
                          const low = !out && Number(p.stock_quantity) <= 3;
                          return (
                            <SelectItem key={p.id} value={p.id} disabled={out}>
                              {p.name} — {fmtBRL(p.price)}{" "}
                              {out ? "(esgotado)" : low ? `(estoque baixo: ${p.stock_quantity})` : `(${p.stock_quantity})`}
                            </SelectItem>
                          );
                        })
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Separator />

              {/* Desconto */}
              {editable ? (
                <div className="grid grid-cols-3 gap-3 items-end">
                  <div className="col-span-2">
                    <Label className="text-sm">Desconto</Label>
                    <div className="flex gap-2">
                      <Select value={discountType} onValueChange={(v) => setDiscountType(v as "fixed" | "percent")}>
                        <SelectTrigger className="bg-input h-9 w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">R$</SelectItem>
                          <SelectItem value="percent">%</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={discountInput}
                        onChange={(e) => setDiscountInput(e.target.value.replace(/[^\d.,]/g, ""))}
                        className="bg-input h-9"
                      />
                      <Button variant="outline" className="h-9" disabled={busy} onClick={applyDiscount}>
                        Aplicar
                      </Button>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Subtotal {fmtBRL(ticket.subtotal)}</p>
                    {discount > 0 && (
                      <p className="text-xs text-yellow-500">- {fmtBRL(Number(ticket.subtotal) - Number(ticket.total))}</p>
                    )}
                    <p className="text-lg font-bold text-primary">{fmtBRL(ticket.total)}</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{fmtBRL(ticket.subtotal)}</span>
                  </div>
                  {discount > 0 && (
                    <div className="flex justify-between text-yellow-500">
                      <span>Desconto</span>
                      <span>- {fmtBRL(Number(ticket.subtotal) - Number(ticket.total))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-base font-bold text-primary">
                    <span>Total</span>
                    <span>{fmtBRL(ticket.total)}</span>
                  </div>
                </div>
              )}

              {/* Pagamentos (quando houver) */}
              {ticket.ticket_payments.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Pagamentos</Label>
                  <div className="mt-1 space-y-0.5 text-sm">
                    {ticket.ticket_payments.map((p) => (
                      <div key={p.id} className="flex justify-between">
                        <span>{p.method_name}</span>
                        <span className="text-foreground">{fmtBRL(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Ações */}
              {editable && (
                <div className="flex flex-wrap gap-2 justify-end pt-2">
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy}
                    onClick={() => setConfirmCancel(true)}
                  >
                    <Ban className="w-4 h-4" /> Cancelar comanda
                  </Button>
                  <Button
                    variant="gold"
                    disabled={busy || ticket.ticket_items.length === 0}
                    onClick={() => setCloseOpen(true)}
                  >
                    <CreditCard className="w-4 h-4" /> Fechar — {fmtBRL(ticket.total)}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Confirmação de cancelamento */}
      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar esta comanda?</AlertDialogTitle>
            <AlertDialogDescription>
              A comanda ficará como cancelada e não poderá mais ser alterada. O estoque não é
              movimentado. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                cancelComanda();
                setConfirmCancel(false);
              }}
            >
              Cancelar comanda
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Fechamento */}
      <CloseComandaDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        barbershopId={barbershopId}
        ticket={ticket ? { id: ticket.id, subtotal: Number(ticket.subtotal), discount_amount: discount, total: Number(ticket.total) } : null}
        items={(ticket?.ticket_items ?? []).map((it) => ({
          id: it.id,
          description: it.description,
          quantity: it.quantity,
          total: Number(it.total),
        }))}
        onClosed={() => {
          setCloseOpen(false);
          refresh();
        }}
      />
    </>
  );
}
