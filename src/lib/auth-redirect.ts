/**
 * URLs de retorno dos e-mails de autenticação.
 *
 * O Supabase manda o usuário de volta para a aplicação através do parâmetro
 * `redirectTo`. Se cada tela montar esse endereço à mão, três coisas quebram:
 * o domínio fica preso no código (o link do e-mail abre o ambiente errado),
 * o SSR estoura ao tocar `window`, e a lista de "Redirect URLs" do painel
 * passa a precisar de uma entrada nova a cada tela.
 *
 * Aqui a origem é resolvida uma vez: no navegador vale sempre a origem atual
 * — a mesma de onde o usuário abriu a tela, seja a máquina de desenvolvimento,
 * o Preview ou a produção, sem nenhum endereço fixo no meio. Fora do navegador
 * vale VITE_PUBLIC_SITE_URL e, na ausência dela, o domínio de produção, que já
 * é o canônico declarado no <head> das rotas.
 *
 * Cada origem usada precisa constar em Authentication → URL Configuration →
 * Redirect URLs no painel do Supabase; o que não estiver lá é trocado pelo
 * Site URL na hora de montar o e-mail, e o link abre o ambiente errado.
 */

/**
 * Domínio canônico da aplicação, usado apenas quando não há origem nem env.
 *
 * Precisa ser um endereço que exista e que esteja na lista de Redirect URLs do
 * Supabase Auth: o que não estiver lá é descartado na montagem do e-mail e
 * trocado pelo Site URL, em silêncio. Trocar este valor exige trocar a allow
 * list junto.
 *
 * Na prática este é o terceiro nível e quase nunca é alcançado — a origem do
 * navegador vence, e o SSR usa VITE_PUBLIC_SITE_URL / PUBLIC_SITE_URL.
 */
export const PRODUCTION_ORIGIN = "https://barbaflow-delta.vercel.app";

/** Caminho da tela que conclui a recuperação de senha. */
export const RESET_PASSWORD_PATH = "/reset-password";

/** Remove barras finais e espaços de uma origem. `null` se não for utilizável. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Monta a URL absoluta de retorno.
 *
 * Função pura de propósito: a decisão de qual origem vence é o que precisa
 * ser verificado, e ela não depende de navegador nenhum.
 *
 * @param origin     origem do navegador (`window.location.origin`), ou `null` no SSR
 * @param configured origem declarada em ambiente, ou `null`
 */
export function buildRedirectUrl(
  origin: string | null | undefined,
  configured: string | null | undefined,
  path: string,
): string {
  const base = normalizeOrigin(origin) ?? normalizeOrigin(configured) ?? PRODUCTION_ORIGIN;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Origem declarada em ambiente. Lida de forma tolerante: pode não existir. */
export function configuredOrigin(): string | null {
  const fromVite = normalizeOrigin(import.meta.env.VITE_PUBLIC_SITE_URL);
  if (fromVite) return fromVite;

  // SSR: o mesmo endereço, sem prefixo VITE_. `process` não existe no navegador.
  if (typeof process !== "undefined" && process.env) {
    return normalizeOrigin(process.env.PUBLIC_SITE_URL);
  }
  return null;
}

/** Origem atual do navegador, ou `null` durante o SSR. */
export function browserOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeOrigin(window.location?.origin);
}

/**
 * URL absoluta para onde o Supabase deve devolver o usuário: a origem de onde
 * a tela foi aberta, com o caminho pedido.
 */
export function authRedirectUrl(path: string): string {
  return buildRedirectUrl(browserOrigin(), configuredOrigin(), path);
}

/** Atalho da única URL que a recuperação de senha usa. */
export function passwordRecoveryRedirectUrl(): string {
  return authRedirectUrl(RESET_PASSWORD_PATH);
}
