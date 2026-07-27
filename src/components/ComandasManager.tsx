import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileSummaries, type ProfileSummaryMap } from "@/lib/profile-summaries";
import { fmtBRL, shortTicketId, TICKET_STATUS_META, type TicketStatus } from "@/lib/comandas";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  AlertCircle,
  ReceiptText,
  User,
  CalendarClock,
  Package,
  CalendarDays,
} from "lucide-react";
import { NewComandaDialog } from "@/components/NewComandaDialog";
import { ComandaDetailDialog } from "@/components/ComandaDetailDialog";
import { logTechnicalError } from "@/lib/error-reporting";

interface Props {
  barbershopId: string;
  canManage: boolean;
  initialTicketId?: string | null;
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
  ticket_items: { id: string }[];
}

const FILTERS: { value: TicketStatus; label: string }[] = [
  { value: "aberta", label: "Abertas" },
  { value: "fechada", label: "Fechadas" },
  { value: "cancelada", label: "Canceladas" },
];

const fmtDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function ComandasManager({ barbershopId, canManage, initialTicketId }: Props) {
  const [filter, setFilter] = useState<TicketStatus>("aberta");
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [names, setNames] = useState<ProfileSummaryMap>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(initialTicketId ?? null);
  // Abre o detalhe pedido por ?comanda= uma única vez.
  const initialConsumed = useRef(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("tickets")
      .select(
        "id,status,barbershop_id,client_id,barber_id,appointment_id,subtotal,discount_type,discount_amount,total,created_at,closed_at, ticket_items(id)",
      )
      .eq("barbershop_id", barbershopId)
      .eq("status", filter)
      // abertas: mais antigas primeiro (fila de atendimento);
      // fechadas/canceladas: mais recentes primeiro (histórico).
      .order("created_at", { ascending: filter === "aberta" });

    if (error) {
      logTechnicalError("ComandasManager", "carregar comandas", error);
      setLoadError("Não foi possível carregar as comandas. Tente novamente.");
      setTickets([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as TicketRow[];
    setLoadError(null);
    setTickets(rows);
    setLoading(false);

    // Nomes de cliente e barbeiro (profiles é privada — vai pela RPC de resumo).
    const ids = new Set<string>();
    for (const t of rows) {
      if (t.client_id) ids.add(t.client_id);
      if (t.barber_id) ids.add(t.barber_id);
    }
    if (ids.size > 0) {
      const map = await fetchProfileSummaries([...ids]);
      setNames((prev) => ({ ...prev, ...map }));
    }
  }, [barbershopId, filter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  // Realtime: qualquer mudança em comandas/itens/pagamentos desta barbearia
  // recarrega a lista. No modo mock o canal é no-op — a lista recarrega após
  // cada mutação de qualquer forma.
  useEffect(() => {
    const channel = supabase
      .channel(`comandas-${barbershopId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `barbershop_id=eq.${barbershopId}` },
        () => fetchTickets(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ticket_items", filter: `barbershop_id=eq.${barbershopId}` },
        () => fetchTickets(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [barbershopId, fetchTickets]);

  // ?comanda=<id>: abre o detalhe uma vez, ao montar.
  useEffect(() => {
    if (initialTicketId && !initialConsumed.current) {
      initialConsumed.current = true;
      setDetailId(initialTicketId);
    }
  }, [initialTicketId]);

  const nameOf = (id: string | null): string =>
    (id && names[id]?.full_name) || (id ? "—" : "");

  const emptyLabel = useMemo(() => {
    switch (filter) {
      case "aberta":
        return "Nenhuma comanda aberta. Abra uma nova comanda ou inicie a partir de um agendamento.";
      case "fechada":
        return "Nenhuma comanda fechada ainda.";
      case "cancelada":
        return "Nenhuma comanda cancelada.";
    }
  }, [filter]);

  return (
    <div className="space-y-6">
      {/* Filtros + ação */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                filter === f.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {canManage && (
          <Button variant="gold" onClick={() => setNewOpen(true)}>
            <Plus className="w-4 h-4" />
            Nova comanda
          </Button>
        )}
      </div>

      {/* Estados */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <Card className="border-destructive/40">
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="w-9 h-9 mx-auto text-destructive" />
            <h3 className="font-display text-foreground">Não foi possível carregar as comandas</h3>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" size="sm" onClick={fetchTickets}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <ReceiptText className="w-10 h-10 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => {
            const meta = TICKET_STATUS_META[t.status];
            const itemCount = t.ticket_items?.length ?? 0;
            const discount = Number(t.discount_amount ?? 0);
            return (
              <button
                key={t.id}
                onClick={() => setDetailId(t.id)}
                className="w-full text-left rounded-xl border border-border bg-card hover:border-primary/50 transition-colors p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{shortTicketId(t.id)}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${meta.badgeClass}`}>
                        {meta.label}
                      </span>
                      {t.appointment_id && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground inline-flex items-center gap-1">
                          <CalendarDays className="w-3 h-3" />
                          Agendamento
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {t.client_id && (
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          {nameOf(t.client_id)}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <User className="w-3.5 h-3.5" />
                        {nameOf(t.barber_id) || "Profissional"}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Package className="w-3.5 h-3.5" />
                        {itemCount} {itemCount === 1 ? "item" : "itens"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" />
                        Aberta em {fmtDateTime(t.created_at)}
                      </span>
                      {t.closed_at && <span>Fechada em {fmtDateTime(t.closed_at)}</span>}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">Subtotal {fmtBRL(t.subtotal)}</p>
                    {discount > 0 && (
                      <p className="text-xs text-yellow-500">Desconto {fmtBRL(discount)}</p>
                    )}
                    <p className="text-lg font-bold text-primary">{fmtBRL(t.total)}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {canManage && (
        <NewComandaDialog
          open={newOpen}
          onOpenChange={setNewOpen}
          barbershopId={barbershopId}
          onOpened={(ticketId) => {
            setNewOpen(false);
            setFilter("aberta");
            fetchTickets();
            setDetailId(ticketId);
          }}
        />
      )}

      <ComandaDetailDialog
        ticketId={detailId}
        barbershopId={barbershopId}
        canManage={canManage}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onChanged={fetchTickets}
      />
    </div>
  );
}
