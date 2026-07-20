/**
 * Query builder fictício com a forma do PostgREST (supabase-js).
 *
 * Suporta o subconjunto realmente usado pelo app: select/insert/update/upsert/
 * delete, filtros eq/neq/gt/gte/lt/lte/in/is/not/filter, order, limit, range,
 * single e maybeSingle. Opera sobre os dados em localStorage — nunca faz rede.
 */
import { getTableRows, setTableRows, type MockRow } from "./store";

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
  private orderSpecs: OrderSpec[] = [];
  private limitCount: number | null = null;
  private rangeSpec: { from: number; to: number } | null = null;
  private rowMode: "many" | "single" | "maybeSingle" = "many";

  constructor(table: string) {
    this.table = table;
  }

  /* ---------------- operações ---------------- */

  select(_columns?: string, _options?: { count?: string; head?: boolean }): this {
    if (this.operation === "select") this.operation = "select";
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
    this.predicates.push({ column, test: (rowValue) => applyOperator(op, rowValue, value) });
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
          ...row,
        }));
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
        affected = [];
        const next = all.map((row) => {
          if (!this.matches(row)) return row;
          const updated = { ...row, ...patch, updated_at: timestamp };
          affected.push(updated);
          return updated;
        });
        setTableRows(this.table, next);
        break;
      }

      case "delete": {
        affected = all.filter((row) => this.matches(row));
        setTableRows(
          this.table,
          all.filter((row) => !this.matches(row)),
        );
        break;
      }

      case "select":
      default: {
        affected = all.filter((row) => this.matches(row));

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
