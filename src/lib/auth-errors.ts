/**
 * Tradução dos erros de autenticação do Supabase.
 *
 * Os fluxos de login, cadastro e senha rethrow o `AuthError` cru, cuja mensagem
 * vem em inglês e descreve o provedor ("Invalid login credentials", "Email not
 * confirmed"). Isso vazava direto para a tela.
 *
 * Aqui traduzimos os casos que o usuário consegue resolver sozinho e caímos num
 * texto contextual para o resto. As mensagens que a PRÓPRIA aplicação lança —
 * validações locais como "Informe um telefone válido com DDD" — passam intactas,
 * porque foram escritas para serem lidas.
 */

/** `AuthError` do supabase-js marca as instâncias com `__isAuthError`. */
export function isSupabaseAuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("__isAuthError" in error) return true;
  // Rede/gateway podem devolver um objeto sem a marca, mas com o par status+code.
  return "status" in error && "code" in error;
}

const MENSAGENS: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  invalid_grant: "E-mail ou senha incorretos.",
  email_not_confirmed: "Confirme seu e-mail antes de entrar. Veja sua caixa de entrada.",
  user_already_exists: "Já existe uma conta com este e-mail.",
  email_exists: "Já existe uma conta com este e-mail.",
  weak_password: "A senha é muito fraca. Use ao menos 6 caracteres.",
  same_password: "A nova senha precisa ser diferente da atual.",
  over_request_rate_limit: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  over_email_send_rate_limit: "Muitos e-mails enviados. Aguarde alguns minutos e tente novamente.",
  otp_expired: "Este link expirou. Solicite um novo.",
  session_expired: "Sua sessão expirou. Entre novamente.",
};

/**
 * Mensagem segura para exibir.
 *
 * @param fallback texto da operação em curso, usado quando o erro vem do
 *   provedor e não está mapeado — ex.: "Não foi possível entrar. Tente novamente."
 */
export function authErrorMessage(error: unknown, fallback: string): string {
  if (!isSupabaseAuthError(error)) {
    // Erro construído pela aplicação: a mensagem já é para o usuário.
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  const code = String((error as { code?: unknown }).code ?? "");
  return MENSAGENS[code] ?? fallback;
}
