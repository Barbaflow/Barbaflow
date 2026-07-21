/**
 * Query builder fictício com a forma do PostgREST (supabase-js).
 *
 * Suporta o subconjunto realmente usado pelo app: select/insert/update/upsert/
 * delete, filtros eq/neq/gt/gte/lt/lte/in/is/not/filter, order, limit, range,
 * single e maybeSingle. Opera sobre os dados em localStorage — nunca faz rede.
 *
 * Também resolve os embeds (joins) usados pelos fluxos de agenda/agendamento
 * — ver src/mocks/relations.ts — e aplica as regras de integridade do
 * src/mocks/rules.ts nas escritas, para que o mock recuse as mesmas
 * combinações que o banco real recusaria.
 */
import { getTableRows, setTableRows, type MockRow } from "./store";
import { attachEmbeds, droppedByInnerJoin, parseSelect, type EmbedSpec } from "./relations";
import {
  authorizeWrite,
  type MockOperation,
  validateAppointment,
  validateBarberOwnedRow,
  validateBarbershop,
  validateClientBlock,
  validateClientNote,
  validatePaymentMethod,
  validateProduct,
  validateScheduleBlock,
  validateService,
  validateTeamInvitation,
  validateTicket,
  validateTicketItem,
  validateTicketPayment,
  validateUserRole,
  validateUserRoleRemoval,
} from "./rules";

export interface MockPostgrestError {
  message: string;
  details: string;
  hint: string;
  code: string;
}

export interface MockResult<T> {
  data: T;
  error: MockPostgrestError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Operation = "select" | "insert" | "update" | "upsert" | "delete";

interface Predicate {
  column: string;
  test: (value: unknown) => boolean;
}

interface NestedPredicate {
  /** Alias do embed, ex.: "appointments" em `appointments.barber_id`. */
  alias: string;
  column: string;
  test: (value: unknown) => boolean;
}

interface OrderSpec {
  column: string;
  ascending: boolean;
}

function error(message: string, code = "MOCK"): MockPostgrestError {
  return { message, details: "", hint: "", code };
}

function ok<T>(data: T, count: number | null = null): MockResult<T> {
  return { data, error: null, count, status: 200, statusText: "OK" };
}

function fail<T>(data: T, err: MockPostgrestError, status = 400): MockResult<T> {
  return { data, error: err, count: null, status, statusText: "Error" };
}

/* ------------------------------------------------------------------ */
/* Regras de escrita por tabela                                        */
/* ------------------------------------------------------------------ */

/**
 * Valida uma linha antes de gravar.
 *
 * `existing` é a linha atual em updates, para que ela não conflite consigo
 * mesma. `pending` são as demais linhas do mesmo insert em lote — necessário
 * para pagamentos divididos, em que cada parcela precisa ser somada às
 * anteriores do próprio lote antes de comparar com o total da comanda.
 */
function validateWrite(
  table: string,
  row: MockRow,
  existing?: MockRow,
  pending: readonly MockRow[] = [],
): string | null {
  switch (table) {
    case "appointments":
      return validateAppointment(row, existing);
    case "schedule_blocks":
      return validateScheduleBlock(row);
    case "services":
      return validateService(row);
    case "weekly_schedule":
      return validateBarberOwnedRow(row, "Grade semanal");
    case "availability":
      return validateBarberOwnedRow(row, "Disponibilidade");
    case "tickets":
      return validateTicket(row, existing);
    case "ticket_items":
      return validateTicketItem(row, pending);
    case "ticket_payments":
      return validateTicketPayment(row, pending);
    case "client_notes":
      return validateClientNote(row);
    case "client_blocks":
      return validateClientBlock(row);
    case "products":
      return validateProduct(row);
    case "payment_methods":
      return validatePaymentMethod(row);
    case "barbershops":
      return validateBarbershop(row, existing);
    case "user_roles":
      return validateUserRole(row, existing);
    case "team_invitations":
      return validateTeamInvitation(row, existing);
    default:
      return null;
  }
}

/** Regras que impedem certas remoções (hoje: o último admin da barbearia). */
function validateRemoval(table: string, row: MockRow): string | null {
  if (table === "user_roles") return validateUserRoleRemoval(row);
  return null;
}

/**
 * Valores que o banco real preencheria por DEFAULT e que o app não envia.
 * Sem isso um convite nasceria sem token, status ou validade.
 */
function applyInsertDefaults(table: string, row: MockRow): MockRow {
  if (table !== "team_invitations") return row;

  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  return {
    status: "pending",
    token: `mock-invite-${newId()}`,
    expires_at: expires.toISOString(),
    ...row,
  };
}

/** Erro no formato que os componentes já tratam (checam apenas `error`). */
function ruleError(message: string): MockPostgrestError {
  return { message, details: "Regra do modo offline.", hint: "", code: "MOCK_RULE" };
}

/** Recusa por falta de permissão do usuário da sessão. */
function forbiddenError(message: string): MockPostgrestError {
  return { message, details: "Permissão do modo offline.", hint: "", code: "MOCK_FORBIDDEN" };
}

/** Tabelas cujos updates sempre revalidam (não só quando mexem na agenda). */
const ALWAYS_REVALIDATED_ON_UPDATE = new Set([
  "tickets",
  "ticket_items",
  "ticket_payments",
  "client_notes",
  "client_blocks",
  "products",
  "payment_methods",
  "barbershops",
  "user_roles",
  "team_invitations",
]);

/** Colunas cuja alteração exige revalidar grade, bloqueio e conflito. */
const SCHEDULING_COLUMNS = [
  "date",
  "start_time",
  "end_time",
  "barber_id",
  "service_id",
  "barbershop_id",
] as const;

function touchesScheduling(patch: MockRow): boolean {
  return SCHEDULING_COLUMNS.some((column) => column in patch);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mock-${Date.now().toString(16)}-${Math.floor(Math.random() * 1e9).toString(16)}`;
}

/** Comparação frouxa suficiente para os tipos que aparecem nas fixtures. */
function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a ?? "");
  const sb = String(b ?? "");
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function applyOperator(op: string, rowValue: unknown, target: unknown): boolean {
  switch (op) {
    case "eq":
      return rowValue === target;
    case "neq":
      return rowValue !== target;
    case "gt":
      return compare(rowValue, target) > 0;
    case "gte":
      return compare(rowValue, target) >= 0;
    case "lt":
      return compare(rowValue, target) < 0;
    case "lte":
      return compare(rowValue, target) <= 0;
    case "is":
      return rowValue === target;
    case "in":
      return Array.isArray(target) && target.includes(rowValue);
    default:
      console.warn(`[mock] Operador "${op}" não implementado no modo mock. Filtro ignorado.`);
      return true;
  }
}

export class MockQueryBuilder implements PromiseLike<MockResult<MockRow[] | MockRow | null>> {
  private readonly table: string;
  private operation: Operation = "select";
  private payload: MockRow[] = [];
  private predicates: Predicate[] = [];
  /** Filtros sobre colunas de um embed, ex.: `.in("appointments.barber_id", ids)`. */
  private nestedPredicates: NestedPredicate[] = [];
  private embeds: EmbedSpec[] = [];
  private orderSpecs: OrderSpec[] = [];
  private limitCount: number | null = null;
  private rangeSpec: { from: number; to: number } | null = null;
  private rowMode: "many" | "single" | "maybeSingle" = "many";

  constructor(table: string) {
    this.table = table;
  }

  /* ---------------- operações ---------------- */

  select(columns?: string, _options?: { count?: string; head?: boolean }): this {
    // `.insert(...).select()` mantém a operação de escrita; só registramos os embeds.
    this.embeds = parseSelect(columns).embeds;
    return this;
  }

  insert(values: MockRow | MockRow[]): this {
    this.operation = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  upsert(values: MockRow | MockRow[]): this {
    this.operation = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: MockRow): this {
    this.operation = "update";
    this.payload = [values];
    return this;
  }

  delete(): this {
    this.operation = "delete";
    return this;
  }

  /* ---------------- filtros ---------------- */

  private addPredicate(column: string, op: string, value: unknown): this {
    const test = (rowValue: unknown) => applyOperator(op, rowValue, value);
    const dot = column.indexOf(".");

    if (dot > 0) {
      this.nestedPredicates.push({
        alias: column.slice(0, dot),
        column: column.slice(dot + 1),
        test,
      });
      return this;
    }

    this.predicates.push({ column, test });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.addPredicate(column, "eq", value);
  }

  neq(column: string, value: unknown): this {
    return this.addPredicate(column, "neq", value);
  }

  gt(column: string, value: unknown): this {
    return this.addPredicate(column, "gt", value);
  }

  gte(column: string, value: unknown): this {
    return this.addPredicate(column, "gte", value);
  }

  lt(column: string, value: unknown): this {
    return this.addPredicate(column, "lt", value);
  }

  lte(column: string, value: unknown): this {
    return this.addPredicate(column, "lte", value);
  }

  is(column: string, value: unknown): this {
    return this.addPredicate(column, "is", value);
  }

  in(column: string, values: readonly unknown[]): this {
    return this.addPredicate(column, "in", values);
  }

  not(column: string, op: string, value: unknown): this {
    this.predicates.push({ column, test: (rowValue) => !applyOperator(op, rowValue, value) });
    return this;
  }

  filter(column: string, op: string, value: unknown): this {
    return this.addPredicate(column, op, value);
  }

  like(column: string, pattern: string): this {
    const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.predicates.push({ column, test: (rowValue) => regex.test(String(rowValue ?? "")) });
    return this;
  }

  ilike(column: string, pattern: string): this {
    const regex = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
      "i",
    );
    this.predicates.push({ column, test: (rowValue) => regex.test(String(rowValue ?? "")) });
    return this;
  }

  /* ---------------- modificadores ---------------- */

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderSpecs.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeSpec = { from, to };
    return this;
  }

  single(): this {
    this.rowMode = "single";
    return this;
  }

  maybeSingle(): this {
    this.rowMode = "maybeSingle";
    return this;
  }

  throwOnError(): this {
    return this;
  }

  abortSignal(_signal: AbortSignal): this {
    return this;
  }

  /* ---------------- execução ---------------- */

  private matches(row: MockRow): boolean {
    return this.predicates.every((p) => p.test(row[p.column]));
  }

  /**
   * Checa a permissão do usuário da sessão. Devolve a resposta de recusa
   * pronta (403 / MOCK_FORBIDDEN) ou `null` quando pode seguir.
   */
  private authorize(
    operation: MockOperation,
    row: MockRow,
    existing?: MockRow,
  ): MockResult<MockRow[]> | null {
    const denied = authorizeWrite(this.table, operation, row, existing);
    return denied ? fail<MockRow[]>([], forbiddenError(denied), 403) : null;
  }

  /** Filtros sobre embeds, aplicados depois que os joins são resolvidos. */
  private matchesNested(row: MockRow): boolean {
    return this.nestedPredicates.every((p) => {
      const embedded = row[p.alias];
      if (embedded === null || typeof embedded !== "object") return false;
      return p.test((embedded as MockRow)[p.column]);
    });
  }

  private run(): MockResult<MockRow[] | MockRow | null> {
    const all = getTableRows(this.table);
    const timestamp = new Date().toISOString();
    let affected: MockRow[];

    switch (this.operation) {
      case "insert": {
        const created = this.payload.map((row) => ({
          id: newId(),
          created_at: timestamp,
          updated_at: timestamp,
          ...applyInsertDefaults(this.table, row),
        }));

        // Cada linha é validada contra as anteriores do mesmo lote: sem isso,
        // duas parcelas de R$100 numa comanda de R$100 passariam as duas.
        const accepted: MockRow[] = [];
        for (const candidate of created) {
          const denied = this.authorize("insert", candidate);
          if (denied) return denied;

          const problem = validateWrite(this.table, candidate, undefined, accepted);
          if (problem) {
            return fail<MockRow[]>([], ruleError(problem), 409);
          }
          accepted.push(candidate);
        }

        setTableRows(this.table, [...all, ...created]);
        affected = created;
        break;
      }

      case "upsert": {
        const next = [...all];
        const created: MockRow[] = [];
        for (const row of this.payload) {
          const index = next.findIndex((existing) => existing.id === row.id);
          if (index >= 0) {
            next[index] = { ...next[index], ...row, updated_at: timestamp };
            created.push(next[index]);
          } else {
            const inserted = { id: newId(), created_at: timestamp, updated_at: timestamp, ...row };
            next.push(inserted);
            created.push(inserted);
          }
        }
        setTableRows(this.table, next);
        affected = created;
        break;
      }

      case "update": {
        const patch = this.payload[0] ?? {};
        const pending: MockRow[] = [];
        const next = all.map((row) => {
          if (!this.matches(row)) return row;
          const updated = { ...row, ...patch, updated_at: timestamp };
          pending.push(updated);
          return updated;
        });

        for (const updated of pending) {
          const original = all.find((row) => row.id === updated.id);
          const denied = this.authorize("update", updated, original);
          if (denied) return denied;
        }

        // Reagendamento revalida conflito. Mudanças que não mexem no
        // encaixe (cancelar, concluir, marcar falta, editar observação)
        // passam direto: revalidá-las impediria, por exemplo, cancelar um
        // agendamento cuja data foi bloqueada depois.
        if (ALWAYS_REVALIDATED_ON_UPDATE.has(this.table) || touchesScheduling(patch)) {
          for (const updated of pending) {
            const original = all.find((row) => row.id === updated.id);
            const problem = validateWrite(this.table, updated, original);
            if (problem) {
              return fail<MockRow[]>([], ruleError(problem), 409);
            }
          }
        }

        setTableRows(this.table, next);
        affected = pending;
        break;
      }

      case "delete": {
        affected = all.filter((row) => this.matches(row));

        for (const row of affected) {
          const denied = this.authorize("delete", row, row);
          if (denied) return denied;

          const problem = validateRemoval(this.table, row);
          if (problem) {
            return fail<MockRow[]>([], ruleError(problem), 409);
          }
        }

        setTableRows(
          this.table,
          all.filter((row) => !this.matches(row)),
        );
        break;
      }

      case "select":
      default: {
        affected = all.filter((row) => this.matches(row));

        // Joins primeiro, para que filtros como `.in("appointments.barber_id", …)`
        // e o descarte de `!inner` possam enxergar o objeto embutido.
        if (this.embeds.length > 0) {
          affected = affected
            .map((row) => attachEmbeds(this.table, row, this.embeds))
            .filter((row) => !droppedByInnerJoin(row, this.embeds));
        }

        if (this.nestedPredicates.length > 0) {
          affected = affected.filter((row) => this.matchesNested(row));
        }

        for (const spec of [...this.orderSpecs].reverse()) {
          affected.sort((a, b) => {
            const result = compare(a[spec.column], b[spec.column]);
            return spec.ascending ? result : -result;
          });
        }

        if (this.rangeSpec) {
          affected = affected.slice(this.rangeSpec.from, this.rangeSpec.to + 1);
        }
        if (this.limitCount !== null) {
          affected = affected.slice(0, this.limitCount);
        }
        break;
      }
    }

    // `.insert(...).select("…, tabela(...)")` também devolve os embeds.
    if (this.embeds.length > 0 && this.operation !== "select") {
      affected = affected.map((row) => attachEmbeds(this.table, row, this.embeds));
    }

    const total = affected.length;

    if (this.rowMode === "single") {
      if (total !== 1) {
        return fail<MockRow | null>(
          null,
          error(
            `Esperava exatamente 1 linha em "${this.table}", encontrou ${total}.`,
            total === 0 ? "PGRST116" : "PGRST114",
          ),
          406,
        );
      }
      return ok<MockRow>(affected[0], total);
    }

    if (this.rowMode === "maybeSingle") {
      if (total > 1) {
        return fail<MockRow | null>(
          null,
          error(`Esperava no máximo 1 linha em "${this.table}", encontrou ${total}.`, "PGRST114"),
          406,
        );
      }
      return ok<MockRow | null>(affected[0] ?? null, total);
    }

    return ok<MockRow[]>(affected, total);
  }

  then<TResult1 = MockResult<MockRow[] | MockRow | null>, TResult2 = never>(
    onfulfilled?:
      | ((value: MockResult<MockRow[] | MockRow | null>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
