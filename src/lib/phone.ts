/**
 * Brazilian phone helpers.
 * Stored format in DB: digits only with country code prefix (e.g. "5511987654321").
 * UI format: "(11) 98765-4321".
 */

/** Strips everything except digits. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Applies the Brazilian phone mask to whatever the user typed.
 * Accepts up to 11 digits (DDD + 9 digits).
 */
export function maskBRPhone(value: string): string {
  const d = digitsOnly(value).slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Returns true when the digits form a valid BR phone (10 or 11 digits). */
export function isValidBRPhone(value: string): boolean {
  const d = digitsOnly(value);
  return d.length === 10 || d.length === 11;
}

/** Normalizes to E.164-ish for storage: "55" + DDD + number, no symbols. */
export function toStorageBRPhone(value: string): string {
  const d = digitsOnly(value);
  if (!d) return "";
  // 10 or 11 digits = local BR number, prefix with country code
  if (d.length === 10 || d.length === 11) return `55${d}`;
  // 12 or 13 digits already include country code
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  // Fallback: ensure 55 prefix exists
  return d.startsWith("55") ? d : `55${d}`;
}

/**
 * Diz se o número pode ser brasileiro: DDD de dois dígitos e, quando tem 11
 * dígitos, o nono dígito obrigatório do celular.
 *
 * Existe porque `contact_submissions` guarda o telefone exatamente como o
 * visitante digitou, sem validação no banco — e as funções abaixo assumiam
 * Brasil sempre. Um "+1 415 555 1234" virava a máscara "(14) 15555-1234" e um
 * link `wa.me/5514155551234` para um número que não existe. Não é validação de
 * operadora nem suporte internacional: só descarta o que não pode ser do
 * Brasil, para não exibir formato nem link inventado.
 */
export function isPlausibleBRPhone(value: string | null | undefined): boolean {
  if (!value) return false;
  let d = digitsOnly(value);
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return false;
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  // Celular brasileiro tem 11 dígitos e começa em 9 logo após o DDD. É o que
  // separa um celular daqui de um número estrangeiro de mesmo comprimento.
  if (d.length === 11 && d[2] !== "9") return false;
  return true;
}

/**
 * Formats a stored phone for display. Accepts stored or UI value.
 * Número que não pode ser brasileiro sai como veio: máscara BR sobre número
 * estrangeiro inventa um formato que não existe.
 */
export function displayBRPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!isPlausibleBRPhone(stored)) return stored.trim();
  let d = digitsOnly(stored);
  // Strip 55 country code only if remaining digits form a valid BR number (10 or 11)
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return maskBRPhone(d);
}

/**
 * Builds a wa.me URL from any stored or formatted phone. Always ensures 55 prefix.
 * Devolve `null` para número que não é plausivelmente brasileiro — melhor não
 * oferecer o botão do que mandar o admin para uma conversa com outra pessoa.
 */
export function whatsappUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!isPlausibleBRPhone(stored)) return null;
  const normalized = toStorageBRPhone(stored);
  if (!normalized || normalized.length < 12 || normalized.length > 13) return null;
  return `https://wa.me/${normalized}`;
}
