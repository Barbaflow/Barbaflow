/**
 * Resolução dos embeds (joins) do PostgREST no modo offline.
 *
 * Implementa apenas os relacionamentos realmente usados pelos fluxos de
 * agenda e agendamento. Não é um substituto do PostgREST: ver as limitações
 * documentadas no fim deste arquivo.
 */
import { getTableRows, type MockRow } from "./store";

/* ------------------------------------------------------------------ */
/* Mapa de relacionamentos                                             */
/* ------------------------------------------------------------------ */

interface Relation {
  /** Tabela apontada pelo embed. */
  table: string;
  /** Coluna da tabela de origem. */
  localKey: string;
  /** Coluna da tabela de destino. */
  foreignKey: string;
}

/**
 * origem → nome da tabela embutida → como ligar as duas.
 *
 * A chave é o nome da *tabela* alvo (como o PostgREST espera em
 * `alias:tabela(colunas)`), não o alias escolhido pelo componente.
 */
const RELATIONS: Record<string, Record<string, Relation>> = {
  appointments: {
    services: { table: "services", localKey: "service_id", foreignKey: "id" },
    barbershops: { table: "barbershops", localKey: "barbershop_id", foreignKey: "id" },
    // Ambíguo no schema real (client_id e barber_id apontam para profiles).
    // Os fluxos atuais só embutem o cliente, então fixamos client_id.
    profiles: { table: "profiles", localKey: "client_id", foreignKey: "user_id" },
  },
  reviews: {
    appointments: { table: "appointments", localKey: "appointment_id", foreignKey: "id" },
    profiles: { table: "profiles", localKey: "client_id", foreignKey: "user_id" },
    barbershops: { table: "barbershops", localKey: "barbershop_id", foreignKey: "id" },
  },
  services: {
    barbershops: { table: "barbershops", localKey: "barbershop_id", foreignKey: "id" },
    profiles: { table: "profiles", localKey: "barber_id", foreignKey: "user_id" },
  },
  user_roles: {
    profiles: { table: "profiles", localKey: "user_id", foreignKey: "user_id" },
    barbershops: { table: "barbershops", localKey: "barbershop_id", foreignKey: "id" },
  },
};

/* ------------------------------------------------------------------ */
/* Parsing da string de select                                         */
/* ------------------------------------------------------------------ */

export interface EmbedSpec {
  /** Chave sob a qual o objeto embutido é devolvido. */
  alias: string;
  /** Tabela alvo declarada no select. */
  table: string;
  /** `!inner` — descarta a linha quando o embed não resolve. */
  inner: boolean;
}

export interface ParsedSelect {
  embeds: EmbedSpec[];
}

/**
 * Divide uma lista de colunas no nível superior, ignorando vírgulas que
 * estejam dentro de parênteses de um embed.
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Extrai os embeds de uma string de select.
 *
 * Reconhece `tabela(...)`, `alias:tabela(...)` e o modificador `!inner`.
 * Colunas simples são ignoradas: o mock devolve a linha inteira (ver
 * limitações).
 */
export function parseSelect(columns: string | undefined): ParsedSelect {
  if (!columns || columns.trim() === "" || columns.trim() === "*") {
    return { embeds: [] };
  }

  const embeds: EmbedSpec[] = [];

  for (const part of splitTopLevel(columns)) {
    const open = part.indexOf("(");
    if (open === -1) continue; // coluna simples

    const head = part.slice(0, open).trim();
    const colon = head.indexOf(":");

    const aliasPart = colon === -1 ? head : head.slice(0, colon).trim();
    const targetPart = colon === -1 ? head : head.slice(colon + 1).trim();

    const inner = targetPart.includes("!inner");
    const table = targetPart.replace("!inner", "").trim();
    const alias = colon === -1 ? table : aliasPart;

    if (table) embeds.push({ alias, table, inner });
  }

  return { embeds };
}

/* ------------------------------------------------------------------ */
/* Aplicação dos embeds                                                */
/* ------------------------------------------------------------------ */

/**
 * Devolve uma cópia da linha com os embeds resolvidos.
 * Um embed sem correspondência vira `null`, como no PostgREST.
 */
export function attachEmbeds(table: string, row: MockRow, embeds: EmbedSpec[]): MockRow {
  if (embeds.length === 0) return row;

  const relationsForTable = RELATIONS[table] ?? {};
  const enriched: MockRow = { ...row };

  for (const embed of embeds) {
    const relation = relationsForTable[embed.table];

    if (!relation) {
      console.warn(
        `[mock] Relacionamento "${table} → ${embed.table}" não mapeado. ` +
          `O embed "${embed.alias}" será null.`,
      );
      enriched[embed.alias] = null;
      continue;
    }

    const localValue = row[relation.localKey];
    const match =
      localValue === null || localValue === undefined
        ? undefined
        : getTableRows(relation.table).find((target) => target[relation.foreignKey] === localValue);

    enriched[embed.alias] = match ?? null;
  }

  return enriched;
}

/** `true` quando algum embed `!inner` não resolveu — a linha deve sair. */
export function droppedByInnerJoin(row: MockRow, embeds: EmbedSpec[]): boolean {
  return embeds.some((embed) => embed.inner && row[embed.alias] === null);
}

/*
 * Diferenças conhecidas em relação ao Supabase/PostgREST real:
 *
 * 1. Projeção de colunas: o mock devolve a linha inteira, ignorando a lista
 *    de colunas do select. Um componente que leia uma coluna que esqueceu de
 *    selecionar funciona aqui e falharia no banco real.
 * 2. Só relacionamentos "muitos-para-um" (o embed é um objeto, nunca um array).
 *    Nenhum fluxo de agenda/agendamento depende de embed em lista.
 * 3. `appointments → profiles` é fixado em client_id; o schema real tem duas
 *    FKs para profiles e exigiria desambiguação explícita.
 * 4. Embeds aninhados (`a(b(c))`) não são suportados.
 * 5. `!inner` filtra a linha, mas não altera a cardinalidade como um JOIN SQL.
 */
