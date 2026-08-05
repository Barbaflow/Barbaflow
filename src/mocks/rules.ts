/**
 * Regras de integridade e isolamento aplicadas no store fictício.
 *
 * O objetivo é que o modo offline recuse as mesmas combinações que o banco
 * real recusaria por RLS, FK ou constraint — e não apenas a interface. Por
 * isso a validação vive aqui, no caminho de escrita, e não nos componentes.
 */
import { getTableRows, setTableRows, type MockRow } from "./store";
import { getMockActor } from "./session";
import { MOCK_ACCOUNTS } from "./auth";
import { nowInTenantTZ, timeToMinutes } from "@/lib/tz";

/**
 * Recusa de uma regra de escrita.
 *
 * A forma normal é só a mensagem. A forma com `code` existe para quando o
 * frontend precisa distinguir ESTA recusa das outras: aí o mock devolve o mesmo
 * SQLSTATE que o Postgres devolveria, e a tela pode ramificar pelo código em
 * vez de comparar texto. Hoje só `contact_submissions` usa.
 */
export type MockRuleViolation = string | { message: string; code: string };

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
/* ---------------- horário de funcionamento ---------------- */

/** Nome do dia para as mensagens — espelha `weekday_pt` do SQL. */
const DIA_PT = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function hhmm(valor: unknown): string {
  return String(valor ?? "").slice(0, 5);
}

/** Envelope da barbearia naquele dia, ou `undefined` quando não há. */
function envelopeDe(barbershopId: string, dayOfWeek: unknown): MockRow | undefined {
  return getTableRows("business_hours").find(
    (row) => row.barbershop_id === barbershopId && Number(row.day_of_week) === Number(dayOfWeek),
  );
}

/**
 * Coerência da própria linha de expediente — espelha o CHECK
 * `business_hours_coerent` e o UNIQUE por dia (migration 20260805170000).
 */
export function validateBusinessHours(row: MockRow, existing?: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id) ?? asString(existing?.barbershop_id);
  const dia = row.day_of_week ?? existing?.day_of_week;

  if (!barbershopId) return "Funcionamento: barbearia é obrigatória.";
  if (!barbershopExists(barbershopId)) return `Funcionamento: barbearia "${barbershopId}" não existe.`;

  const diaNum = Number(dia);
  if (!Number.isInteger(diaNum) || diaNum < 0 || diaNum > 6) {
    return "Funcionamento: dia da semana precisa estar entre 0 (domingo) e 6 (sábado).";
  }

  const fechado = Boolean(row.is_closed ?? existing?.is_closed ?? false);
  const abre = asString(row.open_time ?? existing?.open_time);
  const fecha = asString(row.close_time ?? existing?.close_time);

  if (fechado) {
    if (abre || fecha) return "Funcionamento: dia fechado não tem horário de abertura nem de fechamento.";
  } else {
    if (!abre || !fecha) return "Funcionamento: informe abertura e fechamento, ou marque o dia como fechado.";
    // Sem virada de dia — decisão explícita da migration.
    if (timeToMinutes(abre) >= timeToMinutes(fecha)) {
      return "Funcionamento: o horário de abertura precisa ser anterior ao de fechamento.";
    }
  }

  /* ---- um envelope por dia ---- */
  const duplicado = getTableRows("business_hours").some(
    (item) =>
      item.id !== (existing?.id ?? row.id) &&
      item.barbershop_id === barbershopId &&
      Number(item.day_of_week) === diaNum,
  );
  if (duplicado) return `Funcionamento: já existe expediente cadastrado para ${DIA_PT[diaNum]}.`;

  /* ---- não pode deixar turno ATIVO de fora ---- */
  // Espelha o trigger `enforce_business_hours_fit_shifts`. Só turnos ativos
  // contam: desativá-los é justamente a saída do admin, e recontá-los faria a
  // saída não funcionar.
  const conflitos = getTableRows("weekly_schedule").filter((turno) => {
    if (turno.barbershop_id !== barbershopId) return false;
    if (Number(turno.day_of_week) !== diaNum) return false;
    if (turno.is_active === false) return false;
    if (fechado) return true;
    // `abre`/`fecha` já foram exigidos acima quando o dia não é fechado; o
    // `String()` é só para o compilador, que não estreita fora do ramo.
    return (
      timeToMinutes(String(turno.start_time)) < timeToMinutes(String(abre)) ||
      timeToMinutes(String(turno.end_time)) > timeToMinutes(String(fecha))
    );
  });

  if (conflitos.length > 0) {
    const lista = conflitos
      .map((t) => `${nomeDoBarbeiro(t.barber_id)} (${hhmm(t.start_time)}–${hhmm(t.end_time)})`)
      .join(", ");
    return fechado
      ? `Funcionamento: não dá para marcar ${DIA_PT[diaNum]} como fechado — ${conflitos.length} turno(s) ativo(s) neste dia: ${lista}. Desative-os antes.`
      : `Funcionamento: este expediente (${hhmm(abre)}–${hhmm(fecha)}) deixaria ${conflitos.length} turno(s) de fora ${DIA_PT[diaNum]}: ${lista}. Amplie o horário ou desative os turnos em conflito antes de salvar.`;
  }

  return null;
}

/** Nome legível do profissional, com a mesma degradação do SQL. */
function nomeDoBarbeiro(barberId: unknown): string {
  const perfil = getTableRows("profiles").find((p) => p.user_id === barberId);
  const nome = String(perfil?.full_name ?? "").trim();
  return nome || "profissional";
}

/**
 * Turno pessoal precisa caber no expediente — espelha
 * `enforce_shift_within_business_hours`.
 *
 * Turno INATIVO não é validado, e isso é deliberado: é o que permite ao admin
 * desativar os conflitos quando aperta o expediente. Validá-lo prenderia a
 * pessoa entre as duas regras.
 */
function validateShiftWithinBusinessHours(row: MockRow, existing?: MockRow): string | null {
  const ativo = Boolean(row.is_active ?? existing?.is_active ?? true);
  if (!ativo) return null;

  const barbershopId = asString(row.barbershop_id) ?? asString(existing?.barbershop_id);
  if (!barbershopId) return null;

  const dia = row.day_of_week ?? existing?.day_of_week;
  const envelope = envelopeDe(barbershopId, dia);
  // Ausência de envelope = sem restrição.
  if (!envelope) return null;

  const diaNum = Number(dia);

  if (envelope.is_closed) {
    return `Grade semanal: a barbearia não abre ${DIA_PT[diaNum]}. Ajuste o expediente antes de cadastrar turno neste dia.`;
  }

  const inicio = asString(row.start_time ?? existing?.start_time);
  const fim = asString(row.end_time ?? existing?.end_time);
  if (!inicio || !fim) return null;

  if (
    timeToMinutes(inicio) < timeToMinutes(String(envelope.open_time)) ||
    timeToMinutes(fim) > timeToMinutes(String(envelope.close_time))
  ) {
    return (
      `Grade semanal: a barbearia funciona das ${hhmm(envelope.open_time)} às ${hhmm(envelope.close_time)} ` +
      `${DIA_PT[diaNum]}. O turno ${hhmm(inicio)}–${hhmm(fim)} fica fora do expediente — ajuste o horário ou ` +
      `peça ao administrador para ampliar o funcionamento.`
    );
  }

  return null;
}

/**
 * Grade semanal: o dono da linha precisa atender na barbearia E o turno precisa
 * caber no expediente. As duas coisas em ordem, porque a primeira falha é a
 * mais informativa.
 */
export function validateWeeklySchedule(row: MockRow, existing?: MockRow): string | null {
  return (
    validateBarberOwnedRow(row, "Grade semanal") ??
    validateShiftWithinBusinessHours(row, existing)
  );
}

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
/* Autorização das escritas administrativas                           */
/* ================================================================== */

/**
 * Quem pode executar cada operação administrativa.
 *
 * As demais funções deste arquivo validam *o dado* (tenant coerente,
 * aritmética, unicidade). Aqui validamos *o executor* — a sessão fictícia
 * lida de src/mocks/session.ts. Uma violação aqui vira MOCK_FORBIDDEN;
 * uma violação de dado vira MOCK_RULE.
 *
 * Isto não é RLS: cobre as escritas que passam pelo query builder. As RPCs
 * têm a própria checagem de tenant em src/mocks/client.ts.
 */
export type MockOperation = "insert" | "update" | "delete";

function rolesOfActorIn(barbershopId: string): Set<string> {
  const actor = getMockActor();
  if (!actor) return new Set();

  return new Set(
    getTableRows("user_roles")
      .filter((row) => row.user_id === actor.id && row.barbershop_id === barbershopId)
      .map((row) => String(row.role)),
  );
}

function actorIsAdminOf(barbershopId: string): boolean {
  return rolesOfActorIn(barbershopId).has("admin_barbearia");
}

function actorIsStaffOf(barbershopId: string): boolean {
  const roles = rolesOfActorIn(barbershopId);
  return roles.has("admin_barbearia") || roles.has("barbeiro");
}

/** super_admin é global: não está preso a uma barbearia. */
function actorIsSuperAdmin(): boolean {
  const actor = getMockActor();
  if (!actor) return false;

  return getTableRows("user_roles").some(
    (row) => row.user_id === actor.id && row.role === "super_admin",
  );
}

/** Dono registrado da barbearia — usado só na exceção do onboarding. */
function actorOwns(barbershopId: string): boolean {
  const actor = getMockActor();
  if (!actor) return false;

  return getTableRows("barbershops").some(
    (row) => row.id === barbershopId && row.owner_id === actor.id,
  );
}

const NO_SESSION = "Sem sessão ativa: faça login para executar esta operação.";

function tenantOf(row: MockRow, existing?: MockRow): string {
  return asString(existing?.barbershop_id) ?? asString(row.barbershop_id) ?? "";
}

/* ---------------- por tabela ---------------- */

/** Campos administrativos da barbearia: só o super_admin (AdminDashboard) os altera. */
const BARBERSHOP_ADMIN_FIELDS = ["plan_id", "status"] as const;

function authorizeBarbershop(operation: MockOperation, row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();

  // Criar barbearia é o onboarding — permitido a qualquer usuário autenticado,
  // mas SOMENTE para si mesmo: owner_id precisa ser o próprio usuário
  // (espelha a policy real `WITH CHECK (owner_id = auth.uid())`).
  if (operation === "insert") {
    if (!actor) return NO_SESSION;
    if (asString(row.owner_id) !== actor.id) {
      return "Onboarding: só é possível criar uma barbearia para o próprio usuário.";
    }
    return null;
  }

  if (!actor) return NO_SESSION;

  const shopId = asString(existing?.id) ?? asString(row.id) ?? "";

  // Alterar plano ou status é uma operação administrativa da plataforma:
  // reservada ao super_admin (o único caminho na interface é o AdminDashboard).
  // Um admin_barbearia — mesmo dono — não muda plan_id/status por payload.
  if (operation === "update" && existing) {
    const changesAdminField = BARBERSHOP_ADMIN_FIELDS.some(
      (field) => field in row && row[field] !== existing[field],
    );
    if (changesAdminField && !actorIsSuperAdmin()) {
      return "Apenas o super admin pode alterar o plano ou o status de uma barbearia.";
    }
  }

  // super_admin administra a plataforma; o admin da barbearia gerencia as
  // demais configurações (nome, cores, políticas) da própria barbearia.
  if (actorIsSuperAdmin()) return null;
  if (actorIsAdminOf(shopId)) return null;

  return "Apenas o administrador desta barbearia pode alterar as configurações.";
}

/** Escritas em `plan_change_logs`: apenas super_admin (espelha a RLS real). */
function authorizePlanChangeLog(): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;
  if (actorIsSuperAdmin()) return null;
  return "Apenas o super admin pode registrar mudanças de plano.";
}

/**
 * Escritas em `subscriptions`: no banco real só o service_role (webhook Paddle)
 * grava. No modo offline não há service_role nem Paddle, então nenhuma escrita
 * de assinatura pelo cliente é aceita — evita "marcar como pago" sem cobrança.
 */
function authorizeSubscription(): string | null {
  return "Modo offline: assinaturas não podem ser gravadas pelo cliente (dependem do webhook do Paddle).";
}

function authorizeUserRole(operation: MockOperation, row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;

  const barbershopId = tenantOf(row, existing);
  const targetUser = asString(existing?.user_id) ?? asString(row.user_id);
  const role = asString(existing?.role) ?? asString(row.role);

  if (operation === "insert") {
    // Auto-atribuição de cliente: o próprio usuário ao visitar a página
    // pública da barbearia (use-auto-client-role / agendar.$slug).
    if (role === "cliente" && targetUser === actor.id) return null;

    // Onboarding: o dono recém-criado vira admin da própria barbearia.
    if (role === "admin_barbearia" && targetUser === actor.id && actorOwns(barbershopId)) {
      return null;
    }
  }

  if (actorIsAdminOf(barbershopId)) return null;

  return "Apenas o administrador desta barbearia pode gerenciar a equipe.";
}

function authorizeTeamInvitation(_operation: MockOperation, row: MockRow, existing?: MockRow): string | null {
  if (!getMockActor()) return NO_SESSION;

  if (actorIsAdminOf(tenantOf(row, existing))) return null;
  return "Apenas o administrador desta barbearia pode gerenciar convites.";
}

function authorizeService(_operation: MockOperation, row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;

  const barbershopId = tenantOf(row, existing);
  if (actorIsAdminOf(barbershopId)) return null;

  // Um profissional pode manter os próprios serviços, mas não associar
  // serviço a outra pessoa.
  const targetBarber = asString(row.barber_id) ?? asString(existing?.barber_id);
  if (actorIsStaffOf(barbershopId) && targetBarber === actor.id) return null;

  return "Apenas o administrador desta barbearia pode associar serviços a outros profissionais.";
}

/**
 * Expediente da barbearia: escrita é da administração do próprio tenant.
 * Espelha a policy "Admins manage business hours of their barbershop"
 * (migration 20260805170000), incluindo o `super_admin` — sem ele, ninguém
 * conserta o expediente de uma barbearia com problema.
 */
function authorizeBusinessHours(row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;

  const barbershopId = tenantOf(row, existing);
  if (actorIsSuperAdmin() || actorIsAdminOf(barbershopId)) return null;

  return "Apenas o administrador desta barbearia pode definir o horário de funcionamento.";
}

/**
 * Grade semanal: cada pessoa gerencia a SUA, e só o super_admin alcança a de
 * terceiros. Espelha as policies de 20260415174831 — repare que
 * `admin_barbearia` NÃO está nelas: o admin VÊ a grade do tenant, mas não a
 * altera.
 *
 * O mock não modelava isso, e a diferença importa: é justamente por causa dela
 * que resolver conflito de expediente precisou de RPC (20260805180000). Sem
 * esta regra aqui, o harness "provaria" um fluxo que o banco recusaria.
 */
function authorizeWeeklySchedule(row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;
  if (actorIsSuperAdmin()) return null;

  const dono = asString(row.barber_id) ?? asString(existing?.barber_id);
  if (dono === actor.id) return null;

  return "Cada profissional gerencia apenas a própria agenda.";
}

/**
 * Ponto único de autorização. Devolve a mensagem de recusa, ou `null`
 * quando a operação é permitida.
 */
export function authorizeWrite(
  table: string,
  operation: MockOperation,
  row: MockRow,
  existing?: MockRow,
): string | null {
  switch (table) {
    case "barbershops":
      return authorizeBarbershop(operation, row, existing);
    case "user_roles":
      return authorizeUserRole(operation, row, existing);
    case "team_invitations":
      return authorizeTeamInvitation(operation, row, existing);
    case "services":
      return authorizeService(operation, row, existing);
    case "plan_change_logs":
      return authorizePlanChangeLog();
    case "subscriptions":
      return authorizeSubscription();
    case "reviews":
      return authorizeReview(operation, row, existing);
    case "notifications":
      return authorizeNotification(operation, row, existing);
    case "tickets":
      return authorizeTicket(row, existing);
    case "ticket_items":
      return authorizeTicketItem(row, existing);
    case "contact_submissions":
      return authorizeContactSubmission(operation);
    case "business_hours":
      return authorizeBusinessHours(row, existing);
    case "weekly_schedule":
      return authorizeWeeklySchedule(row, existing);
    default:
      return null;
  }
}

/**
 * `contact_submissions` tem INSERT liberado para anon e authenticated — é o
 * formulário público de `/contato`, e é assim no banco real. O que NÃO existe
 * é policy de UPDATE ou DELETE: uma vez enviada, a mensagem não é editada nem
 * apagada por ninguém pela API, nem pelo super_admin.
 *
 * Isto é a RLS. O conteúdo do INSERT é conferido em `validateContactSubmission`.
 */
function authorizeContactSubmission(operation: MockOperation): string | null {
  if (operation === "insert") return null;
  return "Mensagens de contato não podem ser alteradas nem removidas.";
}

/**
 * Limites de conteúdo de `contact_submissions`. Os mesmos números vivem em três
 * lugares: o formulário (`src/routes/contato.tsx`), as CHECK constraints da
 * migration 20260729120000 e este objeto. O harness `mensagens-contato` compara
 * os daqui com os do `.sql` — divergir faz a suíte falhar.
 */
export const CONTACT_LIMITS = { name: 100, email: 255, phone: 20, message: 2000 } as const;

/** Mesma expressão do formulário e da constraint: algo@algo.algo, sem espaços. */
const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Teto de vazão por e-mail, espelhando o trigger
 * `enforce_contact_submission_rate_limit` (migration 20260729120000): até 3
 * mensagens do mesmo remetente a cada 10 minutos.
 */
export const CONTACT_RATE_LIMIT = { max: 3, windowMinutes: 10 } as const;

/**
 * SQLSTATEs que o banco devolve nas duas recusas, e que o mock repete para que
 * o formulário público possa distingui-las sem comparar texto de mensagem:
 *
 *   • `23514` — check_violation, das CHECK constraints de tamanho e formato;
 *   • `P0001` — o `RAISE EXCEPTION` do trigger de vazão.
 *
 * `/contato` ramifica em `P0001` para dizer ao visitante que ele já enviou
 * demais, em vez do erro genérico.
 */
export const CONTACT_CHECK_SQLSTATE = "23514";
export const CONTACT_RATE_LIMIT_SQLSTATE = "P0001";

/**
 * CHECK constraints e trigger de vazão de `contact_submissions` (migration
 * 20260729120000).
 *
 * Vive aqui, e não na tela, porque `anon` tem INSERT direto na Data API: a
 * validação de `contato.tsx` não alcança quem chama o PostgREST na mão, e o
 * mock precisa recusar o que o banco recusaria.
 *
 * `pending` são as outras linhas do mesmo insert em lote. O trigger real é
 * BEFORE INSERT por linha e enxerga as anteriores da mesma instrução, então
 * contá-las aqui é o que mantém as duas pontas com o mesmo resultado.
 */
export function validateContactSubmission(
  row: MockRow,
  pending: readonly MockRow[] = [],
): MockRuleViolation | null {
  /* ---- CHECK constraints: tamanho e formato (SQLSTATE 23514) ---- */

  const check = (message: string) => ({ message, code: CONTACT_CHECK_SQLSTATE });

  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (name.length < 1 || name.length > CONTACT_LIMITS.name) {
    return check(`Mensagem de contato: nome deve ter entre 1 e ${CONTACT_LIMITS.name} caracteres.`);
  }

  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (email.length < 1 || email.length > CONTACT_LIMITS.email) {
    return check(`Mensagem de contato: e-mail deve ter entre 1 e ${CONTACT_LIMITS.email} caracteres.`);
  }
  if (!CONTACT_EMAIL_PATTERN.test(email)) {
    return check("Mensagem de contato: e-mail em formato inválido.");
  }

  // Telefone é opcional — a coluna é anulável e o formulário grava NULL quando
  // o campo fica em branco. Só o que veio preenchido é medido.
  if (row.phone !== null && row.phone !== undefined) {
    const phone = typeof row.phone === "string" ? row.phone.trim() : "";
    if (phone.length < 1 || phone.length > CONTACT_LIMITS.phone) {
      return check(`Mensagem de contato: telefone deve ter até ${CONTACT_LIMITS.phone} caracteres.`);
    }
  }

  const message = typeof row.message === "string" ? row.message.trim() : "";
  if (message.length < 1 || message.length > CONTACT_LIMITS.message) {
    return check(
      `Mensagem de contato: mensagem deve ter entre 1 e ${CONTACT_LIMITS.message} caracteres.`,
    );
  }

  /* ---- trigger de vazão: mesmo e-mail em janela curta ---- */

  // Comparação normalizada, como o `lower(btrim(...))` do trigger: alternar
  // maiúsculas não pode zerar a contagem.
  const remetente = email.toLowerCase();
  const desde = Date.now() - CONTACT_RATE_LIMIT.windowMinutes * 60 * 1000;
  const recentes = [...getTableRows("contact_submissions"), ...pending].filter((existing) => {
    const outro = typeof existing.email === "string" ? existing.email.trim().toLowerCase() : "";
    if (outro !== remetente) return false;
    const quando = new Date(String(existing.created_at)).getTime();
    return Number.isFinite(quando) && quando > desde;
  }).length;

  if (recentes >= CONTACT_RATE_LIMIT.max) {
    return {
      message:
        "Muitas mensagens enviadas deste e-mail em pouco tempo. Tente novamente em alguns minutos.",
      code: CONTACT_RATE_LIMIT_SQLSTATE,
    };
  }

  return null;
}

/** Só a equipe da barbearia (ou super_admin) mexe em comandas — espelha a RLS. */
function authorizeTicket(row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;
  const shopId = asString(existing?.barbershop_id) ?? asString(row.barbershop_id) ?? "";
  if (actorIsSuperAdmin() || actorIsStaffOf(shopId)) return null;
  return "Comanda: apenas a equipe desta barbearia pode operar comandas.";
}

/** Itens seguem a permissão da comanda: staff do tenant da comanda. */
function authorizeTicketItem(row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;
  const ticketId = asString(existing?.ticket_id) ?? asString(row.ticket_id);
  const ticket = getTableRows("tickets").find((t) => t.id === ticketId);
  const shopId = asString(ticket?.barbershop_id) ?? asString(row.barbershop_id) ?? "";
  if (actorIsSuperAdmin() || actorIsStaffOf(shopId)) return null;
  return "Comanda: apenas a equipe desta barbearia pode alterar itens.";
}

/* ================================================================== */
/* Planos: limites e histórico                                        */
/* ================================================================== */

/** Papéis que consomem uma "vaga de profissional" (contam no barber_limit). */
const BARBER_LIMIT_ROLES = new Set(["barbeiro", "admin_barbearia"]);

/** Plano vinculado à barbearia, ou `null` se ela não tiver plano. */
function planOfBarbershop(barbershopId: string): MockRow | null {
  const shop = getTableRows("barbershops").find((row) => row.id === barbershopId);
  if (!shop) return null;
  const planId = asString(shop.plan_id);
  if (!planId) return null;
  return getTableRows("plans").find((row) => row.id === planId) ?? null;
}

/**
 * Por que uma barbearia não tem limite validável: ela não existe, ou existe mas
 * o `plan_id` está ausente/apontando para um plano inexistente. `null` = há um
 * plano válido. Serve para o mock falhar de forma FECHADA com a mesma razão que
 * o banco real usa, em vez de devolver um genérico "limite atingido".
 */
function planResolutionFailure(barbershopId: string): "no_barbershop" | "no_plan" | null {
  const shop = getTableRows("barbershops").find((row) => row.id === barbershopId);
  if (!shop) return "no_barbershop";
  return planOfBarbershop(barbershopId) ? null : "no_plan";
}

/**
 * Número de profissionais ativos/vinculados de uma barbearia — as linhas de
 * `user_roles` com papel de barbeiro ou admin. É a mesma contagem que a RPC
 * `check_barber_limit` faz no banco real.
 */
export function countActiveBarbers(barbershopId: string): number {
  return getTableRows("user_roles").filter(
    (row) =>
      row.barbershop_id === barbershopId && BARBER_LIMIT_ROLES.has(String(row.role)),
  ).length;
}

/**
 * `true` se a barbearia AINDA pode incluir um profissional (equivalente ao
 * booleano da RPC `check_barber_limit`). `null` no limite → ilimitado.
 *
 * FALHA FECHADA, como o banco: `check_barber_limit` (migration
 * 20260720130000) devolve `false` quando a barbearia não existe ou quando o
 * JOIN com `plans` não acha plano. O mock devolvia `true` nesses casos, o que
 * dava capacidade ilimitada justamente ao estado inconsistente.
 */
export function barbershopUnderBarberLimit(barbershopId: string): boolean {
  if (planResolutionFailure(barbershopId)) return false;
  const limit = planOfBarbershop(barbershopId)?.barber_limit;
  if (limit === null || limit === undefined) return true;
  return countActiveBarbers(barbershopId) < Number(limit);
}

/**
 * `true` se a barbearia ainda pode registrar um agendamento no mês
 * (equivalente à RPC `check_appointment_limit`, que lê o contador em cache).
 *
 * Mesma falha fechada: `check_appointment_limit` (migration 20260720120000)
 * já retorna `false` para barbearia sem plano.
 */
export function barbershopUnderAppointmentLimit(barbershopId: string): boolean {
  if (planResolutionFailure(barbershopId)) return false;
  const shop = getTableRows("barbershops").find((row) => row.id === barbershopId);
  const limit = planOfBarbershop(barbershopId)?.appointment_limit;
  if (limit === null || limit === undefined) return true;
  const used = Number(shop?.appointments_this_month ?? 0);
  return used < Number(limit);
}

/**
 * Mensagem do banco real para o estado em que o limite nem chega a ser
 * calculável — o trigger `enforce_barber_limit` levanta exatamente estes dois
 * erros (migration 20260720130000).
 */
function planFailureMessage(
  failure: "no_barbershop" | "no_plan",
  barbershopId: string,
): string {
  return failure === "no_barbershop"
    ? `Barbearia "${barbershopId}" não existe.`
    : `Barbearia "${barbershopId}" não tem plano associado — não é possível validar o limite do plano.`;
}

/**
 * Barra, na camada de escrita, as inclusões que estouram o limite do plano —
 * não só na UI. Aplicada apenas em INSERT:
 *   - `user_roles` de um profissional → limite de profissionais;
 *   - `appointments` → limite de agendamentos do mês.
 */
export function checkInsertPlanLimit(table: string, row: MockRow): string | null {
  if (table === "user_roles") {
    const role = asString(row.role);
    if (!role || !BARBER_LIMIT_ROLES.has(role)) return null;
    const barbershopId = asString(row.barbershop_id);
    if (!barbershopId) return null;
    const failure = planResolutionFailure(barbershopId);
    if (failure) return planFailureMessage(failure, barbershopId);
    if (!barbershopUnderBarberLimit(barbershopId)) {
      const plan = planOfBarbershop(barbershopId);
      const limit = plan?.barber_limit;
      return `Limite de profissionais do plano atingido${
        limit !== null && limit !== undefined ? ` (${limit})` : ""
      }. Faça upgrade para adicionar mais.`;
    }
  }

  if (table === "appointments") {
    const barbershopId = asString(row.barbershop_id);
    if (!barbershopId) return null;
    const failure = planResolutionFailure(barbershopId);
    if (failure) return planFailureMessage(failure, barbershopId);
    if (!barbershopUnderAppointmentLimit(barbershopId)) {
      const plan = planOfBarbershop(barbershopId);
      const limit = plan?.appointment_limit;
      return `Limite de agendamentos do plano atingido${
        limit !== null && limit !== undefined ? ` (${limit}/mês)` : ""
      }. Faça upgrade para continuar agendando.`;
    }
  }

  return null;
}

/**
 * Valida um registro de mudança de plano: barbearia e planos referenciados
 * precisam existir (FKs de `plan_change_logs`).
 */
export function validatePlanChangeLog(row: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  const newPlanId = asString(row.new_plan_id);
  const changedBy = asString(row.changed_by);

  if (!barbershopId || !newPlanId || !changedBy) {
    return "Histórico de plano: barbearia, novo plano e autor são obrigatórios.";
  }
  if (!barbershopExists(barbershopId)) {
    return `Histórico de plano: barbearia "${barbershopId}" não existe.`;
  }

  const plans = getTableRows("plans");
  if (!plans.some((plan) => plan.id === newPlanId)) {
    return `Histórico de plano: o novo plano "${newPlanId}" não existe.`;
  }

  const oldPlanId = asString(row.old_plan_id);
  if (oldPlanId && !plans.some((plan) => plan.id === oldPlanId)) {
    return `Histórico de plano: o plano anterior "${oldPlanId}" não existe.`;
  }

  return null;
}

/* ================================================================== */
/* Avaliações (reviews)                                               */
/* ================================================================== */

/** Mesmo limite de caracteres da UI (ReviewDialog / ReviewsShowcase). */
const REVIEW_TEXT_MAX = 500;

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max;
}

/**
 * Valida uma avaliação. No INSERT cobre as mesmas condições da policy real:
 * nota 1..5, e — quando há appointment_id — o agendamento precisa ser do
 * cliente, da mesma barbearia e estar `completed`, com uma única avaliação por
 * (cliente, agendamento). No UPDATE valida apenas os campos alterados.
 */
export function validateReview(row: MockRow, existing?: MockRow): string | null {
  if (existing) {
    if (row.rating !== undefined && !isIntegerInRange(row.rating, 1, 5)) {
      return "Avaliação: a nota deve ser um número inteiro de 1 a 5.";
    }
    if (row.comment != null && String(row.comment).length > REVIEW_TEXT_MAX) {
      return "Avaliação: o comentário deve ter no máximo 500 caracteres.";
    }
    if (row.reply != null && String(row.reply).length > REVIEW_TEXT_MAX) {
      return "Avaliação: a resposta deve ter no máximo 500 caracteres.";
    }
    return null;
  }

  const barbershopId = asString(row.barbershop_id);
  const clientId = asString(row.client_id);
  if (!barbershopId || !clientId) {
    return "Avaliação: barbearia e cliente são obrigatórios.";
  }
  if (!barbershopExists(barbershopId)) {
    return `Avaliação: barbearia "${barbershopId}" não existe.`;
  }
  if (!isIntegerInRange(row.rating, 1, 5)) {
    return "Avaliação: a nota deve ser um número inteiro de 1 a 5.";
  }
  if (row.comment != null && String(row.comment).length > REVIEW_TEXT_MAX) {
    return "Avaliação: o comentário deve ter no máximo 500 caracteres.";
  }

  const appointmentId = asString(row.appointment_id);
  if (appointmentId) {
    const appointment = getTableRows("appointments").find((item) => item.id === appointmentId);
    if (!appointment) return "Avaliação: agendamento não encontrado.";
    if (appointment.client_id !== clientId) {
      return "Avaliação: este agendamento não pertence ao cliente.";
    }
    if (appointment.barbershop_id !== barbershopId) {
      return "Avaliação: o agendamento pertence a outra barbearia.";
    }
    if (appointment.status !== "completed") {
      return "Avaliação: só é possível avaliar um atendimento concluído.";
    }
    // Única avaliação por (cliente, agendamento) — como a constraint real.
    const duplicated = getTableRows("reviews").some(
      (item) => item.client_id === clientId && item.appointment_id === appointmentId,
    );
    if (duplicated) return "Avaliação: este atendimento já foi avaliado.";
  }

  return null;
}

function reviewTenantOf(row: MockRow, existing?: MockRow): string {
  return asString(existing?.barbershop_id) ?? asString(row.barbershop_id) ?? "";
}

/**
 * Autoriza escrita em `reviews`. INSERT: só em nome do próprio cliente
 * (`client_id = auth.uid()`). UPDATE/DELETE: autor OU staff/super_admin da
 * barbearia (união das policies de autor e de resposta/moderação).
 */
function authorizeReview(operation: MockOperation, row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;

  if (operation === "insert") {
    if (asString(row.client_id) !== actor.id) {
      return "Avaliação: só é possível avaliar em seu próprio nome.";
    }
    return null;
  }

  const author = asString(existing?.client_id) ?? asString(row.client_id);
  const shopId = reviewTenantOf(row, existing);
  if (author === actor.id) return null;
  if (actorIsStaffOf(shopId) || actorIsSuperAdmin()) return null;

  return "Avaliação: sem permissão para alterar esta avaliação.";
}

/* ================================================================== */
/* Notificações internas                                              */
/* ================================================================== */

/**
 * Autoriza escrita em `notifications`. As notificações são criadas pelos
 * gatilhos internos (o cliente não insere). UPDATE/DELETE só nas próprias
 * (marcar como lida) — espelha a RLS `user_id = auth.uid()`.
 */
function authorizeNotification(operation: MockOperation, row: MockRow, existing?: MockRow): string | null {
  const actor = getMockActor();
  if (!actor) return NO_SESSION;

  if (operation === "insert") {
    return "Notificações são geradas pelo sistema, não podem ser criadas pelo usuário.";
  }

  const owner = asString(existing?.user_id) ?? asString(row.user_id);
  if (owner !== actor.id) {
    return "Notificações: você só pode alterar as suas próprias notificações.";
  }
  return null;
}

/**
 * Restringe o que o ator pode LER.
 *
 *   - `notifications`: cada usuário só enxerga as suas, mesmo que a consulta
 *     esqueça o filtro por `user_id`;
 *   - `contact_submissions`: só o super_admin lê. Espelha a policy
 *     "Super admins can read contact submissions" (migration 20260416012649):
 *     a tabela guarda nome, e-mail, telefone e texto livre de quem escreveu
 *     pelo site, e não pertence a nenhuma barbearia.
 *
 * As demais tabelas permanecem legíveis como antes.
 */
export function filterReadableRows(table: string, rows: MockRow[]): MockRow[] {
  if (table === "notifications") {
    const actor = getMockActor();
    if (!actor) return [];
    return rows.filter((row) => row.user_id === actor.id);
  }

  if (table === "contact_submissions") {
    return actorIsSuperAdmin() ? rows : [];
  }

  return rows;
}

/* ================================================================== */
/* Configurações da barbearia                                         */
/* ================================================================== */

/** Slugs que não podem virar subdomínio (colidem com rotas/hosts do app). */
const RESERVED_SLUGS = new Set(["_system", "www", "app", "api", "admin", "agendar", "dashboard"]);

/** Letras minúsculas, números e hífen; 3 a 63 caracteres; sem hífen nas pontas. */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

/**
 * Valida a barbearia. Cobre slug (único e bem formado), políticas e a
 * tentativa de trocar o tenant por payload.
 */
export function validateBarbershop(row: MockRow, existing?: MockRow): string | null {
  /* ---- não trocar de tenant por payload ---- */
  if (existing && row.id !== undefined && row.id !== existing.id) {
    return "Configurações: não é possível alterar o id da barbearia.";
  }

  /* ---- slug ---- */
  if (row.subdomain !== undefined) {
    const slug = asString(row.subdomain);
    if (!slug) return "Configurações: o link público não pode ficar vazio.";
    if (!SLUG_PATTERN.test(slug)) {
      return "Configurações: o link público aceita apenas letras minúsculas, números e hífen (3 a 63 caracteres).";
    }
    // `_system` já existe no banco real como sentinela; segue reservado.
    if (RESERVED_SLUGS.has(slug) && existing?.subdomain !== slug) {
      return `Configurações: "${slug}" é um link reservado.`;
    }

    const taken = getTableRows("barbershops").some(
      (shop) => shop.subdomain === slug && shop.id !== (existing?.id ?? row.id),
    );
    if (taken) return `Configurações: o link "${slug}" já está em uso por outra barbearia.`;
  }

  /* ---- plano precisa existir (FK barbershops.plan_id → plans.id) ---- */
  if (row.plan_id !== undefined && row.plan_id !== null) {
    const planExists = getTableRows("plans").some((plan) => plan.id === row.plan_id);
    if (!planExists) {
      return `Configurações: o plano "${asString(row.plan_id)}" não existe.`;
    }
  }

  /* ---- políticas ---- */
  for (const field of ["cancel_min_hours", "reschedule_min_hours", "noshow_max_count", "noshow_block_days"] as const) {
    if (row[field] === undefined) continue;
    const value = Number(row[field]);
    if (!Number.isFinite(value) || value < 0) {
      return `Configurações: "${field}" deve ser um número não negativo.`;
    }
  }

  // Só espaços conta como vazio — senão a barbearia fica sem nome na tela.
  if (row.name !== undefined && (asString(row.name) ?? "").trim() === "") {
    return "Configurações: o nome da barbearia é obrigatório.";
  }

  return null;
}

/* ================================================================== */
/* Equipe: papéis e convites                                          */
/* ================================================================== */

/** Papéis que a gestão de equipe pode atribuir. `super_admin` nunca entra. */
const ASSIGNABLE_ROLES = new Set(["barbeiro", "admin_barbearia", "cliente"]);

/** Papéis que a tela de equipe administra (os que aparecem na lista). */
const TEAM_ROLES = new Set(["barbeiro", "admin_barbearia"]);

function adminRoleRowsOf(barbershopId: string): MockRow[] {
  return getTableRows("user_roles").filter(
    (row) => row.barbershop_id === barbershopId && row.role === "admin_barbearia",
  );
}

/** Valida atribuição de papel: tenant, papel permitido e último admin. */
export function validateUserRole(row: MockRow, existing?: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  const userId = asString(row.user_id);
  const role = asString(row.role);

  if (!barbershopId || !userId || !role) {
    return "Equipe: barbearia, usuário e papel são obrigatórios.";
  }
  if (!barbershopExists(barbershopId)) {
    return `Equipe: barbearia "${barbershopId}" não existe.`;
  }
  if (!ASSIGNABLE_ROLES.has(role)) {
    return `Equipe: o papel "${role}" não pode ser atribuído pela gestão de equipe.`;
  }

  /* ---- duplicidade do mesmo papel ---- */
  const duplicated = getTableRows("user_roles").some(
    (item) =>
      item.id !== (existing?.id ?? row.id) &&
      item.user_id === userId &&
      item.barbershop_id === barbershopId &&
      item.role === role,
  );
  if (duplicated) return "Equipe: este usuário já tem esse papel nesta barbearia.";

  /* ---- um único papel de equipe por pessoa/barbearia ---- */
  // Espelha o trigger `enforce_single_staff_role` e o índice parcial
  // `user_roles_one_staff_role_per_barbershop` (migration 20260805160000).
  // `barbeiro` e `admin_barbearia` se excluem; `cliente` fica fora da regra, de
  // propósito, porque um admin pode agendar como qualquer pessoa.
  const OUTRO_PAPEL_DE_EQUIPE: Record<string, string> = {
    barbeiro: "admin_barbearia",
    admin_barbearia: "barbeiro",
  };
  const outro = OUTRO_PAPEL_DE_EQUIPE[role];
  if (outro) {
    // `item.id !== …` para que TROCAR o papel da própria linha continue
    // válido: a linha em edição não pode bloquear a si mesma.
    const jaTemOOutro = getTableRows("user_roles").some(
      (item) =>
        item.id !== (existing?.id ?? row.id) &&
        item.user_id === userId &&
        item.barbershop_id === barbershopId &&
        item.role === outro,
    );
    if (jaTemOOutro) {
      return outro === "admin_barbearia"
        ? "Equipe: esta pessoa já é administradora desta barbearia. Cada pessoa tem um único papel por barbearia — administradores já aparecem na lista de profissionais para agendamento."
        : "Equipe: esta pessoa já é barbeira desta barbearia. Cada pessoa tem um único papel por barbearia.";
    }
  }

  /* ---- rebaixar o último admin ---- */
  if (existing && existing.role === "admin_barbearia" && role !== "admin_barbearia") {
    const admins = adminRoleRowsOf(String(existing.barbershop_id));
    if (admins.length <= 1) {
      return "Equipe: esta barbearia ficaria sem administrador.";
    }
  }

  return null;
}

/** Impede remover o último administrador da barbearia. */
export function validateUserRoleRemoval(row: MockRow): string | null {
  if (row.role !== "admin_barbearia") return null;

  const admins = adminRoleRowsOf(String(row.barbershop_id));
  if (admins.length <= 1) {
    return "Equipe: não é possível remover o último administrador da barbearia.";
  }
  return null;
}

/* ---------------- convites ---------------- */

const INVITATION_STATUSES = new Set(["pending", "accepted", "expired", "cancelled"]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Convite vencido pela data, ainda marcado como pendente. */
export function invitationIsExpired(row: MockRow): boolean {
  const expiresAt = asString(row.expires_at);
  if (!expiresAt) return false;
  return expiresAt <= new Date().toISOString();
}

/** Estado efetivo do convite, já considerando a data de expiração. */
export function effectiveInvitationStatus(row: MockRow): string {
  const status = String(row.status ?? "pending");
  if (status === "pending" && invitationIsExpired(row)) return "expired";
  return status;
}

export function validateTeamInvitation(row: MockRow, existing?: MockRow): string | null {
  const barbershopId = asString(row.barbershop_id);
  const email = asString(row.email);
  const role = asString(row.role);

  if (!barbershopId || !email) {
    return "Convite: barbearia e email são obrigatórios.";
  }
  if (!barbershopExists(barbershopId)) {
    return `Convite: barbearia "${barbershopId}" não existe.`;
  }
  if (!EMAIL_PATTERN.test(email)) {
    return "Convite: email inválido.";
  }
  if (role && !TEAM_ROLES.has(role)) {
    return `Convite: o papel "${role}" não pode ser convidado.`;
  }

  const status = asString(row.status);
  if (status && !INVITATION_STATUSES.has(status)) {
    return `Convite: status "${status}" inválido.`;
  }

  /* ---- um convite pendente por email e barbearia ---- */
  if (!existing) {
    const duplicated = getTableRows("team_invitations").some(
      (item) =>
        item.barbershop_id === barbershopId &&
        String(item.email).toLowerCase() === email.toLowerCase() &&
        effectiveInvitationStatus(item) === "pending",
    );
    if (duplicated) {
      return "Convite: já existe um convite pendente para este email nesta barbearia.";
    }

    /* ---- limite de profissionais do plano (mesma regra da UI) ---- */
    if (!barbershopUnderBarberLimit(barbershopId)) {
      return "Convite: limite de profissionais do plano atingido. Faça upgrade para adicionar mais.";
    }

    /* ---- papel de equipe duplicado, barrado já no convite ---- */
    // Espelha `enforce_invite_single_staff_role` (migration 20260805160000):
    // falhar aqui é melhor do que falhar no clique de quem recebeu, com o
    // convite já gasto do ponto de vista de quem enviou. Como no SQL, só
    // alcança quem JÁ tem conta — para o resto, a regra de `user_roles` fecha
    // no aceite.
    const outroPapel = role === "barbeiro" ? "admin_barbearia" : role === "admin_barbearia" ? "barbeiro" : null;
    if (outroPapel) {
      // O e-mail vive nas contas fictícias, não em `profiles` — a tabela do
      // mock não tem essa coluna, assim como a real: no banco o vínculo é por
      // `auth.users`, que é outro schema.
      const convidado = MOCK_ACCOUNTS.find(
        (conta) => conta.email.toLowerCase() === email.toLowerCase(),
      );
      const jaEhOOutro =
        convidado &&
        getTableRows("user_roles").some(
          (item) =>
            item.user_id === convidado.id &&
            item.barbershop_id === barbershopId &&
            item.role === outroPapel,
        );
      if (jaEhOOutro) {
        return outroPapel === "admin_barbearia"
          ? "Convite: esta pessoa já é administradora desta barbearia. Cada pessoa tem um único papel por barbearia — administradores já aparecem na lista de profissionais para agendamento."
          : "Convite: esta pessoa já é barbeira desta barbearia. Cada pessoa tem um único papel por barbearia.";
      }
    }
  }

  /* ---- convite consumido não volta atrás ---- */
  if (existing) {
    const current = effectiveInvitationStatus(existing);
    if (current !== "pending" && status === "pending") {
      return `Convite: um convite ${current} não pode voltar a ficar pendente.`;
    }
  }

  return null;
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

/** Tolerância de centavos, a mesma usada pela interface de comandas. */
const MONEY_EPSILON = 0.01;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Estados da comanda no modelo de ciclo de vida (migration
 * 20260722260000): 'aberta' aceita mudanças; 'fechada'/'cancelada' são
 * imutáveis. Uma comanda sem status explícito é tratada como 'aberta'.
 */
function ticketStatus(ticket: MockRow): string {
  return String(ticket.status ?? "aberta");
}

/**
 * Valor do desconto — espelha `ticket_discount_value` no banco: percentual
 * ou fixo, nunca maior que o subtotal (total nunca fica negativo).
 */
export function ticketDiscountValue(subtotal: number, type: string, amount: number): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;
  const value = type === "percent" ? round2((subtotal * (amount || 0)) / 100) : amount || 0;
  return Math.min(subtotal, Math.max(0, value));
}

/**
 * Recalcula subtotal e total da comanda ABERTA a partir dos itens — espelha
 * o trigger `ticket_recalc` + a derivação de total do banco. Fechada/cancelada
 * não recalculam (imutáveis). Chamado como efeito colateral das escritas.
 */
export function recalcTicketTotals(ticketId: string): void {
  const tickets = getTableRows("tickets");
  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket || ticketStatus(ticket) !== "aberta") return;

  const subtotal = round2(
    getTableRows("ticket_items")
      .filter((item) => item.ticket_id === ticketId)
      .reduce((sum, item) => sum + Number(item.total ?? 0), 0),
  );
  const discount = ticketDiscountValue(
    subtotal,
    String(ticket.discount_type ?? "fixed"),
    Number(ticket.discount_amount ?? 0),
  );
  const total = Math.max(0, round2(subtotal - discount));

  setTableRows(
    "tickets",
    tickets.map((t) =>
      t.id === ticketId ? { ...t, subtotal, total, updated_at: new Date().toISOString() } : t,
    ),
  );
}

/**
 * Campos que o banco preencheria por trigger num item: tenant vem da comanda,
 * preço vem do catálogo (snapshot), total = preço × quantidade. O front nunca
 * decide preço nem total. Só computa; a validação fica em `validateTicketItem`.
 */
export function computeTicketItemFields(row: MockRow, existing?: MockRow): MockRow {
  const ticketId = asString(row.ticket_id) ?? asString(existing?.ticket_id);
  const ticket = getTableRows("tickets").find((t) => t.id === ticketId);
  const itemType = asString(row.item_type) ?? asString(existing?.item_type) ?? "custom";
  const quantity = Number(row.quantity ?? existing?.quantity ?? 1);

  const fields: MockRow = {};
  if (ticket) fields.barbershop_id = ticket.barbershop_id;

  if (existing) {
    // Preço não muda depois de lançado: mantém o snapshot original.
    fields.unit_price = Number(existing.unit_price ?? 0);
  } else if (itemType === "service") {
    const service = getTableRows("services").find((s) => s.id === row.service_id);
    fields.unit_price = Number(service?.price ?? 0);
    fields.product_id = null;
    if (!asString(row.description)) fields.description = String(service?.name ?? "Serviço");
  } else if (itemType === "product") {
    const product = getTableRows("products").find((p) => p.id === row.product_id);
    fields.unit_price = Number(product?.price ?? 0);
    fields.service_id = null;
    if (!asString(row.description)) fields.description = String(product?.name ?? "Produto");
  } else {
    fields.unit_price = Number(row.unit_price ?? 0);
    fields.service_id = null;
    fields.product_id = null;
  }

  fields.total = round2(Number(fields.unit_price) * quantity);
  return fields;
}

/**
 * Valida a comanda no modelo de ciclo de vida: coerência de tenant e
 * imutabilidade de comanda fechada/cancelada. O total é derivado no banco/mock,
 * então aqui NÃO se checa aritmética (isso é `recalcTicketTotals`).
 */
export function validateTicket(row: MockRow, existing?: MockRow): string | null {
  /* ---- imutabilidade: fechada/cancelada não mudam mais ---- */
  if (existing && ticketStatus(existing) !== "aberta") {
    return `comanda_imutavel: uma comanda ${ticketStatus(existing)} não pode mais ser alterada.`;
  }

  const barbershopId = asString(existing?.barbershop_id) ?? asString(row.barbershop_id);
  const clientId = asString(row.client_id) ?? asString(existing?.client_id);
  const barberId = asString(row.barber_id) ?? asString(existing?.barber_id);
  const appointmentId = asString(row.appointment_id) ?? asString(existing?.appointment_id);

  if (!barbershopId || !barberId) {
    return "Comanda: barbearia e profissional são obrigatórios.";
  }
  if (!barbershopExists(barbershopId)) {
    return `Comanda: barbearia "${barbershopId}" não existe.`;
  }

  /* ---- transição de status válida ---- */
  const nextStatus = asString(row.status);
  if (nextStatus && !["aberta", "fechada", "cancelada"].includes(nextStatus)) {
    return `Comanda: status "${nextStatus}" inválido.`;
  }

  /* ---- coerência com a barbearia ---- */
  if (!attendingBarbershopsOf(barberId).has(barbershopId)) {
    return "tenant_invalido: o profissional não atende nesta barbearia.";
  }
  // Cliente é opcional na comanda aberta; quando informado, precisa pertencer.
  if (clientId && !clientBelongsTo(clientId, barbershopId)) {
    return "Comanda: este cliente não pertence a esta barbearia.";
  }
  if (appointmentId) {
    const appointment = getTableRows("appointments").find((item) => item.id === appointmentId);
    if (!appointment) return "Comanda: agendamento não encontrado.";
    if (appointment.barbershop_id !== barbershopId) {
      return "tenant_invalido: o agendamento pertence a outra barbearia.";
    }
  }

  /* ---- desconto não-negativo (o total é derivado, não checado aqui) ---- */
  const discount = Number(row.discount_amount ?? existing?.discount_amount ?? 0);
  if (!Number.isFinite(discount) || discount < 0) {
    return "Comanda: desconto não pode ser negativo.";
  }

  return null;
}

/**
 * Valida um item: pertence a uma comanda ABERTA do mesmo tenant, produto ativo,
 * quantidade positiva. Preço/total são preenchidos por `computeTicketItemFields`.
 */
export function validateTicketItem(row: MockRow, _pending: readonly MockRow[] = []): string | null {
  const ticketId = asString(row.ticket_id);
  if (!ticketId) return "Item: comanda é obrigatória.";

  const ticket = getTableRows("tickets").find((item) => item.id === ticketId);
  if (!ticket) return "Item: comanda não encontrada.";

  const barbershopId = asString(ticket.barbershop_id);
  // O tenant do item é sempre o da comanda (autoritativo, não vem do front).
  const rowBarbershop = asString(row.barbershop_id);
  if (rowBarbershop && rowBarbershop !== barbershopId) {
    return "tenant_invalido: o item pertence a outra barbearia.";
  }

  /* ---- só comanda aberta aceita mudança de item ---- */
  if (ticketStatus(ticket) !== "aberta") {
    return "comanda_nao_aberta: itens só mudam com a comanda aberta.";
  }

  const itemType = asString(row.item_type) ?? "custom";

  /* ---- serviço/produto do mesmo tenant; produto precisa estar ativo ---- */
  if (itemType === "service") {
    const serviceId = asString(row.service_id);
    if (!serviceId) return "Item: serviço é obrigatório para item de serviço.";
    const service = getTableRows("services").find((item) => item.id === serviceId);
    if (!service) return "Item: serviço não encontrado.";
    if (service.barbershop_id !== barbershopId) {
      return "tenant_invalido: o serviço pertence a outra barbearia.";
    }
  } else if (itemType === "product") {
    const productId = asString(row.product_id);
    if (!productId) return "Item: produto é obrigatório para item de produto.";
    const product = getTableRows("products").find((item) => item.id === productId);
    if (!product) return "Item: produto não encontrado.";
    if (product.barbershop_id !== barbershopId) {
      return "tenant_invalido: o produto pertence a outra barbearia.";
    }
    if (product.active !== true) {
      return "produto_inativo: este produto está inativo.";
    }
  } else if (itemType === "custom") {
    if (!asString(row.description)) {
      return "Item: descrição é obrigatória para item avulso.";
    }
    if (Number(row.unit_price ?? 0) < 0) {
      return "Item: o preço unitário não pode ser negativo.";
    }
  } else {
    return "Item: tipo inválido.";
  }

  /* ---- quantidade positiva ---- */
  const quantity = Number(row.quantity ?? 0);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return "Item: a quantidade deve ser inteira e maior que zero.";
  }

  return null;
}

/**
 * Valida um pagamento: comanda do mesmo tenant, forma do mesmo tenant, valor
 * positivo. Os pagamentos passam a ser gravados pela RPC `close_ticket` (efeito
 * transacional); a soma-vs-total é validada lá, não aqui.
 */
export function validateTicketPayment(
  row: MockRow,
  _pending: readonly MockRow[] = [],
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

  return null;
}
