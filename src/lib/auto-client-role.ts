/**
 * Decisão pura do papel automático de cliente.
 *
 * Fica fora do hook para poder ser exercitada pelo harness. O ponto crítico é o
 * mesmo do guard do dashboard: uma consulta que FALHOU não pode ser lida como
 * "não existe papel" — senão uma queda de rede vira uma tentativa de INSERT.
 *
 * Sobre manter ou não este comportamento: nenhuma política RLS depende do papel
 * `cliente`, a lista de clientes da barbearia é derivada de `appointments`, e o
 * guard de /dashboard já trata "sem papel" como cliente. O papel ainda é criado
 * no fluxo de agendamento (`/agendar/$slug`). Ou seja, o hook não é
 * indispensável — mas remover mudaria a mensagem de acesso em `clientes.tsx`
 * (que distingue "sem permissão" de "sem barbearia" pela existência de papel) e
 * deixaria `user_roles` menos consistente. Por isso o comportamento foi
 * mantido e endurecido, não removido.
 */
import { isSessionExpired, type QueryFailure } from "@/lib/dashboard-role";

export type SkipReason =
  | "sem-sessao"
  | "carregando"
  | "tenant-padrao"
  | "ja-processado"
  | "papel-existe"
  | "consulta-falhou"
  | "sessao-expirada";

export type AutoRoleDecision = { action: "create" } | { action: "skip"; reason: SkipReason };

export interface AutoRoleInput {
  hasSession: boolean;
  authLoading: boolean;
  /** Tenant não resolvido para uma barbearia real (domínio raiz). */
  isDefaultTenant: boolean;
  /** Este par usuário+barbearia já foi processado nesta montagem. */
  alreadyProcessed: boolean;
  /**
   * Resultado da consulta por papel existente. `null` quando ela ainda não foi
   * feita — os guardas acima decidem antes de gastar uma consulta.
   */
  existing?: { found: boolean; error: QueryFailure | null };
}

/**
 * Decide se o papel `cliente` deve ser criado.
 *
 * Nunca devolve `create` sem uma consulta concluída com sucesso mostrando que
 * o papel não existe.
 */
export function decideAutoClientRole(input: AutoRoleInput): AutoRoleDecision {
  if (input.authLoading) return { action: "skip", reason: "carregando" };
  if (!input.hasSession) return { action: "skip", reason: "sem-sessao" };
  if (input.isDefaultTenant) return { action: "skip", reason: "tenant-padrao" };
  if (input.alreadyProcessed) return { action: "skip", reason: "ja-processado" };

  // Sem o resultado da consulta não há decisão possível.
  if (!input.existing) return { action: "skip", reason: "consulta-falhou" };

  if (isSessionExpired(input.existing.error)) return { action: "skip", reason: "sessao-expirada" };
  if (input.existing.error) return { action: "skip", reason: "consulta-falhou" };
  if (input.existing.found) return { action: "skip", reason: "papel-existe" };

  return { action: "create" };
}

export type InsertOutcome = "criado" | "ja-existia" | "sessao-expirada" | "falhou";

/** Violação de UNIQUE(user_id, barbershop_id, role) no Postgres. */
const UNIQUE_VIOLATION = "23505";

/**
 * Classifica o resultado do INSERT.
 *
 * O conflito de unicidade é sucesso, não erro: significa que outra execução
 * (outra aba, ou o fluxo de agendamento) criou o papel primeiro. O efeito
 * desejado — o papel existe — foi alcançado.
 */
export function classifyRoleInsert(error: QueryFailure | null | undefined): InsertOutcome {
  if (!error) return "criado";
  if (isSessionExpired(error)) return "sessao-expirada";
  if (error.code === UNIQUE_VIOLATION) return "ja-existia";
  return "falhou";
}

/** O papel ficou garantido no banco? Serve para marcar o par como processado. */
export function roleIsEnsured(outcome: InsertOutcome): boolean {
  return outcome === "criado" || outcome === "ja-existia";
}
