/**
 * Ator da sessão fictícia.
 *
 * Módulo deliberadamente sem imports: é a folha do grafo do modo mock.
 * `auth.ts` escreve aqui a cada mudança de sessão e `rules.ts` lê para
 * autorizar as escritas — sem que rules dependa de auth (o que criaria um
 * ciclo auth → fixtures → … → rules → auth).
 */

/** Chave usada por auth.ts para persistir a sessão. Definida aqui para
 *  que este módulo consiga se re-hidratar sozinho após um reload. */
export const MOCK_SESSION_STORAGE_KEY = "barbaflow.mock.session.v1";

/** Quem está executando a operação. */
export interface MockActor {
  id: string;
  /** Pode faltar em sessões antigas gravadas no localStorage. */
  email: string | null;
}

let actor: MockActor | null = null;
let hydrated = false;

interface PersistedSession {
  user?: { id?: unknown; email?: unknown };
}

function hydrateFromStorage(): void {
  hydrated = true;

  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;

  try {
    const raw = window.localStorage.getItem(MOCK_SESSION_STORAGE_KEY);
    if (!raw) return;

    const parsed: unknown = JSON.parse(raw);
    const user = (parsed as PersistedSession | null)?.user;
    if (!user || typeof user.id !== "string") return;

    actor = { id: user.id, email: typeof user.email === "string" ? user.email : null };
  } catch {
    actor = null;
  }
}

/** Ator atual, re-hidratando do localStorage na primeira leitura. */
export function getMockActor(): MockActor | null {
  if (!hydrated) hydrateFromStorage();
  return actor;
}

/** Atualiza o ator. Chamado por auth.ts em login, logout e carga da sessão. */
export function setMockActor(next: MockActor | null): void {
  actor = next;
  hydrated = true;
}
