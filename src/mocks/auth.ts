/**
 * Autenticação simulada do modo offline.
 *
 * Não valida senha: qualquer senha é aceita para os e-mails fictícios.
 * A sessão é persistida em localStorage, então o login sobrevive ao reload.
 */
import type { Session, User } from "@supabase/supabase-js";
import { MOCK_ADMIN_B_EMAIL, MOCK_ADMIN_EMAIL, MOCK_USER_IDS } from "./fixtures";

const SESSION_KEY = "barbaflow.mock.session.v1";

export interface MockAuthError {
  message: string;
  name: string;
  status: number;
}

interface MockAccount {
  id: string;
  email: string;
  fullName: string;
  phone: string;
  /** Só para exibição no banner do modo offline. */
  description: string;
}

/** Contas fictícias que podem entrar no modo offline. Qualquer senha serve. */
export const MOCK_ACCOUNTS: readonly MockAccount[] = [
  // Barbearia A — "Barbearia Modelo (offline)"
  {
    id: MOCK_USER_IDS.admin,
    email: MOCK_ADMIN_EMAIL,
    fullName: "Alex Admin",
    phone: "+5511900000001",
    description: "Admin · Barbearia A",
  },
  {
    id: MOCK_USER_IDS.barberAna,
    email: "ana@barbearia.teste",
    fullName: "Ana Tesoura",
    phone: "+5511900000002",
    description: "Barbeira · Barbearia A",
  },
  {
    id: MOCK_USER_IDS.barberBruno,
    email: "bruno@barbearia.teste",
    fullName: "Bruno Navalha",
    phone: "+5511900000003",
    description: "Barbeiro · Barbearia A",
  },
  {
    id: MOCK_USER_IDS.clienteCarla,
    email: "carla@cliente.teste",
    fullName: "Carla Cliente",
    phone: "+5511900000004",
    description: "Cliente · Barbearia A",
  },
  {
    id: MOCK_USER_IDS.clienteCaio,
    email: "caio@cliente.teste",
    fullName: "Caio Cliente",
    phone: "+5511900000005",
    description: "Cliente · Barbearia A",
  },
  // Barbearia B — "Navalha de Ouro (offline)"
  {
    id: MOCK_USER_IDS.adminBeatriz,
    email: MOCK_ADMIN_B_EMAIL,
    fullName: "Beatriz Dona",
    phone: "+5521900000001",
    description: "Admin · Barbearia B",
  },
  {
    id: MOCK_USER_IDS.barberBianca,
    email: "bianca@navalha.teste",
    fullName: "Bianca Lâmina",
    phone: "+5521900000002",
    description: "Barbeira · Barbearia B",
  },
  {
    id: MOCK_USER_IDS.barberBreno,
    email: "breno@navalha.teste",
    fullName: "Breno Pente",
    phone: "+5521900000003",
    description: "Barbeiro · Barbearia B",
  },
  {
    id: MOCK_USER_IDS.clienteBento,
    email: "bento@cliente.teste",
    fullName: "Bento Cliente",
    phone: "+5521900000004",
    description: "Cliente · Barbearia B",
  },
];

function authError(message: string, status = 400): MockAuthError {
  return { message, name: "AuthApiError", status };
}

function buildUser(account: MockAccount): User {
  const now = new Date().toISOString();
  return {
    id: account.id,
    aud: "authenticated",
    role: "authenticated",
    email: account.email,
    phone: account.phone,
    created_at: now,
    updated_at: now,
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "mock", providers: ["mock"] },
    user_metadata: { full_name: account.fullName, phone: account.phone },
    identities: [],
    factors: [],
  };
}

function buildSession(account: MockAccount): Session {
  const expiresIn = 60 * 60 * 24;
  return {
    access_token: `mock-access-token.${account.id}`,
    refresh_token: `mock-refresh-token.${account.id}`,
    token_type: "bearer",
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    user: buildUser(account),
  };
}

/* ------------------------------------------------------------------ */
/* Estado                                                              */
/* ------------------------------------------------------------------ */

type AuthChangeEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED";
type AuthCallback = (event: AuthChangeEvent, session: Session | null) => void;

let currentSession: Session | null = null;
let sessionLoaded = false;
const subscribers = new Map<string, AuthCallback>();

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadSession(): Session | null {
  if (sessionLoaded) return currentSession;
  sessionLoaded = true;

  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    currentSession = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    currentSession = null;
  }
  return currentSession;
}

function persistSession(session: Session | null): void {
  currentSession = session;
  sessionLoaded = true;

  if (!hasLocalStorage()) return;
  if (session) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

function emit(event: AuthChangeEvent, session: Session | null): void {
  for (const callback of subscribers.values()) callback(event, session);
}

function findAccount(email: string): MockAccount | undefined {
  const normalized = email.trim().toLowerCase();
  return MOCK_ACCOUNTS.find((account) => account.email === normalized);
}

/** Limpa a sessão fictícia (usado ao restaurar os dados). */
export function clearMockSession(): void {
  persistSession(null);
  emit("SIGNED_OUT", null);
}

/* ------------------------------------------------------------------ */
/* API no formato supabase.auth                                        */
/* ------------------------------------------------------------------ */

export const mockAuth = {
  async getSession() {
    return { data: { session: loadSession() }, error: null };
  },

  async getUser() {
    return { data: { user: loadSession()?.user ?? null }, error: null };
  },

  async getClaims(_token?: string) {
    const user = loadSession()?.user ?? null;
    return { data: user ? { claims: { sub: user.id, email: user.email } } : null, error: null };
  },

  onAuthStateChange(callback: AuthCallback) {
    const id = `mock-sub-${subscribers.size + 1}-${Date.now()}`;
    subscribers.set(id, callback);

    // supabase-js entrega o evento inicial de forma assíncrona.
    setTimeout(() => {
      if (subscribers.has(id)) callback("INITIAL_SESSION", loadSession());
    }, 0);

    return {
      data: {
        subscription: {
          id,
          callback,
          unsubscribe: () => {
            subscribers.delete(id);
          },
        },
      },
    };
  },

  async signInWithPassword({ email }: { email: string; password: string }) {
    const account = findAccount(email);
    if (!account) {
      return {
        data: { user: null, session: null },
        error: authError(
          `Modo offline: e-mail não cadastrado. Use ${MOCK_ADMIN_EMAIL} (qualquer senha).`,
          400,
        ),
      };
    }

    const session = buildSession(account);
    persistSession(session);
    emit("SIGNED_IN", session);
    return { data: { user: session.user, session }, error: null };
  },

  async signUp({ email }: { email: string; password: string; options?: unknown }) {
    const account = findAccount(email);
    if (!account) {
      return {
        data: { user: null, session: null },
        error: authError(
          "Modo offline: cadastro desabilitado. Use uma das contas fictícias existentes.",
          400,
        ),
      };
    }

    const session = buildSession(account);
    persistSession(session);
    emit("SIGNED_IN", session);
    return { data: { user: session.user, session }, error: null };
  },

  async signInWithOAuth(_options: unknown) {
    const account = MOCK_ACCOUNTS[0];
    const session = buildSession(account);
    persistSession(session);
    emit("SIGNED_IN", session);
    return { data: { provider: "mock", url: null }, error: null };
  },

  async setSession(_tokens: unknown) {
    const session = loadSession();
    return { data: { user: session?.user ?? null, session }, error: null };
  },

  async updateUser(attributes: { data?: Record<string, unknown> }) {
    const session = loadSession();
    if (!session) {
      return { data: { user: null }, error: authError("Modo offline: sem sessão ativa.", 401) };
    }

    const updated: Session = {
      ...session,
      user: {
        ...session.user,
        user_metadata: { ...session.user.user_metadata, ...(attributes.data ?? {}) },
      },
    };
    persistSession(updated);
    emit("USER_UPDATED", updated);
    return { data: { user: updated.user }, error: null };
  },

  async resetPasswordForEmail(_email: string, _options?: unknown) {
    return { data: {}, error: null };
  },

  async signOut() {
    persistSession(null);
    emit("SIGNED_OUT", null);
    return { error: null };
  },
};
