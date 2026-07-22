import { useEffect, useMemo, useState } from "react";
import { fetchProfileSummaries } from "@/lib/profile-summaries";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Scissors, Package, Pencil, CreditCard, Download, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import jsPDF from "jspdf";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  appointment: {
    id: string;
    barbershop_id: string;
    client_id: string;
    barber_id: string;
    service_id: string;
    date?: string;          // YYYY-MM-DD
    start_time?: string;    // HH:MM[:SS]
    barber_name?: string | null;
    service: { name: string; price: number } | null;
  };
  onClosed?: () => void;
}

type ItemType = "service" | "product" | "custom";

interface DraftItem {
  key: string;
  item_type: ItemType;
  service_id?: string | null;
  product_id?: string | null;
  description: string;
  unit_price: number;
  quantity: number;
}

interface DraftPayment {
  key: string;
  payment_method_id: string | null;
  method_name: string;
  amount: number;
}

interface ServiceRow { id: string; name: string; price: number; active: boolean }
interface ProductRow { id: string; name: string; price: number; stock_quantity: number; active: boolean }
interface PaymentMethodRow { id: string; name: string; active: boolean; sort_order: number }

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const uid = () => Math.random().toString(36).slice(2);

export function CloseTicketDialog({ open, onOpenChange, appointment, onClosed }: Props) {
  const { user } = useAuth();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [payments, setPayments] = useState<DraftPayment[]>([]);
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountInput, setDiscountInput] = useState<string>("");
  const discountAmount = Math.max(0, parseFloat(discountInput.replace(",", ".")) || 0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [summary, setSummary] = useState<null | {
    ticketId: string;
    shopName: string;
    clientName: string;
    clientPhone: string | null;
    barberName: string;
    startedAt: Date | null;
    items: DraftItem[];
    payments: DraftPayment[];
    subtotal: number;
    discountType: "fixed" | "percent";
    discountAmount: number;
    discountValue: number;
    total: number;
    notes: string;
    closedAt: Date;
    receiptTitle: string;
    receiptSubtitle: string;
    receiptFooter: string;
    receiptThanks: string;
    receiptWaIntro: string;
  }>(null);

  // Reset / load when opening
  useEffect(() => {
    if (!open) return;
    setDiscountType("fixed");
    setDiscountInput("");
    setNotes("");
    setPayments([]);
    // Pre-popula com o serviço do agendamento
    setItems([
      {
        key: uid(),
        item_type: "service",
        service_id: appointment.service_id,
        description: appointment.service?.name || "Serviço",
        unit_price: Number(appointment.service?.price || 0),
        quantity: 1,
      },
    ]);

    (async () => {
      const [svc, prod, pm] = await Promise.all([
        supabase
          .from("services")
          .select("id,name,price,active")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("products")
          .select("id,name,price,stock_quantity,active")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("active", true)
          .order("name"),
        supabase
          .from("payment_methods")
          .select("id,name,active,sort_order")
          .eq("barbershop_id", appointment.barbershop_id)
          .eq("active", true)
          .order("sort_order"),
      ]);
      if (svc.data) setServices(svc.data as ServiceRow[]);
      if (prod.data) setProducts(prod.data as ProductRow[]);
      if (pm.data) setMethods(pm.data as PaymentMethodRow[]);
    })();
  }, [open, appointment.barbershop_id, appointment.service_id, appointment.service]);

  const subtotal = useMemo(
    () => items.reduce((acc, it) => acc + it.unit_price * it.quantity, 0),
    [items]
  );
  const discountValue = useMemo(() => {
    const d = Math.max(0, Number(discountAmount) || 0);
    if (discountType === "percent") return Math.min(subtotal, (subtotal * d) / 100);
    return Math.min(subtotal, d);
  }, [discountAmount, discountType, subtotal]);
  const total = Math.max(0, subtotal - discountValue);
  const paid = useMemo(() => payments.reduce((a, p) => a + (Number(p.amount) || 0), 0), [payments]);
  const remaining = Math.max(0, total - paid);

  // Add item helpers
  const addService = (id: string) => {
    const s = services.find((x) => x.id === id);
    if (!s) return;
    setItems((prev) => [
      ...prev,
      { key: uid(), item_type: "service", service_id: s.id, description: s.name, unit_price: Number(s.price), quantity: 1 },
    ]);
  };
  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    setItems((prev) => [
      ...prev,
      { key: uid(), item_type: "product", product_id: p.id, description: p.name, unit_price: Number(p.price), quantity: 1 },
    ]);
  };
  const addCustom = () => {
    setItems((prev) => [
      ...prev,
      { key: uid(), item_type: "custom", description: "", unit_price: 0, quantity: 1 },
    ]);
  };

  // Add payment helpers
  const addPayment = (methodId?: string) => {
    const m = methodId ? methods.find((x) => x.id === methodId) : methods[0];
    if (!m) {
      toast.error("Cadastre uma forma de pagamento em Configurações.");
      return;
    }
    setPayments((prev) => [
      ...prev,
      { key: uid(), payment_method_id: m.id, method_name: m.name, amount: Number(remaining.toFixed(2)) || 0 },
    ]);
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  const removeItem = (key: string) => setItems((prev) => prev.filter((it) => it.key !== key));

  const updatePayment = (key: string, patch: Partial<DraftPayment>) =>
    setPayments((prev) => prev.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const removePayment = (key: string) => setPayments((prev) => prev.filter((p) => p.key !== key));

  const handleConfirm = async () => {
    if (!user) return;
    if (items.length === 0) {
      toast.error("Adicione ao menos um item.");
      return;
    }
    if (items.some((it) => !it.description.trim() || it.unit_price < 0 || it.quantity <= 0)) {
      toast.error("Verifique os itens (descrição, valor e quantidade).");
      return;
    }
    if (payments.length === 0) {
      toast.error("Adicione ao menos uma forma de pagamento.");
      return;
    }
    if (Math.abs(paid - total) > 0.01) {
      toast.error(`Pagamentos (${fmt(paid)}) devem somar o total (${fmt(total)}).`);
      return;
    }

    setSaving(true);
    try {
      // 1) Cria ticket
      const { data: ticket, error: tErr } = await supabase
        .from("tickets")
        .insert({
          barbershop_id: appointment.barbershop_id,
          appointment_id: appointment.id,
          client_id: appointment.client_id,
          barber_id: appointment.barber_id,
          closed_by: user.id,
          subtotal,
          discount_type: discountType,
          discount_amount: discountValue,
          total,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (tErr || !ticket) throw tErr || new Error("Falha ao criar comanda");

      // 2) Itens
      const itemsPayload = items.map((it) => ({
        ticket_id: ticket.id,
        barbershop_id: appointment.barbershop_id,
        item_type: it.item_type,
        service_id: it.item_type === "service" ? it.service_id ?? null : null,
        product_id: it.item_type === "product" ? it.product_id ?? null : null,
        description: it.description.trim(),
        unit_price: it.unit_price,
        quantity: it.quantity,
        total: it.unit_price * it.quantity,
      }));
      const { error: iErr } = await supabase.from("ticket_items").insert(itemsPayload);
      if (iErr) throw iErr;

      // 3) Pagamentos
      const paymentsPayload = payments.map((p) => ({
        ticket_id: ticket.id,
        barbershop_id: appointment.barbershop_id,
        payment_method_id: p.payment_method_id,
        method_name: p.method_name,
        amount: p.amount,
      }));
      const { error: pErr } = await supabase.from("ticket_payments").insert(paymentsPayload);
      if (pErr) throw pErr;

      // 4) Marca agendamento como concluído
      const { error: aErr } = await supabase
        .from("appointments")
        .update({ status: "completed" })
        .eq("id", appointment.id);
      if (aErr) throw aErr;

      // 5) Buscar dados para o recibo (barbearia + cliente + barbeiro se necessário)
      const needsBarberFetch = !appointment.barber_name;
      const [shopRes, profRes, phoneRes, barberRes] = await Promise.all([
        supabase
          .from("barbershops")
          .select("name,receipt_title,receipt_subtitle,receipt_footer,receipt_thank_you_message,receipt_whatsapp_intro")
          .eq("id", appointment.barbershop_id)
          .maybeSingle(),
        fetchProfileSummaries([appointment.client_id]).then((m) => ({
          data: m[appointment.client_id] ?? null,
        })),
        supabase.rpc("get_client_phone", { _client_id: appointment.client_id }),
        needsBarberFetch
          ? fetchProfileSummaries([appointment.barber_id]).then((m) => ({
              data: m[appointment.barber_id] ?? null,
            }))
          : Promise.resolve({ data: null } as any),
      ]);

      const barberName =
        appointment.barber_name ||
        (barberRes?.data as { full_name?: string } | null)?.full_name ||
        "Barbeiro";

      let startedAt: Date | null = null;
      if (appointment.date && appointment.start_time) {
        const t = appointment.start_time.length === 5 ? `${appointment.start_time}:00` : appointment.start_time;
        const d = new Date(`${appointment.date}T${t}`);
        if (!isNaN(d.getTime())) startedAt = d;
      }

      const shop = (shopRes.data as any) || {};
      toast.success(`Atendimento finalizado — ${fmt(total)}`);
      setSummary({
        ticketId: ticket.id,
        shopName: shop.name || "Barbearia",
        clientName: profRes.data?.full_name || "Cliente",
        clientPhone: (phoneRes.data as string | null) || null,
        barberName,
        startedAt,
        items: items.map((it) => ({ ...it })),
        payments: payments.map((p) => ({ ...p })),
        subtotal,
        discountType,
        discountAmount,
        discountValue,
        total,
        notes: notes.trim(),
        closedAt: new Date(),
        receiptTitle: shop.receipt_title || "Recibo de atendimento",
        receiptSubtitle: shop.receipt_subtitle || "",
        receiptFooter: shop.receipt_footer || "Volte sempre 💈",
        receiptThanks: shop.receipt_thank_you_message || "Obrigado pela preferência!",
        receiptWaIntro: shop.receipt_whatsapp_intro || "Olá, {cliente}! Segue o resumo do seu atendimento:",
      });
      onClosed?.();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Não foi possível finalizar a comanda.");
    } finally {
      setSaving(false);
    }
  };

  // ===== Recibo PDF =====
  const buildReceiptPdf = (s: NonNullable<typeof summary>): jsPDF => {
    const doc = new jsPDF({ unit: "mm", format: [80, 297] }); // estilo cupom 80mm
    const W = 80;
    let y = 8;
    const line = (text: string, opts: { size?: number; bold?: boolean; align?: "left" | "center" | "right"; gap?: number } = {}) => {
      const { size = 9, bold = false, align = "left", gap = 4.5 } = opts;
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const x = align === "center" ? W / 2 : align === "right" ? W - 5 : 5;
      doc.text(text, x, y, { align });
      y += gap;
    };
    const sep = () => {
      doc.setLineDashPattern([0.6, 0.6], 0);
      doc.line(5, y, W - 5, y);
      y += 3;
    };
    const row = (l: string, r: string, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 10 : 9);
      doc.text(l, 5, y);
      doc.text(r, W - 5, y, { align: "right" });
      y += 4.5;
    };

    line(s.shopName, { size: 12, bold: true, align: "center", gap: 5 });
    line(s.receiptTitle, { size: 8, align: "center", gap: 3 });
    if (s.receiptSubtitle) {
      line(s.receiptSubtitle, { size: 8, align: "center", gap: 3 });
    }
    if (s.startedAt) {
      line(`Início: ${s.startedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`, { size: 8, align: "center" });
    }
    line(`Fechamento: ${s.closedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`, { size: 8, align: "center" });
    line(`Comanda: ${s.ticketId.slice(0, 8).toUpperCase()}`, { size: 8, align: "center" });
    sep();
    line(`Cliente: ${s.clientName}`, { size: 9 });
    line(`Atendente: ${s.barberName}`, { size: 9 });
    sep();
    line("Itens", { size: 9, bold: true });
    s.items.forEach((it) => {
      const desc = it.description.length > 28 ? it.description.slice(0, 27) + "…" : it.description;
      row(`${it.quantity}x ${desc}`, fmt(it.unit_price * it.quantity));
    });
    sep();
    row("Subtotal", fmt(s.subtotal));
    if (s.discountValue > 0) {
      row(`Desconto${s.discountType === "percent" ? ` (${s.discountAmount}%)` : ""}`, `- ${fmt(s.discountValue)}`);
    }
    row("TOTAL", fmt(s.total), true);
    sep();
    line("Pagamentos", { size: 9, bold: true });
    s.payments.forEach((p) => row(p.method_name, fmt(p.amount)));
    if (s.notes) {
      sep();
      line("Obs.: " + s.notes, { size: 8 });
    }
    sep();
    line(s.receiptThanks, { size: 9, align: "center", bold: true, gap: 4 });
    if (s.receiptFooter) line(s.receiptFooter, { size: 8, align: "center" });
    return doc;
  };

  const downloadPdf = () => {
    if (!summary) return;
    const doc = buildReceiptPdf(summary);
    doc.save(`recibo-${summary.ticketId.slice(0, 8)}.pdf`);
  };

  const sendWhatsapp = async () => {
    if (!summary) return;
    const phone = (summary.clientPhone || "").replace(/\D/g, "");
    // 1) Baixa o PDF para o cliente anexar
    downloadPdf();
    // 2) Monta texto resumo
    const intro = (summary.receiptWaIntro || "Olá, {cliente}! Segue o resumo do seu atendimento:")
      .replace(/\{cliente\}/gi, summary.clientName);
    const lines: string[] = [
      `*${summary.shopName}* — ${summary.receiptTitle}`,
      intro,
      "",
      `Atendente: ${summary.barberName}`,
    ];
    if (summary.startedAt) {
      lines.push(`Início: ${summary.startedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`);
    }
    lines.push("");
    summary.items.forEach((it) => lines.push(`• ${it.quantity}x ${it.description} — ${fmt(it.unit_price * it.quantity)}`));
    lines.push("");
    lines.push(`Subtotal: ${fmt(summary.subtotal)}`);
    if (summary.discountValue > 0) lines.push(`Desconto: - ${fmt(summary.discountValue)}`);
    lines.push(`*Total: ${fmt(summary.total)}*`);
    lines.push("");
    lines.push("Pagamento: " + summary.payments.map((p) => `${p.method_name} (${fmt(p.amount)})`).join(", "));
    lines.push("");
    lines.push(summary.receiptThanks + (summary.receiptFooter ? ` ${summary.receiptFooter}` : ""));
    const text = encodeURIComponent(lines.join("\n"));
    const url = phone
      ? `https://wa.me/${phone.startsWith("55") ? phone : "55" + phone}?text=${text}`
      : `https://wa.me/?text=${text}`;
    window.open(url, "_blank", "noopener,noreferrer");
    if (!phone) toast.info("Cliente sem telefone. Escolha o contato no WhatsApp.");
  };

  return (
    <>
    <Dialog open={open && !summary} onOpenChange={(v) => { if (!v && summary) return; onOpenChange(v); }}>
      <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Fechar comanda
          </DialogTitle>
          <DialogDescription>
            Revise os itens, aplique desconto se necessário e registre o pagamento.
          </DialogDescription>
        </DialogHeader>

        {/* Itens */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Itens da comanda</Label>
          </div>

          <div className="space-y-2">
            {items.map((it) => (
              <div key={it.key} className="flex items-center gap-2 p-2 rounded-md border border-border bg-background/40">
                <Badge variant="outline" className="shrink-0">
                  {it.item_type === "service" ? <Scissors className="w-3 h-3" /> : it.item_type === "product" ? <Package className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                </Badge>
                <Input
                  value={it.description}
                  onChange={(e) => updateItem(it.key, { description: e.target.value })}
                  placeholder="Descrição"
                  className="bg-input flex-1 h-9"
                />
                <Input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => updateItem(it.key, { quantity: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="bg-input w-16 h-9"
                />
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={it.unit_price}
                  onChange={(e) => updateItem(it.key, { unit_price: Math.max(0, parseFloat(e.target.value) || 0) })}
                  className="bg-input w-24 h-9"
                />
                <span className="w-24 text-right text-sm text-foreground">{fmt(it.unit_price * it.quantity)}</span>
                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeItem(it.key)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Select value="" onValueChange={addService}>
              <SelectTrigger className="bg-input h-9 w-auto min-w-[180px]">
                <SelectValue placeholder="+ Adicionar serviço" />
              </SelectTrigger>
              <SelectContent>
                {services.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} — {fmt(Number(s.price))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value="" onValueChange={addProduct}>
              <SelectTrigger className="bg-input h-9 w-auto min-w-[180px]">
                <SelectValue placeholder="+ Adicionar produto" />
              </SelectTrigger>
              <SelectContent>
                {products.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Sem produtos cadastrados</div>
                ) : (
                  products.map((p) => (
                    <SelectItem key={p.id} value={p.id} disabled={p.stock_quantity <= 0}>
                      {p.name} — {fmt(Number(p.price))} {p.stock_quantity <= 0 ? "(sem estoque)" : `(${p.stock_quantity})`}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" className="h-9" onClick={addCustom}>
              <Plus className="w-4 h-4" /> Item avulso
            </Button>
          </div>
        </div>

        <Separator />

        {/* Desconto */}
        <div className="grid grid-cols-3 gap-3 items-end">
          <div className="col-span-2">
            <Label className="text-sm">Desconto</Label>
            <div className="flex gap-2">
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as "fixed" | "percent")}>
                <SelectTrigger className="bg-input h-9 w-28"><SelectValue /></SelectTrigger>
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
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.,]/g, "");
                  setDiscountInput(v);
                }}
                className="bg-input h-9"
              />
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Subtotal</p>
            <p className="text-sm">{fmt(subtotal)}</p>
            {discountValue > 0 && (
              <p className="text-xs text-yellow-500">- {fmt(discountValue)}</p>
            )}
            <p className="text-lg font-bold text-primary">{fmt(total)}</p>
          </div>
        </div>

        <Separator />

        {/* Pagamentos */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Pagamento {payments.length > 1 && <span className="text-muted-foreground">(dividido)</span>}</Label>
            <div className="text-xs text-muted-foreground">
              Pago: <span className={paid > total ? "text-destructive" : "text-foreground"}>{fmt(paid)}</span>
              {remaining > 0.01 && <> · Falta: <span className="text-yellow-500">{fmt(remaining)}</span></>}
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
                  <SelectTrigger className="bg-input h-9 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
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
                <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removePayment(p.key)}>
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
              <p className="text-xs text-muted-foreground">Cadastre formas de pagamento em Configurações.</p>
            )}
          </div>
        </div>

        <Separator />

        <div>
          <Label className="text-sm">Observações (opcional)</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: gorjeta, pendência..."
            className="bg-input"
          />
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button variant="gold" onClick={handleConfirm} disabled={saving}>
            {saving ? "Finalizando..." : `Finalizar — ${fmt(total)}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={!!summary} onOpenChange={(v) => { if (!v) { setSummary(null); onOpenChange(false); } }}>
      <DialogContent className="bg-card border-border max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-primary" /> Comanda finalizada
          </DialogTitle>
          <DialogDescription>
            {summary && `Fechada em ${summary.closedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`}
          </DialogDescription>
        </DialogHeader>

        {summary && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Atendente: <span className="text-foreground font-medium">{summary.barberName}</span></span>
              {summary.startedAt && (
                <span>Início: <span className="text-foreground font-medium">{summary.startedAt.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span></span>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Itens</Label>
              <div className="mt-1 space-y-1">
                {summary.items.map((it) => (
                  <div key={it.key} className="flex items-center justify-between gap-2 py-1 border-b border-border/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className="shrink-0">
                        {it.item_type === "service" ? <Scissors className="w-3 h-3" /> : it.item_type === "product" ? <Package className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                      </Badge>
                      <span className="truncate">{it.description}</span>
                      <span className="text-xs text-muted-foreground shrink-0">×{it.quantity}</span>
                    </div>
                    <span className="text-foreground shrink-0">{fmt(it.unit_price * it.quantity)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span><span>{fmt(summary.subtotal)}</span>
              </div>
              {summary.discountValue > 0 && (
                <div className="flex justify-between text-yellow-500">
                  <span>Desconto {summary.discountType === "percent" ? `(${summary.discountAmount}%)` : ""}</span>
                  <span>- {fmt(summary.discountValue)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-primary pt-1 border-t border-border/40">
                <span>Total</span><span>{fmt(summary.total)}</span>
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">Pagamentos</Label>
              <div className="mt-1 space-y-1">
                {summary.payments.map((p) => (
                  <div key={p.key} className="flex justify-between py-0.5">
                    <span>{p.method_name}</span>
                    <span className="text-foreground">{fmt(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            {summary.notes && (
              <div>
                <Label className="text-xs text-muted-foreground">Observações</Label>
                <p className="mt-1 text-sm text-foreground whitespace-pre-wrap">{summary.notes}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 justify-end pt-2">
          <Button variant="outline" onClick={downloadPdf}>
            <Download className="w-4 h-4" /> Baixar PDF
          </Button>
          <Button variant="outline" onClick={sendWhatsapp}>
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </Button>
          <Button variant="gold" onClick={() => { setSummary(null); onOpenChange(false); }}>
            Concluir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
