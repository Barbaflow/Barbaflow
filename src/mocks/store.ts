/**
 * Persistência dos dados fictícios em localStorage.
 *
 * Em SSR (sem window) o estado vive apenas em memória durante a requisição.
 */
import { buildSeedDatabase, type MockDatabase, type TableName } from "./fixtures";

const STORAGE_KEY = "barbaflow.mock.db.v1";

/** Linha genérica, usada internamente pelo query builder. */
export type MockRow = Record<string, unknown>;

let memoryDb: MockDatabase | null = null;

const listeners = new Set<() => void>();

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readFromStorage(): MockDatabase | null {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as MockDatabase;
  } catch {
    console.warn("[mock] Não foi possível ler os dados fictícios do localStorage. Recriando.");
    return null;
  }
}

function writeToStorage(db: MockDatabase): void {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    console.warn("[mock] Não foi possível gravar os dados fictícios no localStorage.");
  }
}

/** Banco fictício atual, criando o seed na primeira chamada. */
export function getMockDatabase(): MockDatabase {
  if (memoryDb) return memoryDb;

  memoryDb = readFromStorage() ?? buildSeedDatabase();
  writeToStorage(memoryDb);
  return memoryDb;
}

/** Linhas de uma tabela. Tabelas fora do recorte atual resolvem para lista vazia. */
export function getTableRows(table: TableName | string): MockRow[] {
  const db = getMockDatabase() as Record<string, unknown>;
  const rows = db[table];
  return Array.isArray(rows) ? (rows as MockRow[]) : [];
}

/** Substitui as linhas de uma tabela e persiste. */
export function setTableRows(table: TableName | string, rows: MockRow[]): void {
  const db = getMockDatabase() as Record<string, unknown>;
  db[table] = rows;
  writeToStorage(memoryDb as MockDatabase);
  notify();
}

/** Restaura os dados fictícios originais, descartando alterações locais. */
export function resetMockDatabase(): void {
  memoryDb = buildSeedDatabase();
  writeToStorage(memoryDb);
  notify();
}

/** Assina mudanças no banco fictício (usado pela ação de restaurar). */
export function subscribeToMockDatabase(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}
