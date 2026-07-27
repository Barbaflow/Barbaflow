/**
 * Registro de erros técnicos.
 *
 * Este módulo NÃO produz mensagens para o usuário — de propósito. Cada tela
 * escreve a própria frase, com o contexto da operação que falhou ("Não foi
 * possível enviar o convite."), porque um texto único para tudo não ajuda
 * ninguém a entender o que deu errado.
 *
 * O que fica aqui é o outro lado: levar o erro cru para o console, com prefixo
 * de módulo e operação, sem carregar segredo junto.
 */

/**
 * Padrões de material sensível que podem aparecer numa mensagem de erro ou numa
 * URL ecoada pelo servidor. Redigimos antes de logar porque o console é copiado
 * para tickets e prints com frequência.
 */
const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  // JWT (header.payload.signature)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt omitido]"],
  // Chaves novas do Supabase
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[chave omitida]"],
  // Parâmetros sensíveis em querystring
  [/([?&](?:apikey|access_token|refresh_token|token|password|senha)=)[^&\s]+/gi, "$1[omitido]"],
  // Cabeçalho Authorization
  [/(authorization\s*:\s*bearer\s+)\S+/gi, "$1[omitido]"],
];

/** Remove segredos de um texto antes de ele chegar ao console. */
export function redactSensitive(text: string): string {
  return SENSITIVE_PATTERNS.reduce((acc, [re, repl]) => acc.replace(re, repl), text);
}

/**
 * Extrai o que é útil de um erro desconhecido, já redigido. Mantém `code`,
 * `details` e `hint` do PostgrestError porque são o que realmente ajuda a
 * diagnosticar — nenhum deles vai para a tela.
 */
export function describeError(error: unknown): Record<string, string> {
  if (error === null || error === undefined) return { message: "erro sem detalhes" };

  if (typeof error === "string") return { message: redactSensitive(error) };

  if (typeof error === "object") {
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown; status?: unknown };
    const out: Record<string, string> = {};
    if (e.message !== undefined) out.message = redactSensitive(String(e.message));
    if (e.code !== undefined) out.code = String(e.code);
    if (e.details !== undefined) out.details = redactSensitive(String(e.details));
    if (e.hint !== undefined) out.hint = redactSensitive(String(e.hint));
    if (e.status !== undefined) out.status = String(e.status);
    if (Object.keys(out).length > 0) return out;
  }

  return { message: redactSensitive(String(error)) };
}

/**
 * Loga um erro técnico no console, identificando módulo e operação.
 *
 *   logTechnicalError("TeamManager", "enviar convite", error);
 *   → [TeamManager] enviar convite falhou: { message: "...", code: "23505" }
 *
 * O usuário nunca vê nada disto: quem chama exibe a própria mensagem de tela.
 */
export function logTechnicalError(scope: string, operation: string, error: unknown): void {
  console.error(`[${scope}] ${operation} falhou:`, describeError(error));
}
