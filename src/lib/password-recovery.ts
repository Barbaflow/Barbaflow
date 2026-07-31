/**
 * Recuperação e redefinição de senha — regras puras.
 *
 * A tela `/reset-password` recebe o usuário de volta do e-mail, e o que chega
 * na URL varia conforme o fluxo do projeto e o template do e-mail:
 *
 *   implícito   #access_token=...&refresh_token=...&type=recovery
 *   PKCE        ?code=...
 *   token hash  ?token_hash=...&type=recovery
 *   falha       #error=access_denied&error_code=otp_expired&error_description=...
 *
 * O ponto delicado é o tempo: o supabase-js consome o fragmento durante a
 * inicialização e limpa a URL (`window.location.hash = ''`), e emite
 * `PASSWORD_RECOVERY` num `setTimeout` — quem só olha o hash dentro de um
 * `useEffect`, ou só assina o evento, perde os dois numa recarga. Por isso a
 * leitura da URL é feita na primeira renderização e a decisão final considera
 * também a sessão já existente, que é o sinal determinístico
 * (`getSession()` aguarda a inicialização do cliente).
 *
 * Nada aqui toca `window` nem o Supabase: a tela injeta o que leu.
 */
import { authErrorMessage, isSupabaseAuthError } from "@/lib/auth-errors";

/** Mesmo mínimo já cobrado no cadastro e no login. */
export const PASSWORD_MIN_LENGTH = 6;

/* ------------------------------------------------------------------ */
/* Solicitação                                                         */
/* ------------------------------------------------------------------ */

/** Normaliza o e-mail digitado: sem espaços nas pontas, tudo minúsculo. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Validação de forma — deliberadamente permissiva, quem decide é o servidor. */
export function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  if (/\s/.test(value)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(value);
}

export type EmailValidation =
  | { ok: true; email: string }
  | { ok: false; message: string };

/** Valida e normaliza o e-mail da solicitação numa única passada. */
export function validateResetEmail(raw: string): EmailValidation {
  const email = normalizeEmail(raw);
  if (!isValidEmail(email)) {
    return { ok: false, message: "Informe um e-mail válido." };
  }
  return { ok: true, email };
}

/**
 * Resposta única da solicitação — a mesma para e-mail cadastrado ou não.
 *
 * Dizer "não encontramos esta conta" transformaria a tela num verificador de
 * cadastro para qualquer pessoa com uma lista de e-mails.
 */
export const RESET_REQUEST_SUCCESS =
  "Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Verifique também a caixa de spam.";

/** Texto exibido quando nem a solicitação foi possível (rede, limite de envio). */
export const RESET_REQUEST_FALLBACK =
  "Não foi possível enviar o link agora. Tente novamente em alguns minutos.";

/* ------------------------------------------------------------------ */
/* Nova senha                                                          */
/* ------------------------------------------------------------------ */

export type PasswordValidation = { ok: true } | { ok: false; message: string };

/** Confere igualdade e tamanho mínimo, nesta ordem. */
export function validateNewPassword(password: string, confirmation: string): PasswordValidation {
  if (password !== confirmation) {
    return { ok: false, message: "As senhas não coincidem." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.` };
  }
  return { ok: true };
}

/** Texto exibido quando a troca falha por motivo não mapeado. */
export const RESET_UPDATE_FALLBACK = "Não foi possível redefinir a senha. Tente novamente.";

/**
 * Mensagem de tela para uma falha do fluxo de senha.
 *
 * Difere de `authErrorMessage` num ponto deliberado: ali um `Error` comum tem a
 * mensagem repassada, porque as telas de login e cadastro lançam validações
 * próprias já escritas para o usuário. Aqui não existe esse caso — a validação
 * é resolvida antes da chamada —, então qualquer coisa que não seja um erro
 * traduzido do provedor vira o texto da operação. É o que impede um
 * "Failed to fetch" de aparecer na tela quando a rede cai.
 */
export function resetFlowMessage(error: unknown, fallback: string): string {
  if (!isSupabaseAuthError(error)) return fallback;
  return authErrorMessage(error, fallback);
}

/* ------------------------------------------------------------------ */
/* Leitura do link                                                     */
/* ------------------------------------------------------------------ */

export type RecoveryErrorReason = "expirado" | "invalido";

export type RecoveryLink =
  | { kind: "implicito" }
  | { kind: "pkce"; code: string }
  | { kind: "token-hash"; tokenHash: string }
  | { kind: "erro"; reason: RecoveryErrorReason }
  | { kind: "ausente" };

function params(fragment: string | null | undefined): URLSearchParams {
  if (!fragment) return new URLSearchParams();
  return new URLSearchParams(fragment.replace(/^[#?]+/, ""));
}

/** "Expirou" e "já foi usado" chegam com o mesmo código: `otp_expired`. */
function reasonFrom(code: string, description: string): RecoveryErrorReason {
  const texto = `${code} ${description}`.toLowerCase();
  if (texto.includes("expired") || texto.includes("otp_expired")) return "expirado";
  return "invalido";
}

/**
 * Classifica o que veio na URL. Aceita fragmento e query porque o Supabase usa
 * um ou outro conforme o fluxo — e, no erro, às vezes os dois.
 */
export function parseRecoveryLink(input: { hash?: string | null; search?: string | null }): RecoveryLink {
  const hash = params(input.hash);
  const search = params(input.search);
  const ler = (chave: string): string => hash.get(chave) ?? search.get(chave) ?? "";

  const erro = ler("error") || ler("error_code");
  if (erro) {
    return { kind: "erro", reason: reasonFrom(ler("error_code") || erro, ler("error_description")) };
  }

  if (ler("access_token")) return { kind: "implicito" };

  const code = ler("code");
  if (code) return { kind: "pkce", code };

  const tokenHash = ler("token_hash");
  if (tokenHash && ler("type") === "recovery") return { kind: "token-hash", tokenHash };

  return { kind: "ausente" };
}

/* ------------------------------------------------------------------ */
/* Decisão da tela                                                     */
/* ------------------------------------------------------------------ */

export type RecoveryDecision =
  /** Há sessão de recuperação: pode pedir a nova senha. */
  | { status: "pronto" }
  /** O link traz um código a trocar por sessão antes de seguir. */
  | { status: "trocar"; link: Extract<RecoveryLink, { kind: "pkce" } | { kind: "token-hash" }> }
  /** O link chegou, mas não vale mais. */
  | { status: "invalido"; reason: RecoveryErrorReason }
  /** Ninguém chegou por link nenhum. */
  | { status: "sem-sessao" };

/**
 * Decide o estado da tela a partir do que a URL trouxe e da sessão existente.
 *
 * A ordem importa: um link com erro explícito vence a sessão que porventura
 * exista (o usuário precisa saber que aquele link morreu), e a sessão vence o
 * código, para não tentar trocar duas vezes o mesmo código — o supabase-js já
 * pode tê-lo consumido sozinho durante a inicialização.
 */
export function decideRecoveryState(input: { link: RecoveryLink; hasSession: boolean }): RecoveryDecision {
  const { link, hasSession } = input;

  if (link.kind === "erro") return { status: "invalido", reason: link.reason };
  if (hasSession) return { status: "pronto" };
  if (link.kind === "pkce" || link.kind === "token-hash") return { status: "trocar", link };
  // Tokens vieram na URL e mesmo assim não há sessão: o link já foi usado ou venceu.
  if (link.kind === "implicito") return { status: "invalido", reason: "expirado" };
  return { status: "sem-sessao" };
}

/* ------------------------------------------------------------------ */
/* Mensagens                                                           */
/* ------------------------------------------------------------------ */

const MENSAGENS_LINK: Record<RecoveryErrorReason, string> = {
  expirado: "Este link expirou ou já foi utilizado. Solicite um novo link de recuperação.",
  invalido: "Este link de recuperação não é válido. Solicite um novo link de recuperação.",
};

/** Texto do link que não vale mais. Nunca ecoa o que o provedor respondeu. */
export function recoveryLinkMessage(reason: RecoveryErrorReason): string {
  return MENSAGENS_LINK[reason];
}

/** Texto de quem abriu a tela sem link algum. */
export const RECOVERY_MISSING_SESSION_MESSAGE =
  "Abra o link mais recente enviado para o seu e-mail. Se ele já expirou, solicite um novo pela tela de login.";
