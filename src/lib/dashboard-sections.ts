/**
 * Lógica pura das seções do dashboard operacional.
 *
 * Fica fora do componente para poder ser exercitada pelo harness: o ponto
 * crítico aqui é que uma consulta que FALHA nunca pode virar zero — foi
 * exatamente esse o defeito encontrado no smoke test contra o Supabase real.
 */

export interface OpenComandaRow {
  id: string;
  client_id: string | null;
  barber_id: string;
  total: number;
  created_at: string;
}

/** Resultado das duas consultas de comandas abertas (contagem + lista). */
export type OpenComandasResult =
  | { status: "ready"; count: number; rows: OpenComandaRow[] }
  | { status: "error"; message: string };

interface QueryError {
  message: string;
}

/**
 * As duas consultas injetadas. A contagem continua sendo `head: true` com
 * `count: "exact"` — nunca carregamos todas as comandas só para contar.
 */
export interface OpenComandasQueries {
  count(): PromiseLike<{ count: number | null; error: QueryError | null }>;
  list(): PromiseLike<{ data: OpenComandaRow[] | null; error: QueryError | null }>;
}

/**
 * Carrega contagem + lista de comandas abertas.
 *
 * Qualquer erro (na contagem OU na lista) devolve `status: "error"`. O chamador
 * usa isso para acionar o SectionError apenas desta seção; nenhuma contagem é
 * publicada quando há erro, para que a UI jamais exiba um zero inventado.
 */
export async function loadOpenComandas(queries: OpenComandasQueries): Promise<OpenComandasResult> {
  const [counted, listed] = await Promise.all([queries.count(), queries.list()]);

  // A contagem vem primeiro porque é ela que alimenta o badge: se falhar, não
  // há número confiável a exibir, mesmo que a lista tenha respondido.
  if (counted.error) return { status: "error", message: counted.error.message };
  if (listed.error) return { status: "error", message: listed.error.message };

  return { status: "ready", count: counted.count ?? 0, rows: listed.data ?? [] };
}

/**
 * Texto do SectionError. Com título vazio ou só espaços, cai numa frase
 * completa em vez de deixar " ." órfão no fim.
 */
export function sectionErrorMessage(title?: string): string {
  const t = title?.trim();
  return t ? `Falha ao carregar ${t}.` : "Falha ao carregar esta seção.";
}
