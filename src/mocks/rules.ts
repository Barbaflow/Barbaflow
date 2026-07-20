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
