/**
 * Helpers de CEP brasileiro com integração ViaCEP.
 */

export const BR_STATES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA",
  "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN",
  "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type BRState = (typeof BR_STATES)[number];

export function digitsOnlyCep(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function maskCep(value: string): string {
  const d = digitsOnlyCep(value);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCep(value: string | null | undefined): boolean {
  if (!value) return false;
  return digitsOnlyCep(value).length === 8;
}

export interface ViaCepResult {
  cep: string;
  state: string;
  city: string;
  neighborhood: string;
  street: string;
}

/** Consulta ViaCEP e retorna endereço normalizado. Lança erro se inválido. */
export async function fetchViaCep(cep: string): Promise<ViaCepResult> {
  const d = digitsOnlyCep(cep);
  if (d.length !== 8) throw new Error("CEP inválido");

  const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
  if (!res.ok) throw new Error("Não foi possível consultar o CEP");

  const json = (await res.json()) as {
    erro?: boolean;
    cep?: string;
    uf?: string;
    localidade?: string;
    bairro?: string;
    logradouro?: string;
  };

  if (json.erro) throw new Error("CEP não encontrado");

  return {
    cep: maskCep(d),
    state: (json.uf || "").toUpperCase(),
    city: json.localidade || "",
    neighborhood: json.bairro || "",
    street: json.logradouro || "",
  };
}
