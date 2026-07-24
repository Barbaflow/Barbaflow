/**
 * Agregações de relatório do modo mock — espelham as RPCs `report_*` do banco
 * (migration 20260724120000_sales_reports_rpcs.sql).
 *
 * Funções PURAS: recebem as linhas e os parâmetros já resolvidos (inclusive o
 * `barberFilter`, decidido pela autorização em client.ts) e devolvem os mesmos
 * agregados que a SQL. Nenhuma decisão de acesso é tomada aqui.
 *
 * Regras (idênticas à SQL):
 *   • só comandas status = 'fechada';
 *   • recorte por closed_at em [startMs, endMs) — início inclusivo, fim exclusivo;
 *   • bruto = Σ subtotal; desconto = Σ (subtotal − total); líquido = Σ total;
 *   • serviços/produtos usam o SNAPSHOT em ticket_items (unit_price/total/description).
 */

import type { MockRow } from "./store";

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** ms do instante de fechamento; NaN quando ausente (nunca entra no período). */
function closedAtMs(ticket: MockRow): number {
  const raw = ticket.closed_at;
  if (raw === null || raw === undefined) return NaN;
  return Date.parse(String(raw));
}

/**
 * Comandas que entram no faturamento: fechadas, dentro do período e (quando há
 * `barberFilter`) do profissional pedido. `barberFilter === null` = toda a loja.
 */
function closedTicketsInScope(
  tickets: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
): MockRow[] {
  return tickets.filter((t) => {
    if (String(t.barbershop_id) !== barbershopId) return false;
    if (t.status !== "fechada") return false;
    if (barberFilter !== null && String(t.barber_id) !== barberFilter) return false;
    const ms = closedAtMs(t);
    return Number.isFinite(ms) && ms >= startMs && ms < endMs;
  });
}

export interface SalesSummary {
  gross: number;
  discount: number;
  net: number;
  closed_count: number;
  avg_ticket: number;
  services_count: number;
  products_count: number;
}

export function salesSummary(
  tickets: readonly MockRow[],
  items: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
): SalesSummary {
  const closed = closedTicketsInScope(tickets, barbershopId, startMs, endMs, barberFilter);
  const ids = new Set(closed.map((t) => String(t.id)));

  let gross = 0;
  let net = 0;
  for (const t of closed) {
    gross += Number(t.subtotal) || 0;
    net += Number(t.total) || 0;
  }
  const discount = gross - net;

  let services = 0;
  let products = 0;
  for (const it of items) {
    if (!ids.has(String(it.ticket_id))) continue;
    const qty = Number(it.quantity) || 0;
    if (it.item_type === "service") services += qty;
    else if (it.item_type === "product") products += qty;
  }

  const closedCount = closed.length;
  return {
    gross: round2(gross),
    discount: round2(discount),
    net: round2(net),
    closed_count: closedCount,
    avg_ticket: closedCount === 0 ? 0 : round2(net / closedCount),
    services_count: services,
    products_count: products,
  };
}

export interface DayPoint {
  day: string; // YYYY-MM-DD no fuso da barbearia
  net: number;
  closed_count: number;
}

/** YYYY-MM-DD de um instante no fuso informado (sem cair no rollover de UTC). */
function tzDateISO(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Série diária (só dias COM venda; o front preenche zeros do intervalo). O
 * agrupamento é por dia-calendário no fuso da barbearia.
 */
export function salesTimeseries(
  tickets: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
  tz: string,
): DayPoint[] {
  const closed = closedTicketsInScope(tickets, barbershopId, startMs, endMs, barberFilter);
  const byDay = new Map<string, { net: number; count: number }>();
  for (const t of closed) {
    const day = tzDateISO(closedAtMs(t), tz);
    const prev = byDay.get(day) ?? { net: 0, count: 0 };
    prev.net += Number(t.total) || 0;
    prev.count += 1;
    byDay.set(day, prev);
  }
  return [...byDay.entries()]
    .map(([day, v]) => ({ day, net: round2(v.net), closed_count: v.count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export interface ServiceRow {
  service_id: string | null;
  name: string;
  revenue: number;
  quantity: number;
}

export function servicesReport(
  tickets: readonly MockRow[],
  items: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
): ServiceRow[] {
  return itemsReport(tickets, items, barbershopId, startMs, endMs, barberFilter, "service").map(
    (r) => ({ service_id: r.ref_id, name: r.name, revenue: r.revenue, quantity: r.quantity }),
  );
}

export interface ProductRow {
  product_id: string | null;
  name: string;
  revenue: number;
  quantity: number;
  stock_quantity: number | null;
  active: boolean | null;
}

export function productsReport(
  tickets: readonly MockRow[],
  items: readonly MockRow[],
  products: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
): ProductRow[] {
  const catalog = new Map(products.map((p) => [String(p.id), p]));
  return itemsReport(tickets, items, barbershopId, startMs, endMs, barberFilter, "product").map(
    (r) => {
      const prod = r.ref_id ? catalog.get(r.ref_id) : undefined;
      return {
        product_id: r.ref_id,
        name: r.name,
        revenue: r.revenue,
        quantity: r.quantity,
        stock_quantity: prod ? Number(prod.stock_quantity) : null,
        active: prod ? Boolean(prod.active) : null,
      };
    },
  );
}

interface ItemAgg {
  ref_id: string | null;
  name: string;
  revenue: number;
  quantity: number;
  lastClosed: number;
}

/** Agrega itens (serviço ou produto) por referência, com nome do snapshot mais recente. */
function itemsReport(
  tickets: readonly MockRow[],
  items: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
  kind: "service" | "product",
): ItemAgg[] {
  const closed = closedTicketsInScope(tickets, barbershopId, startMs, endMs, barberFilter);
  const closedById = new Map(closed.map((t) => [String(t.id), t]));
  const refKey = kind === "service" ? "service_id" : "product_id";

  const agg = new Map<string, ItemAgg>();
  for (const it of items) {
    if (it.item_type !== kind) continue;
    const ticket = closedById.get(String(it.ticket_id));
    if (!ticket) continue;
    const refId = it[refKey] ? String(it[refKey]) : null;
    const key = refId ?? `__null__${String(it.description ?? "")}`;
    const closedMs = closedAtMs(ticket);
    const prev = agg.get(key);
    if (!prev) {
      agg.set(key, {
        ref_id: refId,
        name: String(it.description ?? ""),
        revenue: Number(it.total) || 0,
        quantity: Number(it.quantity) || 0,
        lastClosed: closedMs,
      });
    } else {
      prev.revenue += Number(it.total) || 0;
      prev.quantity += Number(it.quantity) || 0;
      if (closedMs >= prev.lastClosed) {
        prev.name = String(it.description ?? prev.name);
        prev.lastClosed = closedMs;
      }
    }
  }
  return [...agg.values()]
    .map((r) => ({ ...r, revenue: round2(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
}

export interface BarberRow {
  barber_id: string;
  tickets_count: number;
  services_count: number;
  net: number;
  avg_ticket: number;
}

export function byBarberReport(
  tickets: readonly MockRow[],
  items: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
): BarberRow[] {
  const closed = closedTicketsInScope(tickets, barbershopId, startMs, endMs, barberFilter);
  const ticketBarber = new Map(closed.map((t) => [String(t.id), String(t.barber_id)]));

  const agg = new Map<string, { tickets: number; net: number; services: number }>();
  for (const t of closed) {
    const b = String(t.barber_id);
    const prev = agg.get(b) ?? { tickets: 0, net: 0, services: 0 };
    prev.tickets += 1;
    prev.net += Number(t.total) || 0;
    agg.set(b, prev);
  }
  for (const it of items) {
    if (it.item_type !== "service") continue;
    const b = ticketBarber.get(String(it.ticket_id));
    if (!b) continue;
    const prev = agg.get(b);
    if (prev) prev.services += Number(it.quantity) || 0;
  }

  return [...agg.entries()]
    .map(([barber_id, v]) => ({
      barber_id,
      tickets_count: v.tickets,
      services_count: v.services,
      net: round2(v.net),
      avg_ticket: v.tickets === 0 ? 0 : round2(v.net / v.tickets),
    }))
    .sort((a, b) => b.net - a.net);
}

export interface PaymentRow {
  method_name: string;
  amount: number;
  tickets_count: number;
}

export function paymentMethodsReport(
  tickets: readonly MockRow[],
  payments: readonly MockRow[],
  barbershopId: string,
  startMs: number,
  endMs: number,
  barberFilter: string | null,
): PaymentRow[] {
  const closed = closedTicketsInScope(tickets, barbershopId, startMs, endMs, barberFilter);
  const ids = new Set(closed.map((t) => String(t.id)));

  const agg = new Map<string, { amount: number; tickets: Set<string> }>();
  for (const p of payments) {
    const tid = String(p.ticket_id);
    if (!ids.has(tid)) continue;
    const name = String(p.method_name ?? "Não informado");
    const prev = agg.get(name) ?? { amount: 0, tickets: new Set<string>() };
    prev.amount += Number(p.amount) || 0;
    prev.tickets.add(tid);
    agg.set(name, prev);
  }

  return [...agg.entries()]
    .map(([method_name, v]) => ({
      method_name,
      amount: round2(v.amount),
      tickets_count: v.tickets.size,
    }))
    .sort((a, b) => b.amount - a.amount);
}
