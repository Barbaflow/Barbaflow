/**
 * Cliente Supabase fictício do modo offline (VITE_DATA_SOURCE=mock).
 *
 * Expõe a mesma superfície usada pelo app (auth, from, rpc, channel, storage,
 * functions) lendo e gravando apenas em localStorage. Nenhuma requisição de
 * rede é feita e `createClient` do supabase-js nunca é chamado.
 */
import { getMockSessionEmail, getMockSessionUserId, mockAuth } from "./auth";
import { MockQueryBuilder, type MockResult } from "./query-builder";
import { getTableRows, setTableRows, type MockRow } from "./store";
import { dayOfWeekOf, minutesToTime, timeToMinutes } from "./fixtures";
import {
  barbershopUnderAppointmentLimit,
  barbershopUnderBarberLimit,
  effectiveInvitationStatus,
} from "./rules";

/* ------------------------------------------------------------------ */
/* RPCs                                                                */
/* ------------------------------------------------------------------ */

type RpcArgs = Record<string, unknown>;
type RpcHandler = (args: RpcArgs) => unknown;

function rolesOf(userId: unknown): MockRow[] {
  return getTableRows("user_roles").filter((row) => row.user_id === userId);
}

const RPC_HANDLERS: Record<string, RpcHandler> = {
  has_role: (args) => rolesOf(args._user_id).some((row) => row.role === args._role),

  has_role_in_barbershop: (args) =>
    rolesOf(args._user_id).some(
      (row) => row.role === args._role && row.barbershop_id === args._barbershop_id,
    ),

  get_public_barbers: (args) =>
    getTableRows("user_roles")
      .filter((row) => row.role === "barbeiro" && row.barbershop_id === args._barbershop_id)
      .map((row) => ({ user_id: row.user_id })),

  /**
   * Janelas de atendimento de um profissional numa data — espelha a RPC real
   * (migration 20260722210000). Deriva da grade semanal (menos os bloqueios do
   * dia) e soma as exceções não-livres lançadas na agenda, para o fluxo público
   * não depender de ninguém ter clicado em "Gerar Agenda".
   */
  get_public_availability_windows: (args) => {
    const data = String(args._date ?? "");
    const bloqueado = getTableRows("schedule_blocks").some(
      (row) =>
        row.barbershop_id === args._barbershop_id &&
        row.barber_id === args._barber_id &&
        row.block_date === data,
    );
    // `Date.UTC` sobre os componentes: dia da semana sem envolver fuso algum.
    const diaDaSemana = new Date(
      Date.UTC(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10))),
    ).getUTCDay();

    const turnos = bloqueado
      ? []
      : getTableRows("weekly_schedule")
          .filter(
            (row) =>
              row.barbershop_id === args._barbershop_id &&
              row.barber_id === args._barber_id &&
              row.is_active &&
              row.day_of_week === diaDaSemana,
          )
          .map((row) => ({
            start_time: row.start_time,
            end_time: row.end_time,
            status: "livre",
          }));

    const excecoes = getTableRows("availability")
      .filter(
        (row) =>
          row.barbershop_id === args._barbershop_id &&
          row.barber_id === args._barber_id &&
          row.date === data &&
          row.status !== "livre",
      )
      .map((row) => ({ start_time: row.start_time, end_time: row.end_time, status: row.status }));

    return [...turnos, ...excecoes];
  },

  /**
   * Intervalos ocupados de um profissional numa data — espelha a RPC real
   * (migration 20260722190000), usada pelo fluxo público porque `appointments`
   * é fechada para visitante anônimo. Devolve só horários, sem dado de cliente.
   */
  get_public_busy_intervals: (args) =>
    getTableRows("appointments")
      .filter(
        (row) =>
          row.barbershop_id === args._barbershop_id &&
          row.barber_id === args._barber_id &&
          row.date === args._date &&
          row.status !== "cancelled",
      )
      .map((row) => ({ start_time: row.start_time, end_time: row.end_time })),

  get_barber_display_names: (args) => {
    const ids = Array.isArray(args._user_ids) ? args._user_ids : [];
    return getTableRows("profiles")
      .filter((row) => ids.includes(row.user_id))
      .map((row) => ({
        user_id: row.user_id,
        display_name: row.full_name ?? "Profissional",
        avatar_url: row.avatar_url ?? null,
      }));
  },

  /**
   * Telefone do cliente. Só responde se quem pede for staff de alguma
   * barbearia à qual esse cliente pertence — o telefone não é público.
   */
  get_client_phone: (args) => {
    if (!currentUserSharesBarbershopWith(args._client_id)) return null;
    return getTableRows("profiles").find((row) => row.user_id === args._client_id)?.phone ?? null;
  },

  /**
   * Clientes da barbearia, agregados a partir dos agendamentos.
   * Nunca cruza a fronteira do tenant: só lê linhas do _barbershop_id pedido.
   */
  get_barbershop_clients: (args) => {
    const barbershopId = args._barbershop_id;
    const appointments = getTableRows("appointments").filter(
      (row) => row.barbershop_id === barbershopId,
    );
    const profiles = getTableRows("profiles");
    const blocks = getTableRows("client_blocks").filter(
      (row) => row.barbershop_id === barbershopId,
    );

    const nowISO = new Date().toISOString();

    const byClient = new Map<string, MockRow[]>();
    for (const appointment of appointments) {
      const clientId = String(appointment.client_id);
      const list = byClient.get(clientId) ?? [];
      list.push(appointment);
      byClient.set(clientId, list);
    }

    return Array.from(byClient.entries()).map(([clientId, rows]) => {
      const profile = profiles.find((row) => row.user_id === clientId);
      // Só bloqueios ainda vigentes contam — um bloqueio expirado não pode
      // deixar o cliente marcado como bloqueado para sempre na lista.
      const block = blocks.find(
        (row) => row.client_id === clientId && String(row.blocked_until) > nowISO,
      );
      const countBy = (status: string) =>
        rows.filter((row) => row.status === status).length;
      const dates = rows.map((row) => String(row.date)).sort();

      return {
        client_id: clientId,
        client_name: profile?.full_name ?? "Cliente",
        client_phone: profile?.phone ?? null,
        client_avatar: profile?.avatar_url ?? null,
        total_appointments: rows.length,
        completed_count: countBy("completed"),
        cancelled_count: countBy("cancelled"),
        noshow_count: countBy("no_show"),
        first_appointment_at: dates[0] ?? null,
        last_appointment_at: dates[dates.length - 1] ?? null,
        manual_block_reason: block?.reason ?? null,
        manual_blocked_until: block?.blocked_until ?? null,
      };
    });
  },

  /**
   * Relatório de faltas dos últimos `_days` dias (padrão 30).
   * Só considera agendamentos da barbearia informada.
   */
  get_noshow_report: (args) => {
    const barbershopId = args._barbershop_id;
    const days = typeof args._days === "number" && args._days > 0 ? args._days : 30;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceISO = since.toISOString().slice(0, 10);

    const appointments = getTableRows("appointments").filter(
      (row) => row.barbershop_id === barbershopId && String(row.date) >= sinceISO,
    );
    const profiles = getTableRows("profiles");
    const blocks = getTableRows("client_blocks").filter(
      (row) => row.barbershop_id === barbershopId,
    );
    const nowISO = new Date().toISOString();

    const byClient = new Map<string, MockRow[]>();
    for (const appointment of appointments) {
      const clientId = String(appointment.client_id);
      const list = byClient.get(clientId) ?? [];
      list.push(appointment);
      byClient.set(clientId, list);
    }

    return Array.from(byClient.entries())
      .map(([clientId, rows]) => {
        const noShows = rows.filter((row) => row.status === "no_show");
        const profile = profiles.find((row) => row.user_id === clientId);
        // Só bloqueios ainda vigentes contam como bloqueio manual.
        const block = blocks.find(
          (row) => row.client_id === clientId && String(row.blocked_until) > nowISO,
        );
        const noShowDates = noShows.map((row) => String(row.date)).sort();

        return {
          client_id: clientId,
          client_name: profile?.full_name ?? "Cliente",
          client_avatar: profile?.avatar_url ?? null,
          noshow_count: noShows.length,
          total_appointments: rows.length,
          last_noshow_at: noShowDates[noShowDates.length - 1] ?? null,
          manual_block_reason: block?.reason ?? null,
          manual_blocked_until: block?.blocked_until ?? null,
        };
      })
      .filter((row) => row.noshow_count > 0)
      .sort((a, b) => b.noshow_count - a.noshow_count);
  },

  /**
   * Aceita um convite de equipe pelo token.
   *
   * Devolve `{ success, error?, barbershop_id? }`, o formato que
   * src/routes/convite.tsx espera. Nenhum email é enviado: o convite existe
   * apenas como linha em team_invitations e o link é copiado na interface.
   */
  accept_team_invitation: (args) => {
    const token = args._token;
    const userId = getMockSessionUserId();
    const sessionEmail = getMockSessionEmail();

    if (!userId) {
      return { success: false, error: "Faça login para aceitar o convite." };
    }

    const invitation = getTableRows("team_invitations").find((row) => row.token === token);
    if (!invitation) {
      return { success: false, error: "Convite não encontrado." };
    }

    const status = effectiveInvitationStatus(invitation);
    if (status !== "pending") {
      const labels: Record<string, string> = {
        accepted: "Este convite já foi aceito.",
        cancelled: "Este convite foi cancelado.",
        expired: "Este convite expirou.",
      };
      return { success: false, error: labels[status] ?? "Convite indisponível." };
    }

    /* ---- o convite é nominal: só o destinatário pode aceitar ---- */
    const invitedEmail = String(invitation.email ?? "").trim().toLowerCase();
    const currentEmail = (sessionEmail ?? "").trim().toLowerCase();

    if (!currentEmail || currentEmail !== invitedEmail) {
      // Nenhum profile ou papel é criado aqui: a recusa acontece antes de
      // qualquer escrita.
      return {
        success: false,
        error: `Este convite foi enviado para ${invitation.email}. Entre com essa conta para aceitá-lo.`,
      };
    }

    const barbershopId = String(invitation.barbershop_id);
    const role = String(invitation.role ?? "barbeiro");
    const timestamp = new Date().toISOString();

    /* ---- profile: cria se ainda não existir ---- */
    const profiles = getTableRows("profiles");
    if (!profiles.some((row) => row.user_id === userId)) {
      setTableRows("profiles", [
        ...profiles,
        {
          id: newMockId(),
          user_id: userId,
          full_name: String(invitation.email).split("@")[0],
          phone: null,
          avatar_url: null,
          created_at: timestamp,
          updated_at: timestamp,
        },
      ]);
    }

    /* ---- papel: não duplica se já existir ---- */
    const roles = getTableRows("user_roles");
    const alreadyHasRole = roles.some(
      (row) => row.user_id === userId && row.barbershop_id === barbershopId && row.role === role,
    );
    if (!alreadyHasRole) {
      setTableRows("user_roles", [
        ...roles,
        {
          id: newMockId(),
          user_id: userId,
          barbershop_id: barbershopId,
          role,
          created_at: timestamp,
        },
      ]);
    }

    /* ---- marca o convite como consumido ---- */
    setTableRows(
      "team_invitations",
      getTableRows("team_invitations").map((row) =>
        row.id === invitation.id
          ? { ...row, status: "accepted", updated_at: timestamp }
          : row,
      ),
    );

    return { success: true, barbershop_id: barbershopId };
  },

  /** Cria um cliente avulso (profile + papel) e devolve o novo user_id. */
  create_walkin_client: (args) => {
    const barbershopId = String(args._barbershop_id);
    const userId = newMockId();
    const timestamp = new Date().toISOString();

    setTableRows("profiles", [
      ...getTableRows("profiles"),
      {
        id: newMockId(),
        user_id: userId,
        full_name: args._full_name ?? "Cliente avulso",
        phone: args._phone ?? null,
        avatar_url: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    setTableRows("user_roles", [
      ...getTableRows("user_roles"),
      {
        id: newMockId(),
        user_id: userId,
        barbershop_id: barbershopId,
        role: "cliente",
        created_at: timestamp,
      },
    ]);

    return userId;
  },

  /**
   * Regenera a disponibilidade do barbeiro no intervalo, a partir da grade
   * semanal, pulando datas bloqueadas. Devolve quantos slots foram criados.
   */
  generate_availability_from_schedule: (args) => {
    const barbershopId = String(args._barbershop_id);
    const barberId = String(args._barber_id);
    const startDate = String(args._start_date);
    const endDate = String(args._end_date);
    const timestamp = new Date().toISOString();

    const shifts = getTableRows("weekly_schedule").filter(
      (row) =>
        row.barbershop_id === barbershopId && row.barber_id === barberId && row.is_active === true,
    );
    const blocks = getTableRows("schedule_blocks").filter(
      (row) => row.barbershop_id === barbershopId && row.barber_id === barberId,
    );
    const appointments = getTableRows("appointments").filter(
      (row) =>
        row.barbershop_id === barbershopId &&
        row.barber_id === barberId &&
        row.status !== "cancelled",
    );

    // Substitui a janela pedida, preservando o restante da tabela.
    const preserved = getTableRows("availability").filter((row) => {
      const sameBarber = row.barbershop_id === barbershopId && row.barber_id === barberId;
      if (!sameBarber) return true;
      const date = String(row.date);
      return date < startDate || date > endDate;
    });

    const created: MockRow[] = [];

    for (const date of datesBetween(startDate, endDate)) {
      const dow = dayOfWeekOf(date);
      if (blocks.some((block) => block.block_date === date)) continue;

      for (const shift of shifts) {
        if (shift.day_of_week !== dow) continue;

        const shiftStart = timeToMinutes(String(shift.start_time));
        const shiftEnd = timeToMinutes(String(shift.end_time));

        for (let start = shiftStart; start + SLOT_STEP <= shiftEnd; start += SLOT_STEP) {
          const end = start + SLOT_STEP;
          const taken = appointments.some(
            (appointment) =>
              appointment.date === date &&
              start < timeToMinutes(String(appointment.end_time)) &&
              timeToMinutes(String(appointment.start_time)) < end,
          );

          created.push({
            id: newMockId(),
            barbershop_id: barbershopId,
            barber_id: barberId,
            date,
            start_time: minutesToTime(start),
            end_time: minutesToTime(end),
            status: taken ? "ocupado" : "livre",
            created_at: timestamp,
            updated_at: timestamp,
          });
        }
      }
    }

    setTableRows("availability", [...preserved, ...created]);
    return created.length;
  },

  /** Nenhuma política de falta ativa nos dados fictícios. */
  check_client_noshow_block: () => ({ blocked: false }),

  /**
   * Ainda cabe um profissional na barbearia? Espelha a RPC real
   * `check_barber_limit` (conta barbeiros/admins vinculados vs. barber_limit;
   * `null` = ilimitado). Sessão/papel/tenant são checados pelo guard de RPC.
   */
  check_barber_limit: (args) => barbershopUnderBarberLimit(String(args._barbershop_id)),

  /**
   * Ainda cabe um agendamento no mês? Espelha `check_appointment_limit`
   * (lê o contador `appointments_this_month` vs. appointment_limit).
   */
  check_appointment_limit: (args) =>
    barbershopUnderAppointmentLimit(String(args._barbershop_id)),

  /**
   * Assinatura ativa do usuário (active/trialing, no ambiente e período
   * vigentes). Espelha a RPC `has_active_subscription`. Valida a sessão e só
   * responde sobre o próprio usuário — ou qualquer um, se for super_admin.
   */
  has_active_subscription: (args) => {
    const sessionUserId = getMockSessionUserId();
    if (!sessionUserId) return false;

    const targetUserId = String(args.user_uuid ?? "");
    if (targetUserId !== sessionUserId && !currentUserIsSuperAdmin()) {
      // Isolamento: não confirma a assinatura de outro usuário.
      return false;
    }

    const checkEnv = typeof args.check_env === "string" ? args.check_env : "live";
    const nowISO = new Date().toISOString();

    return getTableRows("subscriptions").some((row) => {
      if (row.user_id !== targetUserId) return false;
      if (row.environment !== checkEnv) return false;
      if (row.status !== "active" && row.status !== "trialing") return false;
      const end = row.current_period_end;
      return end === null || end === undefined || String(end) > nowISO;
    });
  },
};

/** Passo da grade de horários gerada pelas RPCs, em minutos. */
const SLOT_STEP = 30;

function newMockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mock-${Date.now().toString(16)}-${Math.floor(Math.random() * 1e9).toString(16)}`;
}

/** Datas ISO de `start` a `end`, inclusive. */
function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00`);
  const last = new Date(`${end}T12:00:00`);

  while (cursor <= last && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

/**
 * RPCs que só podem ser executadas por quem tem vínculo com o tenant.
 * Espelha o `security definer` + checagem de papel das funções reais.
 */
const TENANT_GUARDED_RPCS = new Set([
  "get_barbershop_clients",
  "get_noshow_report",
  "create_walkin_client",
  "generate_availability_from_schedule",
  // Limites do plano: só quem trabalha na barbearia (ou o super_admin) pode
  // consultar o estado do limite daquele tenant.
  "check_barber_limit",
  "check_appointment_limit",
]);

/** Papéis que dão acesso a dados agregados da barbearia. */
const STAFF_ROLES = new Set(["barbeiro", "admin_barbearia"]);

/** `true` se o usuário da sessão é super_admin (global). */
function currentUserIsSuperAdmin(): boolean {
  const userId = getMockSessionUserId();
  if (!userId) return false;
  return getTableRows("user_roles").some(
    (row) => row.user_id === userId && row.role === "super_admin",
  );
}

/**
 * `true` quando o usuário da sessão é staff de alguma barbearia em que o
 * cliente informado também está — base para liberar dados pessoais.
 */
function currentUserSharesBarbershopWith(clientId: unknown): boolean {
  const userId = getMockSessionUserId();
  if (!userId) return false;

  const roles = getTableRows("user_roles");
  const staffShops = new Set(
    roles
      .filter((row) => row.user_id === userId && STAFF_ROLES.has(String(row.role)))
      .map((row) => String(row.barbershop_id)),
  );
  if (staffShops.size === 0) return false;

  const clientShops = new Set<string>(
    roles.filter((row) => row.user_id === clientId).map((row) => String(row.barbershop_id)),
  );
  for (const row of getTableRows("appointments")) {
    if (row.client_id === clientId) clientShops.add(String(row.barbershop_id));
  }

  for (const shop of clientShops) {
    if (staffShops.has(shop)) return true;
  }
  return false;
}

function currentUserIsStaffOf(barbershopId: unknown): boolean {
  const userId = getMockSessionUserId();
  if (!userId) return false;

  return getTableRows("user_roles").some(
    (row) =>
      row.user_id === userId &&
      row.barbershop_id === barbershopId &&
      STAFF_ROLES.has(String(row.role)),
  );
}

function runRpc(name: string, args: RpcArgs): MockResult<unknown> {
  const handler = RPC_HANDLERS[name];

  if (!handler) {
    console.warn(`[mock] RPC "${name}" não implementada no modo mock. Retornando null.`);
    return { data: null, error: null, count: null, status: 200, statusText: "OK" };
  }

  // Isolamento entre tenants: uma RPC agregada só responde para quem trabalha
  // naquela barbearia (ou o super_admin, global). Sem isso o mock vazaria
  // dados de outro tenant.
  if (
    TENANT_GUARDED_RPCS.has(name) &&
    !currentUserIsStaffOf(args._barbershop_id) &&
    !currentUserIsSuperAdmin()
  ) {
    return {
      data: null,
      error: {
        message: `Sem permissão para "${name}" nesta barbearia.`,
        details: "Regra do modo offline.",
        hint: "",
        code: "MOCK_FORBIDDEN",
      },
      count: null,
      status: 403,
      statusText: "Forbidden",
    };
  }

  return { data: handler(args), error: null, count: null, status: 200, statusText: "OK" };
}

/* ------------------------------------------------------------------ */
/* Realtime / storage / functions — no-ops                             */
/* ------------------------------------------------------------------ */

interface MockChannel {
  on: (...args: unknown[]) => MockChannel;
  subscribe: (callback?: (status: string) => void) => MockChannel;
  unsubscribe: () => Promise<"ok">;
  topic: string;
}

function createMockChannel(topic: string): MockChannel {
  const channel: MockChannel = {
    topic,
    on: () => channel,
    subscribe: (callback) => {
      callback?.("SUBSCRIBED");
      return channel;
    },
    unsubscribe: async () => "ok" as const,
  };
  return channel;
}

/**
 * Storage depende de serviço real: no modo offline ele falha de forma
 * explícita em vez de fingir sucesso. Antes o upload devolvia uma URL
 * `/mock-storage/...` inexistente, e a tela salvava esse caminho quebrado
 * como logo/avatar.
 */
const STORAGE_MESSAGE =
  "Modo offline: upload de arquivos indisponível (depende do Storage do Supabase).";

const mockStorageBucket = {
  async upload(_path: string, _file: unknown, _options?: unknown) {
    console.warn(`[mock] ${STORAGE_MESSAGE}`);
    return { data: null, error: { message: STORAGE_MESSAGE, name: "MockStorageError" } };
  },
  getPublicUrl(_path: string) {
    // Sem URL simulada: nada aponta para um arquivo que não existe.
    return { data: { publicUrl: "" } };
  },
  async remove(_paths: string[]) {
    return { data: null, error: { message: STORAGE_MESSAGE, name: "MockStorageError" } };
  },
  async list() {
    return { data: [], error: null };
  },
};

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export const mockSupabaseClient = {
  auth: mockAuth,

  from(table: string) {
    return new MockQueryBuilder(table);
  },

  rpc(name: string, args?: RpcArgs) {
    return Promise.resolve(runRpc(name, args ?? {}));
  },

  channel(topic: string) {
    return createMockChannel(topic);
  },

  removeChannel(_channel: unknown) {
    return Promise.resolve("ok" as const);
  },

  removeAllChannels() {
    return Promise.resolve([]);
  },

  storage: {
    from(_bucket: string) {
      return mockStorageBucket;
    },
  },

  functions: {
    async invoke(name: string, _options?: unknown) {
      console.warn(`[mock] Edge function "${name}" não é executada no modo mock.`);
      return {
        data: null,
        error: { message: `Edge function "${name}" indisponível no modo mock.`, name: "MockError" },
      };
    },
  },
};
