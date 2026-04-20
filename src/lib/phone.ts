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
  return d.startsWith("55") ? d : `55${d}`;
}

/** Formats a stored phone for display. Accepts stored or UI value. */
export function displayBRPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  let d = digitsOnly(stored);
  if (d.startsWith("55") && d.length > 11) d = d.slice(2);
  return maskBRPhone(d);
}

/** Builds a wa.me URL from any stored or formatted phone. */
export function whatsappUrl(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const d = toStorageBRPhone(stored);
  if (!d || d.length < 12) return null;
  return `https://wa.me/${d}`;
}
