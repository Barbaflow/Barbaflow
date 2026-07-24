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
  recalcTicketTotals,
  ticketDiscountValue,
} from "./rules";
import {
  byBarberReport,
  paymentMethodsReport,
  productsReport,
  salesSummary,
  salesTimeseries,
  servicesReport,
} from "./reports";

/**
 * Erro de RPC do modo mock. Espelha um `RAISE EXCEPTION` do Postgres: a
 * mensagem carrega o token que a interface reconhece (ex.: `estoque_insuficiente`,
 * `comanda_ja_fechada`). `runRpc` o converte no `{ data:null, error }` que o
 * supabase-js devolveria — o chamador nunca vê uma promise rejeitada.
 */
class MockRpcError extends Error {
  code: string;
  constructor(message: string, code = "MOCK_RULE") {
    super(message);
    this.name = "MockRpcError";
    this.code = code;
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Papéis de equipe (atendem/administram) de um usuário numa barbearia. */
function userIsStaffOf(userId: unknown, barbershopId: unknown): boolean {
  return getTableRows("user_roles").some(
    (row) =>
      row.user_id === userId &&
      row.barbershop_id === barbershopId &&
      (row.role === "barbeiro" || row.role === "admin_barbearia"),
  );
}

/** Papel global super_admin de um usuário qualquer. */
function userIsSuperAdmin(userId: unknown): boolean {
  return getTableRows("user_roles").some(
    (row) => row.user_id === userId && row.role === "super_admin",
  );
}

/**
 * Espelha `report_barber_scope` do banco: valida o chamador da sessão e devolve
 * o barber_id ao qual o relatório deve se restringir.
 *   • admin da loja ou super_admin → `requestedBarberId` (null = toda a loja);
 *   • barbeiro da loja → o próprio id (só vê os próprios resultados);
 *   • qualquer outro → erro (o guard de tenant já barra antes, mas mantemos a
 *     regra aqui para a autorização não depender só do guard).
 */
function reportBarberScope(barbershopId: string, requestedBarberId: unknown): string | null {
  const caller = getMockSessionUserId();
  if (!caller) throw new MockRpcError("nao_autenticado", "insufficient_privilege");

  const roles = getTableRows("user_roles");
  const isAdmin =
    roles.some(
      (r) =>
        r.user_id === caller &&
        r.barbershop_id === barbershopId &&
        r.role === "admin_barbearia",
    ) || userIsSuperAdmin(caller);
  if (isAdmin) return requestedBarberId ? String(requestedBarberId) : null;

  const isBarber = roles.some(
    (r) => r.user_id === caller && r.barbershop_id === barbershopId && r.role === "barbeiro",
  );
  if (isBarber) return caller;

  throw new MockRpcError(
    "forbidden: sem acesso aos relatórios desta barbearia",
    "insufficient_privilege",
  );
}

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
   * Resumo público de perfil — espelha a RPC real (migration 20260722240000),
   * criada porque `profiles` deixou de ser legível por qualquer autenticado.
   * Retorno mínimo: nome e avatar, nunca telefone nem e-mail.
   */
  get_public_profile_summaries: (args) => {
    const ids = Array.isArray(args._user_ids) ? args._user_ids : [];
    return getTableRows("profiles")
      .filter((row) => ids.includes(row.user_id) && !row.anonymized_at)
      .map((row) => ({
        user_id: row.user_id,
        full_name: String(row.full_name ?? "").trim() || null,
        avatar_url: row.avatar_url ?? null,
      }));
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

  /* ── Assinatura SaaS da barbearia (espelham as RPCs de cobrança) ────────── */

  /**
   * Lê a assinatura corrente da barbearia para a página de cobrança. Só
   * admin_barbearia/super_admin daquele tenant — barbeiro/cliente/anon recusados.
   */
  get_barbershop_subscription: (args) => {
    const caller = getMockSessionUserId();
    if (!caller) throw new MockRpcError("nao_autenticado", "insufficient_privilege");
    const bs = String(args._barbershop_id ?? "");
    const isAdmin =
      getTableRows("user_roles").some(
        (r) => r.user_id === caller && r.barbershop_id === bs && r.role === "admin_barbearia",
      ) || userIsSuperAdmin(caller);
    if (!isAdmin) {
      throw new MockRpcError(
        "forbidden: só o administrador gerencia a assinatura desta barbearia",
        "insufficient_privilege",
      );
    }
    const subs = getTableRows("subscriptions")
      .filter((s) => s.barbershop_id === bs)
      .sort((a, b) => {
        const ac = a.status !== "canceled" ? 1 : 0;
        const bc = b.status !== "canceled" ? 1 : 0;
        if (ac !== bc) return bc - ac; // não-cancelada primeiro
        return String(b.updated_at ?? "") > String(a.updated_at ?? "") ? 1 : -1;
      });
    const s = subs[0];
    if (!s) return [];
    return [
      {
        status: s.status,
        price_id: s.price_id,
        environment: s.environment,
        current_period_start: s.current_period_start ?? null,
        current_period_end: s.current_period_end ?? null,
        cancel_at_period_end: s.cancel_at_period_end ?? false,
        canceled_at: s.canceled_at ?? null,
        trial_end: s.trial_end ?? null,
        updated_at: s.updated_at ?? null,
      },
    ];
  },

  /**
   * Idempotência de webhook (espelha record_billing_event). Devolve true se o
   * evento é novo, false se já foi registrado. Simula o backend confiável.
   */
  record_billing_event: (args) => {
    const provider = String(args._provider ?? "paddle");
    const eventId = String(args._event_id ?? "");
    const rows = getTableRows("billing_webhook_events");
    if (rows.some((r) => r.provider === provider && r.event_id === eventId)) return false;
    setTableRows("billing_webhook_events", [
      ...rows,
      {
        id: newMockId(),
        provider,
        event_id: eventId,
        event_type: args._event_type ?? null,
        environment: String(args._environment ?? ""),
        barbershop_id: null,
        received_at: new Date().toISOString(),
      },
    ]);
    return true;
  },

  /**
   * Aplica a assinatura vinda do webhook (espelha apply_subscription_from_webhook):
   * valida POSSE (a barbearia é do usuário ou ele a administra), faz upsert
   * idempotente por paddle_subscription_id e ajusta o plano da barbearia.
   */
  apply_subscription_from_webhook: (args) => {
    const userId = String(args._user_id ?? "");
    const bs = args._barbershop_id ? String(args._barbershop_id) : null;

    if (bs) {
      const owns = getTableRows("barbershops").some((b) => b.id === bs && b.owner_id === userId);
      const admins = getTableRows("user_roles").some(
        (r) => r.user_id === userId && r.barbershop_id === bs && r.role === "admin_barbearia",
      );
      if (!owns && !admins) {
        throw new MockRpcError(
          `tenant_ownership_invalid: usuário ${userId} não administra a barbearia ${bs}`,
        );
      }
    }

    const subId = String(args._paddle_subscription_id ?? "");
    const status = String(args._status ?? "");
    const now = new Date().toISOString();
    const rows = getTableRows("subscriptions");
    const rec = {
      user_id: userId,
      barbershop_id: bs,
      paddle_subscription_id: subId,
      paddle_customer_id: String(args._paddle_customer_id ?? ""),
      product_id: String(args._product_id ?? ""),
      price_id: String(args._price_id ?? ""),
      status,
      current_period_start: args._current_period_start ?? null,
      current_period_end: args._current_period_end ?? null,
      cancel_at_period_end: Boolean(args._cancel_at_period_end),
      canceled_at: args._canceled_at ?? null,
      trial_end: args._trial_end ?? null,
      environment: String(args._environment ?? "sandbox"),
      updated_at: now,
    };
    const idx = rows.findIndex((s) => s.paddle_subscription_id === subId);
    if (idx >= 0) rows[idx] = { ...rows[idx], ...rec };
    else rows.push({ id: newMockId(), created_at: now, ...rec });
    setTableRows("subscriptions", rows);

    if (bs) {
      const planName = ["active", "trialing", "past_due"].includes(status)
        ? String(args._plan_name ?? "pro")
        : "free";
      const plan = getTableRows("plans").find((p) => p.name === planName);
      if (plan) {
        setTableRows(
          "barbershops",
          getTableRows("barbershops").map((b) => (b.id === bs ? { ...b, plan_id: plan.id } : b)),
        );
      }
    }
    return null;
  },

  /**
   * Abre uma comanda (manual ou por agendamento) — espelha a RPC `open_ticket`.
   * Valida papel+tenant, é idempotente por agendamento e adiciona o serviço
   * inicial. NÃO movimenta estoque. Devolve o id da comanda.
   */
  open_ticket: (args) => {
    const caller = getMockSessionUserId();
    if (!caller) throw new MockRpcError("nao_autenticado", "insufficient_privilege");

    const barbershopId = String(args._barbershop_id ?? "");
    if (!(userIsStaffOf(caller, barbershopId) || userIsSuperAdmin(caller))) {
      throw new MockRpcError("forbidden: só a equipe da barbearia abre comanda", "insufficient_privilege");
    }

    let clientId = args._client_id ? String(args._client_id) : null;
    let barberId = args._barber_id ? String(args._barber_id) : null;
    const appointmentId = args._appointment_id ? String(args._appointment_id) : null;

    let initialServiceId: string | null = null;
    if (appointmentId) {
      const appt = getTableRows("appointments").find((a) => a.id === appointmentId);
      if (!appt || appt.barbershop_id !== barbershopId) {
        throw new MockRpcError("tenant_invalido: agendamento de outra barbearia");
      }
      // Idempotência: reaproveita a comanda aberta; recusa se já foi fechada.
      const existing = getTableRows("tickets").find(
        (t) => t.appointment_id === appointmentId && t.status !== "cancelada",
      );
      if (existing) {
        if (existing.status === "aberta") return existing.id;
        throw new MockRpcError("comanda_ja_fechada: este agendamento já possui comanda fechada");
      }
      clientId = clientId ?? (appt.client_id ? String(appt.client_id) : null);
      barberId = barberId ?? (appt.barber_id ? String(appt.barber_id) : null);
      initialServiceId = appt.service_id ? String(appt.service_id) : null;
    }

    if (!barberId) throw new MockRpcError("barber_id obrigatório para abrir comanda");
    if (!userIsStaffOf(barberId, barbershopId)) {
      throw new MockRpcError("tenant_invalido: barbeiro não é desta barbearia");
    }

    const now = new Date().toISOString();
    const ticketId = newMockId();
    setTableRows("tickets", [
      ...getTableRows("tickets"),
      {
        id: ticketId,
        barbershop_id: barbershopId,
        appointment_id: appointmentId,
        client_id: clientId,
        barber_id: barberId,
        opened_by: caller,
        closed_by: null,
        closed_at: null,
        status: "aberta",
        subtotal: 0,
        discount_type: "fixed",
        discount_amount: 0,
        total: 0,
        notes: null,
        created_at: now,
        updated_at: now,
      },
    ]);

    // Serviço inicial do agendamento entra com o preço do catálogo (snapshot).
    if (initialServiceId) {
      const service = getTableRows("services").find((s) => s.id === initialServiceId);
      const unit = Number(service?.price ?? 0);
      setTableRows("ticket_items", [
        ...getTableRows("ticket_items"),
        {
          id: newMockId(),
          ticket_id: ticketId,
          barbershop_id: barbershopId,
          item_type: "service",
          service_id: initialServiceId,
          product_id: null,
          description: String(service?.name ?? "Serviço"),
          unit_price: unit,
          quantity: 1,
          total: round2(unit),
          created_at: now,
          updated_at: now,
        },
      ]);
      recalcTicketTotals(ticketId);
    }

    return ticketId;
  },

  /**
   * Fecha uma comanda — espelha a RPC `close_ticket`: revalida estoque, baixa
   * TUDO ou NADA (sem baixa parcial), recalcula o total, grava pagamentos
   * informativos, fecha e conclui o agendamento. Sem gateway de pagamento.
   */
  close_ticket: (args) => {
    const caller = getMockSessionUserId();
    if (!caller) throw new MockRpcError("nao_autenticado", "insufficient_privilege");

    const ticketId = String(args._ticket_id ?? "");
    const ticket = getTableRows("tickets").find((t) => t.id === ticketId);
    if (!ticket) throw new MockRpcError("comanda inexistente", "no_data_found");

    const barbershopId = String(ticket.barbershop_id);
    if (!(userIsStaffOf(caller, barbershopId) || userIsSuperAdmin(caller))) {
      throw new MockRpcError("forbidden: só a equipe da barbearia fecha comanda", "insufficient_privilege");
    }
    if (ticket.status !== "aberta") throw new MockRpcError("comanda_nao_aberta");

    const items = getTableRows("ticket_items").filter((i) => i.ticket_id === ticketId);
    if (items.length === 0) throw new MockRpcError("comanda_sem_itens");

    // Necessidade por produto e revalidação de estoque ANTES de qualquer baixa.
    const need = new Map<string, number>();
    for (const it of items) {
      if (it.item_type === "product" && it.product_id) {
        const pid = String(it.product_id);
        need.set(pid, (need.get(pid) ?? 0) + Number(it.quantity ?? 0));
      }
    }
    const products = getTableRows("products");
    for (const [productId, qty] of need) {
      const product = products.find((p) => p.id === productId && p.barbershop_id === barbershopId);
      if (!product) throw new MockRpcError("tenant_invalido: produto fora da barbearia");
      if (Number(product.stock_quantity ?? 0) < qty) {
        throw new MockRpcError(
          `estoque_insuficiente: produto ${productId} (tem ${Number(product.stock_quantity ?? 0)}, precisa ${qty})`,
        );
      }
    }

    const now = new Date().toISOString();

    // Baixa atômica (só depois de todos validados — nunca baixa parcial).
    if (need.size > 0) {
      setTableRows(
        "products",
        products.map((p) => {
          const qty = need.get(String(p.id));
          if (!qty) return p;
          return { ...p, stock_quantity: Number(p.stock_quantity ?? 0) - qty, updated_at: now };
        }),
      );
    }

    // Subtotal recalculado dos itens; total derivado do desconto (fonte no banco).
    const subtotal = round2(items.reduce((s, i) => s + Number(i.total ?? 0), 0));
    const discountVal = ticketDiscountValue(
      subtotal,
      String(ticket.discount_type ?? "fixed"),
      Number(ticket.discount_amount ?? 0),
    );
    const total = Math.max(0, round2(subtotal - discountVal));

    // Pagamentos informativos (valida valor e tenant da forma).
    const rawPayments = args._payments;
    const payments = Array.isArray(rawPayments)
      ? rawPayments
      : typeof rawPayments === "string"
        ? (JSON.parse(rawPayments) as unknown[])
        : [];
    const paymentRows: MockRow[] = [];
    for (const pay of payments as Array<Record<string, unknown>>) {
      const amount = Number(pay?.amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new MockRpcError("pagamento com valor inválido");
      }
      const methodId = pay?.payment_method_id ? String(pay.payment_method_id) : null;
      if (
        methodId &&
        !getTableRows("payment_methods").some(
          (pm) => pm.id === methodId && pm.barbershop_id === barbershopId,
        )
      ) {
        throw new MockRpcError("tenant_invalido: forma de pagamento de outra barbearia");
      }
      paymentRows.push({
        id: newMockId(),
        ticket_id: ticketId,
        barbershop_id: barbershopId,
        payment_method_id: methodId,
        method_name: String(pay?.method_name ?? "Não informado"),
        amount,
        created_at: now,
      });
    }
    if (paymentRows.length > 0) {
      setTableRows("ticket_payments", [...getTableRows("ticket_payments"), ...paymentRows]);
    }

    setTableRows(
      "tickets",
      getTableRows("tickets").map((t) =>
        t.id === ticketId
          ? { ...t, status: "fechada", subtotal, total, closed_at: now, closed_by: caller, updated_at: now }
          : t,
      ),
    );

    // Conclui o agendamento vinculado (regra atual).
    if (ticket.appointment_id) {
      setTableRows(
        "appointments",
        getTableRows("appointments").map((a) =>
          a.id === ticket.appointment_id && a.barbershop_id === barbershopId && a.status !== "cancelled"
            ? { ...a, status: "completed", updated_at: now }
            : a,
        ),
      );
    }

    return ticketId;
  },

  /* ── Dashboard operacional (espelha get_dashboard_summary) ──────────────── */

  get_dashboard_summary: (args) => {
    const bs = String(args._barbershop_id ?? "");
    // Reusa a autorização dos relatórios: barbeiro → próprio escopo; admin/super
    // → toda a barbearia; cliente/anon → erro (o guard de tenant também barra).
    const scope = reportBarberScope(bs, args._barber_id);
    const tz = String(
      getTableRows("barbershops").find((b) => b.id === bs)?.timezone ?? "America/Sao_Paulo",
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    const appts = getTableRows("appointments").filter(
      (a) =>
        a.barbershop_id === bs && a.date === today && (scope === null || a.barber_id === scope),
    );
    const openTickets = getTableRows("tickets").filter(
      (t) => t.barbershop_id === bs && t.status === "aberta" && (scope === null || t.barber_id === scope),
    );
    const countStatus = (s: string) => appts.filter((a) => a.status === s).length;

    return [
      {
        appointments_today: appts.length,
        scheduled_today: countStatus("scheduled"),
        completed_today: countStatus("completed"),
        cancelled_today: countStatus("cancelled"),
        no_show_today: countStatus("no_show"),
        open_tickets: openTickets.length,
      },
    ];
  },

  /* ── Relatórios de vendas (espelham as RPCs report_* do banco) ──────────── */

  report_sales_summary: (args) => {
    const bs = String(args._barbershop_id ?? "");
    const scope = reportBarberScope(bs, args._barber_id);
    const { startMs, endMs } = reportRange(args);
    // TABLE-returning: o supabase-js devolve um array; aqui, uma linha só.
    return [
      salesSummary(
        getTableRows("tickets"),
        getTableRows("ticket_items"),
        bs,
        startMs,
        endMs,
        scope,
      ),
    ];
  },

  report_sales_timeseries: (args) => {
    const bs = String(args._barbershop_id ?? "");
    const scope = reportBarberScope(bs, args._barber_id);
    const { startMs, endMs } = reportRange(args);
    const tz = String(
      getTableRows("barbershops").find((b) => b.id === bs)?.timezone ?? "America/Sao_Paulo",
    );
    return salesTimeseries(getTableRows("tickets"), bs, startMs, endMs, scope, tz);
  },

  report_services: (args) => {
    const bs = String(args._barbershop_id ?? "");
    const scope = reportBarberScope(bs, args._barber_id);
    const { startMs, endMs } = reportRange(args);
    return servicesReport(
      getTableRows("tickets"),
      getTableRows("ticket_items"),
      bs,
      startMs,
      endMs,
      scope,
    );
  },

  report_products: (args) => {
    const bs = String(args._barbershop_id ?? "");
    const scope = reportBarberScope(bs, args._barber_id);
    const { startMs, endMs } = reportRange(args);
    return productsReport(
      getTableRows("tickets"),
      getTableRows("ticket_items"),
      getTableRows("products"),
      bs,
      startMs,
      endMs,
      scope,
    );
  },

  report_by_barber: (args) => {
    const bs = String(args._barbershop_id ?? "");
    const scope = reportBarberScope(bs, args._barber_id);
    const { startMs, endMs } = reportRange(args);
    return byBarberReport(
      getTableRows("tickets"),
      getTableRows("ticket_items"),
      bs,
      startMs,
      endMs,
      scope,
    );
  },

  report_payment_methods: (args) => {
    const bs = String(args._barbershop_id ?? "");
    const scope = reportBarberScope(bs, args._barber_id);
    const { startMs, endMs } = reportRange(args);
    return paymentMethodsReport(
      getTableRows("tickets"),
      getTableRows("ticket_payments"),
      bs,
      startMs,
      endMs,
      scope,
    );
  },
};

/** Converte _start/_end (ISO timestamptz) em epoch ms para o recorte [start,end). */
function reportRange(args: RpcArgs): { startMs: number; endMs: number } {
  const startMs = Date.parse(String(args._start ?? ""));
  const endMs = Date.parse(String(args._end ?? ""));
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new MockRpcError("periodo_invalido: _start/_end ausentes ou inválidos");
  }
  return { startMs, endMs };
}

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
  // Dashboard operacional: contagens do dia só para a equipe (ou super_admin).
  "get_dashboard_summary",
  // Relatórios: agregados só para a equipe daquela barbearia (ou super_admin).
  // O recorte por profissional (barbeiro vê só o próprio) é feito no handler.
  "report_sales_summary",
  "report_sales_timeseries",
  "report_services",
  "report_products",
  "report_by_barber",
  "report_payment_methods",
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

  try {
    return { data: handler(args), error: null, count: null, status: 200, statusText: "OK" };
  } catch (e) {
    // Um RAISE EXCEPTION do mock vira `{ data:null, error }`, como o supabase-js.
    if (e instanceof MockRpcError) {
      return {
        data: null,
        error: { message: e.message, details: "", hint: "", code: e.code },
        count: null,
        status: 400,
        statusText: "Error",
      };
    }
    throw e;
  }
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
