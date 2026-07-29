/**
 * Autorização das rotas de cron (`/hooks/*`).
 *
 * Estas rotas rodam com a chave administrativa e agem sobre todos os tenants:
 * uma zera o contador mensal de todas as barbearias, a outra apaga contas de
 * usuário. Quem consegue acioná-las não precisa de sessão nem de RLS — o
 * header É a autorização inteira. Por isso o segredo tem de ser um segredo de
 * verdade, e a checagem tem de acontecer antes de qualquer consulta.
 *
 * O que este módulo recusa, e por quê:
 *
 *   - CRON_SECRET ausente, vazio ou curto demais → 500. Falhar fechado: sem
 *     segredo configurado a rota não roda, em vez de rodar para qualquer um.
 *   - CRON_SECRET igual a uma chave do Supabase → 500. A publishable/anon vai
 *     no bundle do navegador (`VITE_SUPABASE_PUBLISHABLE_KEY`), logo não é
 *     segredo; e a service_role não deve virar credencial de endpoint HTTP.
 *   - Qualquer outro header como prova de origem (`lovable-context` e afins)
 *     → não são consultados. Header arbitrário não autentica nada.
 *
 * Sem prefixo VITE_ no nome: com ele, o Vite embutiria o valor no bundle.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** Menor tamanho aceito para o segredo. Abaixo disso é força bruta viável. */
export const MIN_CRON_SECRET_LENGTH = 32;

/**
 * Variáveis cujo valor NÃO pode ser reaproveitado como CRON_SECRET.
 * As publicáveis porque são públicas; a administrativa porque comprometê-la
 * pelo endpoint daria acesso irrestrito ao banco.
 */
const CHAVES_PROIBIDAS = [
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

export type CronAuthResult = { ok: true } | { ok: false; response: Response };

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Compara dois segredos em tempo constante.
 *
 * `timingSafeEqual` exige buffers do mesmo tamanho e **lança** quando eles
 * diferem — e o tamanho do token é escolhido por quem chama, então tratar a
 * exceção seria transformar o comprimento do segredo em oráculo. Por isso os
 * dois lados passam antes por SHA-256: digest tem sempre 32 bytes, de modo que
 * a comparação nunca lança e o número de bytes comparados não depende nem do
 * tamanho do segredo nem do palpite de quem chama. É a forma usual de "igualar
 * o tamanho antes".
 *
 * O SHA-256 aqui não serve para proteger o segredo — ele já está em memória no
 * processo. Serve só para normalizar o comprimento.
 *
 * `node:crypto` é seguro nos três alvos deste projeto: Node, Vercel/Nitro e
 * Cloudflare Workers (`nodejs_compat` está ligado em `wrangler.jsonc`). E este
 * módulo é `.server.ts` — nunca entra no bundle do navegador.
 */
export function compararSegredos(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

/** Extrai o token de `Authorization: Bearer <token>`. Só esse formato vale. */
export function extrairBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer[ ]+(.+)$/.exec(authHeader.trim());
  if (!m) return null;
  const token = m[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Lê e valida o CRON_SECRET do ambiente. Separada de `authorizeCronRequest`
 * para que os testes possam distinguir "mal configurado" de "não autorizado".
 */
export function lerCronSecret(env: Record<string, string | undefined> = process.env): {
  secret: string | null;
  motivo?: string;
} {
  const secret = env.CRON_SECRET?.trim();

  if (!secret) return { secret: null, motivo: "CRON_SECRET ausente" };

  if (secret.length < MIN_CRON_SECRET_LENGTH) {
    return { secret: null, motivo: `CRON_SECRET com menos de ${MIN_CRON_SECRET_LENGTH} caracteres` };
  }

  for (const nome of CHAVES_PROIBIDAS) {
    const valor = env[nome]?.trim();
    if (valor && valor === secret) {
      return { secret: null, motivo: `CRON_SECRET não pode ser igual a ${nome}` };
    }
  }

  return { secret };
}

/**
 * Porta de entrada das rotas de cron. Devolve `{ ok: true }` só quando o
 * ambiente está configurado E o chamador apresentou o segredo correto.
 *
 * Deve ser a PRIMEIRA coisa do handler: nenhuma consulta, leitura de corpo ou
 * criação de cliente administrativo antes de `ok === true`.
 */
export function authorizeCronRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): CronAuthResult {
  const { secret, motivo } = lerCronSecret(env);

  if (!secret) {
    // O motivo vai para o log do servidor, não para a resposta: quem chama não
    // precisa saber como o segredo está (mal) configurado.
    console.error("[cron-auth] configuração inválida:", motivo);
    return { ok: false, response: json({ error: "server_misconfigured" }, 500) };
  }

  const token = extrairBearer(request.headers.get("authorization"));

  if (!token || !compararSegredos(token, secret)) {
    return { ok: false, response: json({ error: "unauthorized" }, 401) };
  }

  return { ok: true };
}
