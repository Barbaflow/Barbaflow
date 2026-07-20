/**
 * Regras de integridade e isolamento aplicadas no store fictício.
 *
 * O objetivo é que o modo offline recuse as mesmas combinações que o banco
 * real recusaria por RLS, FK ou constraint — e não apenas a interface. Por
 * isso a validação vive aqui, no caminho de escrita, e não nos componentes.
 */
import { getTableRows, type MockRow } from "./store";
import { nowInTenantTZ, timeToMinutes } from "@/lib/tz";

/** Papéis que podem atender clientes. */
const ATTENDING_ROLES = new Set(["barbeiro", "admin_barbearia"]);

/** Status que ainda ocupam a agenda. */
const ACTIVE_STATUSES = new Set(["scheduled", "completed", "no_show"]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Barbearias em que o usuário pode atender. */
function attendingBarbershopsOf(userId: string): Set<string> {
  const result = new Set<string>();
  for (const role of getTableRows("user_roles")) {
    if (role.user_id === userId && ATTENDING_ROLES.has(String(role.role))) {
      const shop = asString(role.barbershop_id);
      if (shop) result.add(shop);
    }
  }
  return result;
}

/**
 * Valida a gravação de um agendamento.
 *
 * `existing` é a linha atual quando se trata de update (reagendamento,
 * cancelamento), para que ela não conflite consigo mesma.
 *
 * Retorna a mensagem de erro ou `null` quando a operação é válida.
 */
export function validateAppointment(row: MockRow, existing?: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  const barberId = asString(row.barber_id);
  const clientId = asString(row.client_id);
  const serviceId = asString(row.service_id);
  const date = asString(row.date);
  const startTime = asString(row.start_time);
  const endTime = asString(row.end_time);

  if (!barbershopId || !barberId || !clientId || !serviceId || !date || !startTime || !endTime) {
    return "Agendamento incompleto: barbearia, profissional, cliente, serviço, data e horário são obrigatórios.";
  }

  /* ---- a barbearia existe ---- */
  const barbershop = getTableRows("barbershops").find((shop) => shop.id === barbershopId);
  if (!barbershop) {
    return `Barbearia "${barbershopId}" não existe.`;
  }

  /* ---- isolamento: o profissional atende nesta barbearia ---- */
  if (!attendingBarbershopsOf(barberId).has(barbershopId)) {
    return "O profissional selecionado não atende nesta barbearia.";
  }

  /* ---- isolamento: o serviço pertence à barbearia e ao profissional ---- */
  const service = getTableRows("services").find((item) => item.id === serviceId);
  if (!service) {
    return `Serviço "${serviceId}" não existe.`;
  }
  if (service.barbershop_id !== barbershopId) {
    return "O serviço selecionado pertence a outra barbearia.";
  }
  if (service.barber_id !== barberId) {
    return "O serviço selecionado não é oferecido por este profissional.";
  }

  /* ---- o cliente existe ---- */
  const clientExists = getTableRows("profiles").some((profile) => profile.user_id === clientId);
  if (!clientExists) {
    return "Cliente não encontrado.";
  }

  /* ---- horário coerente ---- */
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  if (endMinutes <= startMinutes) {
    return "O horário de término deve ser posterior ao de início.";
  }

  /* ---- nada no passado (só para agendamentos ativos) ---- */
  const status = String(row.status ?? "scheduled");
  if (status === "scheduled") {
    const now = nowInTenantTZ();
    if (date < now.iso) {
      return "Não é possível agendar em uma data passada.";
    }
    if (date === now.iso && startMinutes < now.minutes) {
      return "Não é possível agendar em um horário que já passou.";
    }
  }

  /* ---- bloqueio de agenda ---- */
  const isBlocked = getTableRows("schedule_blocks").some(
    (block) =>
      block.barber_id === barberId &&
      block.barbershop_id === barbershopId &&
      block.block_date === date,
  );
  if (isBlocked) {
    return "O profissional está com a agenda bloqueada nesta data.";
  }

  /* ---- dentro da grade semanal ---- */
  const dow = new Date(`${date}T12:00:00`).getDay();
  const shifts = getTableRows("weekly_schedule").filter(
    (shift) =>
      shift.barber_id === barberId &&
      shift.barbershop_id === barbershopId &&
      shift.day_of_week === dow &&
      shift.is_active === true,
  );
  if (shifts.length > 0) {
    const insideSomeShift = shifts.some(
      (shift) =>
        startMinutes >= timeToMinutes(String(shift.start_time)) &&
        endMinutes <= timeToMinutes(String(shift.end_time)),
    );
    if (!insideSomeShift) {
      return "O horário escolhido está fora da grade de atendimento do profissional.";
    }
  }

  /* ---- conflito com outro agendamento do mesmo profissional ---- */
  const conflict = getTableRows("appointments").find((appointment) => {
    if (existing && appointment.id === existing.id) return false;
    if (appointment.barber_id !== barberId) return false;
    if (appointment.date !== date) return false;
    if (!ACTIVE_STATUSES.has(String(appointment.status))) return false;

    return overlaps(
      startMinutes,
      endMinutes,
      timeToMinutes(String(appointment.start_time)),
      timeToMinutes(String(appointment.end_time)),
    );
  });

  if (conflict) {
    return `Este horário já está ocupado (${String(conflict.start_time).slice(0, 5)}–${String(
      conflict.end_time,
    ).slice(0, 5)}).`;
  }

  return null;
}

/**
 * Valida a gravação de um bloqueio de agenda: o profissional precisa
 * pertencer à barbearia informada.
 */
export function validateScheduleBlock(row: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  const barberId = asString(row.barber_id);

  if (!barbershopId || !barberId) {
    return "Bloqueio incompleto: barbearia e profissional são obrigatórios.";
  }
  if (!attendingBarbershopsOf(barberId).has(barbershopId)) {
    return "O profissional informado não atende nesta barbearia.";
  }
  return null;
}

/**
 * Valida a grade semanal e a disponibilidade: mesmo vínculo
 * profissional ↔ barbearia exigido pelo banco real.
 */
export function validateBarberOwnedRow(row: MockRow, label: string): string | null {
  const barbershopId = asString(row.barbershop_id);
  const barberId = asString(row.barber_id);

  if (!barbershopId || !barberId) return null;
  if (!attendingBarbershopsOf(barberId).has(barbershopId)) {
    return `${label}: o profissional informado não atende nesta barbearia.`;
  }
  return null;
}

/**
 * Valida um serviço: não pode ser atribuído a um profissional de outra
 * barbearia.
 */
export function validateService(row: MockRow): string | null {
  return validateBarberOwnedRow(row, "Serviço");
}

/* ================================================================== */
/* Clientes, notas e bloqueios                                        */
/* ================================================================== */

/**
 * Um cliente "pertence" à barbearia quando tem papel lá (inclusive o
 * walk-in, que recebe `cliente` ao ser criado) ou quando já foi atendido.
 */
function clientBelongsTo(clientId: string, barbershopId: string): boolean {
  const hasRole = getTableRows("user_roles").some(
    (row) => row.user_id === clientId && row.barbershop_id === barbershopId,
  );
  if (hasRole) return true;

  return getTableRows("appointments").some(
    (row) => row.client_id === clientId && row.barbershop_id === barbershopId,
  );
}

function barbershopExists(barbershopId: string): boolean {
  return getTableRows("barbershops").some((row) => row.id === barbershopId);
}

/** Valida qualquer linha que vincule um cliente a uma barbearia. */
function validateClientScopedRow(row: MockRow, label: string): string | null {
  const barbershopId = asString(row.barbershop_id);
  const clientId = asString(row.client_id);

  if (!barbershopId || !clientId) {
    return `${label}: barbearia e cliente são obrigatórios.`;
  }
  if (!barbershopExists(barbershopId)) {
    return `${label}: barbearia "${barbershopId}" não existe.`;
  }
  if (!clientBelongsTo(clientId, barbershopId)) {
    return `${label}: este cliente não pertence a esta barbearia.`;
  }
  return null;
}

/** Nota interna: precisa ser do cliente e da barbearia corretos. */
export function validateClientNote(row: MockRow): string | null {
  const problem = validateClientScopedRow(row, "Nota");
  if (problem) return problem;

  const note = asString(row.note);
  if (row.note !== undefined && !note) return "Nota: o texto não pode ficar vazio.";
  return null;
}

/** Bloqueio de cliente: mesmo vínculo, mais a data de liberação. */
export function validateClientBlock(row: MockRow): string | null {
  const problem = validateClientScopedRow(row, "Bloqueio");
  if (problem) return problem;

  if (row.blocked_until !== undefined && !asString(row.blocked_until)) {
    return "Bloqueio: informe até quando o cliente fica bloqueado.";
  }
  return null;
}

/* ================================================================== */
/* Produtos e formas de pagamento                                     */
/* ================================================================== */

/** Número finito, não negativo. Barra NaN e Infinity. */
function isNonNegativeFinite(value: unknown): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

export function validateProduct(row: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  if (!barbershopId) return "Produto: barbearia é obrigatória.";
  if (!barbershopExists(barbershopId)) return "Produto: barbearia não existe.";

  if (row.price !== undefined && !isNonNegativeFinite(row.price)) {
    return "Produto: preço inválido.";
  }
  // O schema tem stock_quantity, mas o app não faz baixa automática — aqui
  // só impedimos estoque negativo, sem inventar movimentação.
  if (row.stock_quantity !== undefined && !isNonNegativeFinite(row.stock_quantity)) {
    return "Produto: estoque não pode ser negativo.";
  }
  return null;
}

export function validatePaymentMethod(row: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  if (!barbershopId) return "Forma de pagamento: barbearia é obrigatória.";
  if (!barbershopExists(barbershopId)) return "Forma de pagamento: barbearia não existe.";
  return null;
}

/* ================================================================== */
/* Comandas                                                           */
/* ================================================================== */

/** Tolerância de centavos, a mesma usada por CloseTicketDialog. */
const MONEY_EPSILON = 0.01;

function paidAmountOf(ticketId: string, pending: readonly MockRow[] = []): number {
  const stored = getTableRows("ticket_payments")
    .filter((row) => row.ticket_id === ticketId)
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  const inBatch = pending
    .filter((row) => row.ticket_id === ticketId)
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  return stored + inBatch;
}

/**
 * O schema não tem coluna de status: `closed_at` é obrigatório, então toda
 * comanda nasce fechada. "Quitada" — o que o dashboard mostra como `paid` —
 * é a soma dos pagamentos alcançando o total. É esse estado que trava novas
 * alterações.
 */
function isTicketSettled(ticket: MockRow, pending: readonly MockRow[] = []): boolean {
  const total = Number(ticket.total ?? 0);
  if (!Number.isFinite(total) || total <= 0) return false;
  return paidAmountOf(String(ticket.id), pending) + MONEY_EPSILON >= total;
}

/** Valida a comanda: coerência de tenant e aritmética financeira. */
export function validateTicket(row: MockRow, existing?: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  const clientId = asString(row.client_id);
  const barberId = asString(row.barber_id);
  const appointmentId = asString(row.appointment_id);

  if (!barbershopId || !clientId || !barberId) {
    return "Comanda: barbearia, cliente e profissional são obrigatórios.";
  }
  if (!barbershopExists(barbershopId)) {
    return `Comanda: barbearia "${barbershopId}" não existe.`;
  }

  /* ---- coerência com a barbearia ---- */
  if (!attendingBarbershopsOf(barberId).has(barbershopId)) {
    return "Comanda: o profissional não atende nesta barbearia.";
  }
  if (!clientBelongsTo(clientId, barbershopId)) {
    return "Comanda: este cliente não pertence a esta barbearia.";
  }
  if (appointmentId) {
    const appointment = getTableRows("appointments").find((item) => item.id === appointmentId);
    if (!appointment) return "Comanda: agendamento não encontrado.";
    if (appointment.barbershop_id !== barbershopId) {
      return "Comanda: o agendamento pertence a outra barbearia.";
    }
    if (appointment.client_id !== clientId) {
      return "Comanda: o cliente não corresponde ao do agendamento.";
    }
    if (appointment.barber_id !== barberId) {
      return "Comanda: o profissional não corresponde ao do agendamento.";
    }
  }

  /* ---- não fechar de novo ---- */
  if (existing && isTicketSettled(existing)) {
    return "Comanda já quitada: não pode ser alterada nem fechada novamente.";
  }

  /* ---- aritmética ---- */
  const subtotal = Number(row.subtotal ?? 0);
  const discount = Number(row.discount_amount ?? 0);
  const total = Number(row.total ?? 0);

  if (!Number.isFinite(subtotal) || subtotal < 0) return "Comanda: subtotal inválido.";
  if (!Number.isFinite(discount) || discount < 0) return "Comanda: desconto não pode ser negativo.";
  if (!Number.isFinite(total) || total < 0) return "Comanda: total inválido.";
  if (discount > subtotal + MONEY_EPSILON) {
    return "Comanda: o desconto não pode ultrapassar o subtotal.";
  }

  const expected = Math.max(0, subtotal - discount);
  if (Math.abs(total - expected) > MONEY_EPSILON) {
    return `Comanda: total incoerente (esperado ${expected.toFixed(2)}, recebido ${total.toFixed(2)}).`;
  }

  return null;
}

/** Valida um item: pertence à comanda, ao tenant, e tem valores válidos. */
export function validateTicketItem(row: MockRow, pending: readonly MockRow[] = []): string | null {
  const ticketId = asString(row.ticket_id);
  const barbershopId = asString(row.barbershop_id);

  if (!ticketId || !barbershopId) {
    return "Item: comanda e barbearia são obrigatórias.";
  }

  const ticket = getTableRows("tickets").find((item) => item.id === ticketId);
  if (!ticket) return "Item: comanda não encontrada.";
  if (ticket.barbershop_id !== barbershopId) {
    return "Item: a comanda informada pertence a outra barbearia.";
  }
  if (isTicketSettled(ticket, pending)) {
    return "Comanda já quitada: não aceita novos itens.";
  }

  /* ---- o serviço/produto precisa ser do mesmo tenant ---- */
  const serviceId = asString(row.service_id);
  if (serviceId) {
    const service = getTableRows("services").find((item) => item.id === serviceId);
    if (!service) return "Item: serviço não encontrado.";
    if (service.barbershop_id !== barbershopId) {
      return "Item: o serviço pertence a outra barbearia.";
    }
  }

  const productId = asString(row.product_id);
  if (productId) {
    const product = getTableRows("products").find((item) => item.id === productId);
    if (!product) return "Item: produto não encontrado.";
    if (product.barbershop_id !== barbershopId) {
      return "Item: o produto pertence a outra barbearia.";
    }
  }

  /* ---- valores ---- */
  const quantity = Number(row.quantity ?? 0);
  const unitPrice = Number(row.unit_price ?? 0);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return "Item: a quantidade deve ser maior que zero.";
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return "Item: o preço unitário não pode ser negativo.";
  }

  if (row.total !== undefined) {
    const total = Number(row.total);
    if (!Number.isFinite(total)) return "Item: total inválido.";
    if (Math.abs(total - unitPrice * quantity) > MONEY_EPSILON) {
      return "Item: total não corresponde a preço × quantidade.";
    }
  }

  return null;
}

/** Valida um pagamento: comanda do mesmo tenant, valor positivo, sem exceder o total. */
export function validateTicketPayment(
  row: MockRow,
  pending: readonly MockRow[] = [],
): string | null {
  const ticketId = asString(row.ticket_id);
  const barbershopId = asString(row.barbershop_id);

  if (!ticketId || !barbershopId) {
    return "Pagamento: comanda e barbearia são obrigatórias.";
  }

  const ticket = getTableRows("tickets").find((item) => item.id === ticketId);
  if (!ticket) return "Pagamento: comanda não encontrada.";
  if (ticket.barbershop_id !== barbershopId) {
    return "Pagamento: a comanda informada pertence a outra barbearia.";
  }

  const methodId = asString(row.payment_method_id);
  if (methodId) {
    const method = getTableRows("payment_methods").find((item) => item.id === methodId);
    if (!method) return "Pagamento: forma de pagamento não encontrada.";
    if (method.barbershop_id !== barbershopId) {
      return "Pagamento: a forma de pagamento pertence a outra barbearia.";
    }
  }

  const amount = Number(row.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "Pagamento: o valor deve ser maior que zero.";
  }

  // Sem regra de troco no projeto: a soma dos pagamentos não pode passar do total.
  const total = Number(ticket.total ?? 0);
  const others = pending.filter((item) => item !== row);
  const alreadyPaid = paidAmountOf(ticketId, others);

  if (alreadyPaid + amount > total + MONEY_EPSILON) {
    return `Pagamento: excede o total da comanda (total ${total.toFixed(2)}, já pago ${alreadyPaid.toFixed(
      2,
    )}).`;
  }

  return null;
}
