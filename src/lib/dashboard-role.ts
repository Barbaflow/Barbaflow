/**
 * Resolução pura do papel do usuário no /dashboard e do destino do redirect.
 *
 * Princípio: o onboarding NÃO é o fallback de /dashboard. Criar barbearia é uma
 * intenção declarada — chega-se lá pelos CTAs da landing, de /barbearias e de
 * /sobre. Ausência de papel, de agendamento ou de tenant não é sinal de que
 * alguém quer abrir uma barbearia; é só um usuário sem escopo operacional, e o
 * lugar dele é a própria área de cliente.
 *
 * O único sinal confiável de "proprietário com onboarding incompleto" é de
 * PRESENÇA: existe uma linha em `barbershops` com `owner_id` do usuário (fora a
 * sentinela `_system`) sem o vínculo correspondente em `user_roles`. A
 * barbearia foi mesmo criada por ele; o que faltou foi o papel de admin. Esse
 * caso não redireciona — mostra a tela de reparo do vínculo.
 */

export type DashboardRole =
  | "super_admin"
  | "admin_barbearia"
  | "barbeiro"
  | "cliente"
  | "orphan_owner";

export interface RoleSignals {
  /** has_role(user, 'super_admin') */
  isSuperAdmin: boolean;
  /** Papéis encontrados em user_roles, em qualquer barbearia. */
  roles: string[];
  /**
   * É dono de alguma barbearia real (fora a sentinela `_system`). Sinal de
   * presença: a barbearia existe no banco, criada por este usuário.
   */
  ownsBarbershop: boolean;
}

/**
 * Prioridade: super_admin > admin_barbearia > barbeiro > proprietário órfão >
 * cliente.
 *
 * Um admin/barbeiro sempre vê o painel, mesmo que também seja cliente em outra
 * barbearia. Quem não tem nenhum papel operacional é cliente — inclusive quem
 * acabou de criar a conta e ainda não agendou nada.
 */
export function pickDashboardRole(signals: RoleSignals): DashboardRole {
  if (signals.isSuperAdmin) return "super_admin";
  if (signals.roles.includes("admin_barbearia")) return "admin_barbearia";
  if (signals.roles.includes("barbeiro")) return "barbeiro";

  // Dono sem vínculo de admin. Tem precedência sobre "cliente" porque o reparo
  // do vínculo é o que destrava a conta — e nunca criamos uma segunda barbearia.
  if (signals.ownsBarbershop) return "orphan_owner";

  return "cliente";
}

/**
 * Para onde o /dashboard manda este papel, ou `null` quando ele permanece na
 * própria rota.
 *
 * Só existe um destino possível, e ele nunca aponta de volta para /dashboard —
 * é isso que torna o loop de redirect impossível por construção. /onboarding
 * deixou de ser um destino deste guard.
 */
export function dashboardRedirect(role: DashboardRole): "/meus-agendamentos" | null {
  return role === "cliente" ? "/meus-agendamentos" : null;
}

/* ══════════════ Resolução com tratamento de falha ══════════════ */

/**
 * O mínimo que precisamos de um erro do Supabase para decidir. Aceita tanto
 * `PostgrestError` (que traz `code`) quanto a resposta com `status` HTTP.
 */
export interface QueryFailure {
  code?: string | null;
  status?: number | null;
}

export interface QueryOutcome<T> {
  value: T;
  error: QueryFailure | null;
}

export type RoleResolution =
  | { status: "resolved"; role: DashboardRole }
  /** Consulta falhou. Não dá para decidir — nem redirecionar. */
  | { status: "error" }
  /** Sessão inválida/expirada: o caminho é reautenticar, não mostrar erro. */
  | { status: "expired" };

/** PostgREST devolve PGRST301 para JWT expirado; 401 cobre o resto. */
const EXPIRED_CODES = new Set(["PGRST301"]);

export function isSessionExpired(error: QueryFailure | null | undefined): boolean {
  if (!error) return false;
  if (error.status === 401) return true;
  return Boolean(error.code && EXPIRED_CODES.has(error.code));
}

/**
 * Decide o papel a partir do resultado das consultas, distinguindo
 * "consultou e não achou nada" de "não consegui consultar".
 *
 * Uma lista vazia SEM erro é resposta legítima: o usuário não tem papel. Uma
 * lista vazia COM erro não é resposta nenhuma — e virar "cliente" nesse caso
 * mandaria um admin para a área de cliente. Por isso o erro interrompe a
 * decisão em vez de alimentar `pickDashboardRole`.
 *
 * `owned` é opcional porque a consulta de propriedade só roda no desempate de
 * quem não tem papel algum; quando ela era necessária e não veio, tratamos como
 * indecidível em vez de assumir "não é proprietário".
 */
export function resolveDashboardRole(input: {
  superAdmin: QueryOutcome<boolean>;
  /** `null` quando a consulta falhou — nunca confundir com `[]`. */
  roles: QueryOutcome<string[] | null>;
  owned?: QueryOutcome<boolean>;
}): RoleResolution {
  const falhas = [input.superAdmin.error, input.roles.error, input.owned?.error];
  if (falhas.some(isSessionExpired)) return { status: "expired" };

  if (input.superAdmin.error) return { status: "error" };
  if (input.superAdmin.value) return { status: "resolved", role: "super_admin" };

  if (input.roles.error || input.roles.value === null) return { status: "error" };
  const roles = input.roles.value;

  // Com papel operacional não precisamos da consulta de propriedade.
  if (roles.includes("admin_barbearia") || roles.includes("barbeiro")) {
    return { status: "resolved", role: pickDashboardRole({ isSuperAdmin: false, roles, ownsBarbershop: false }) };
  }

  if (roles.length === 0) {
    // Desempate obrigatório: sem o resultado da propriedade não há decisão.
    if (!input.owned || input.owned.error) return { status: "error" };
    return { status: "resolved", role: pickDashboardRole({ isSuperAdmin: false, roles, ownsBarbershop: input.owned.value }) };
  }

  // Tem linha em user_roles, mas nenhum papel operacional (ex.: "cliente").
  return { status: "resolved", role: pickDashboardRole({ isSuperAdmin: false, roles, ownsBarbershop: false }) };
}

/**
 * Trocou o usuário logado? Serve para descartar papel, proprietário órfão e
 * estado de erro do usuário anterior antes de resolver o próximo. O primeiro
 * login (`previous === null`) não conta como troca.
 */
export function isDifferentUser(previous: string | null, next: string | null): boolean {
  return previous !== null && previous !== next;
}
