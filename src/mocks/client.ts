/**
 * Cliente Supabase fictício do modo offline (VITE_DATA_SOURCE=mock).
 *
 * Expõe a mesma superfície usada pelo app (auth, from, rpc, channel, storage,
 * functions) lendo e gravando apenas em localStorage. Nenhuma requisição de
 * rede é feita e `createClient` do supabase-js nunca é chamado.
 */
import { mockAuth } from "./auth";
import { MockQueryBuilder, type MockResult } from "./query-builder";
import { getTableRows, type MockRow } from "./store";

/* ------------------------------------------------------------------ */
/* RPCs                                                                */
/* ------------------------------------------------------------------ */

type RpcArgs = Record<string, unknown>;
type RpcHandler = (args: RpcArgs) => unknown;

function rolesOf(userId: unknown): MockRow[] {
  return getTableRows("user_roles").filter((row) => row.user_id === userId);
}

const RPC_HANDLERS: Record<string, RpcHandler> = {
  has_role: (args) => rolesOf(args._user_id).some((row) => row.role === args._role),

  has_role_in_barbershop: (args) =>
    rolesOf(args._user_id).some(
      (row) => row.role === args._role && row.barbershop_id === args._barbershop_id,
    ),

  get_public_barbers: (args) =>
    getTableRows("user_roles")
      .filter((row) => row.role === "barbeiro" && row.barbershop_id === args._barbershop_id)
      .map((row) => ({ user_id: row.user_id })),

  get_barber_display_names: (args) => {
    const ids = Array.isArray(args._user_ids) ? args._user_ids : [];
    return getTableRows("profiles")
      .filter((row) => ids.includes(row.user_id))
      .map((row) => ({
        user_id: row.user_id,
        display_name: row.full_name ?? "Profissional",
        avatar_url: row.avatar_url ?? null,
      }));
  },

  get_client_phone: (args) =>
    getTableRows("profiles").find((row) => row.user_id === args._client_id)?.phone ?? null,

  check_client_noshow_block: () => false,
  check_appointment_limit: () => true,
  check_barber_limit: () => true,
  has_active_subscription: () => true,
};

function runRpc(name: string, args: RpcArgs): MockResult<unknown> {
  const handler = RPC_HANDLERS[name];

  if (!handler) {
    console.warn(`[mock] RPC "${name}" não implementada no modo mock. Retornando null.`);
    return { data: null, error: null, count: null, status: 200, statusText: "OK" };
  }

  return { data: handler(args), error: null, count: null, status: 200, statusText: "OK" };
}

/* ------------------------------------------------------------------ */
/* Realtime / storage / functions — no-ops                             */
/* ------------------------------------------------------------------ */

interface MockChannel {
  on: (...args: unknown[]) => MockChannel;
  subscribe: (callback?: (status: string) => void) => MockChannel;
  unsubscribe: () => Promise<"ok">;
  topic: string;
}

function createMockChannel(topic: string): MockChannel {
  const channel: MockChannel = {
    topic,
    on: () => channel,
    subscribe: (callback) => {
      callback?.("SUBSCRIBED");
      return channel;
    },
    unsubscribe: async () => "ok" as const,
  };
  return channel;
}

const mockStorageBucket = {
  async upload(path: string, _file: unknown, _options?: unknown) {
    return { data: { path, id: path, fullPath: path }, error: null };
  },
  getPublicUrl(path: string) {
    return { data: { publicUrl: `/mock-storage/${path}` } };
  },
  async remove(paths: string[]) {
    return { data: paths.map((path) => ({ name: path })), error: null };
  },
  async list() {
    return { data: [], error: null };
  },
};

/* ------------------------------------------------------------------ */
/* Cliente                                                             */
/* ------------------------------------------------------------------ */

export const mockSupabaseClient = {
  auth: mockAuth,

  from(table: string) {
    return new MockQueryBuilder(table);
  },

  rpc(name: string, args?: RpcArgs) {
    return Promise.resolve(runRpc(name, args ?? {}));
  },

  channel(topic: string) {
    return createMockChannel(topic);
  },

  removeChannel(_channel: unknown) {
    return Promise.resolve("ok" as const);
  },

  removeAllChannels() {
    return Promise.resolve([]);
  },

  storage: {
    from(_bucket: string) {
      return mockStorageBucket;
    },
  },

  functions: {
    async invoke(name: string, _options?: unknown) {
      console.warn(`[mock] Edge function "${name}" não é executada no modo mock.`);
      return {
        data: null,
        error: { message: `Edge function "${name}" indisponível no modo mock.`, name: "MockError" },
      };
    },
  },
};
