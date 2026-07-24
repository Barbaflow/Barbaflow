/**
 * Harness da assinatura SaaS da barbearia (modo offline).
 *
 * Exercita a MESMA superfície do app (mockSupabaseClient.rpc) contra as RPCs de
 * cobrança que espelham a migration 20260724130000_subscription_billing_lifecycle:
 *   - get_barbershop_subscription (leitura por admin/super do tenant);
 *   - record_billing_event (idempotência de webhook);
 *   - apply_subscription_from_webhook (aplica a assinatura validando POSSE).
 *
 * Cobre: leitura da assinatura, isolamento por tenant, papel administrativo,
 * webhook válido/ inválido (posse)/ duplicado, atualização de status, pagamento
 * aprovado/recusado, cancelamento, downgrade que preserva dados, limites por
 * plano, assinatura free, super_admin, e recusa de cliente/anon.
 */
import { mockSupabaseClient } from "@/mocks/client";
import { getTableRows, resetMockDatabase } from "@/mocks/store";
import { clearMockSession } from "@/mocks/auth";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_ADMIN_B_EMAIL,
  MOCK_ADMIN_C_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_B_ID,
  MOCK_BARBERSHOP_C_ID,
  MOCK_SUPER_ADMIN_EMAIL,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

/* ------------------------------------------------------------------ */
/* Infra de asserção (mesmo padrão dos demais harnesses)               */
/* ------------------------------------------------------------------ */

interface Check {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
let currentGroup = "geral";
function group(name: string): void {
  currentGroup = name;
}
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ group: currentGroup, name, ok, detail });
}

const PASSWORD = "qualquer-senha";
async function login(email: string): Promise<string> {
  const res = await mockSupabaseClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error || !res.data.session) {
    throw new Error(`Falha no login fictício: ${email} — ${res.error?.message ?? "sem sessão"}`);
  }
  return res.data.session.user.id;
}

interface RpcResult {
  data: unknown;
  error: { message: string; code: string } | null;
}
async function rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (await mockSupabaseClient.rpc(name, args)) as RpcResult;
}
function rows(r: RpcResult): Record<string, unknown>[] {
  return Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
}
function firstRow(r: RpcResult): Record<string, unknown> | null {
  return rows(r)[0] ?? null;
}

const A = MOCK_BARBERSHOP_ID;
const B = MOCK_BARBERSHOP_B_ID;
const C = MOCK_BARBERSHOP_C_ID;
const future = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString();
};

/** Payload padrão de um webhook de assinatura, sobrescrevível por teste. */
function subEvent(over: Record<string, unknown>): Record<string, unknown> {
  return {
    _user_id: MOCK_USER_IDS.adminCarlos,
    _barbershop_id: C,
    _paddle_subscription_id: "sub-c-1",
    _paddle_customer_id: "cus-c",
    _product_id: "pro_plan",
    _price_id: "pro_monthly",
    _status: "active",
    _plan_name: "pro",
    _current_period_start: new Date().toISOString(),
    _current_period_end: future(),
    _cancel_at_period_end: false,
    _canceled_at: null,
    _trial_end: null,
    _environment: "sandbox",
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* Grupos                                                              */
/* ------------------------------------------------------------------ */

async function testReadAndIsolation(): Promise<void> {
  group("leitura e isolamento");
  resetMockDatabase();
  clearMockSession();

  await login(MOCK_ADMIN_EMAIL); // admin A
  const aSub = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: A }));
  check("admin A lê a própria assinatura (active)", aSub?.status === "active", `status=${aSub?.status}`);

  const aOnB = await rpc("get_barbershop_subscription", { _barbershop_id: B });
  check("admin A é BARRADO na assinatura de B (isolamento)", aOnB.error !== null, `err=${aOnB.error?.code}`);

  await login(MOCK_ADMIN_B_EMAIL); // admin B
  const bSub = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: B }));
  check("admin B vê B em pagamento atrasado (past_due)", bSub?.status === "past_due", `status=${bSub?.status}`);

  await login(MOCK_ADMIN_C_EMAIL); // admin C (free, sem assinatura)
  const cSub = await rpc("get_barbershop_subscription", { _barbershop_id: C });
  check("admin C (free) não tem assinatura (lista vazia)", rows(cSub).length === 0);

  // super_admin acessa qualquer tenant informado
  await login(MOCK_SUPER_ADMIN_EMAIL);
  const superB = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: B }));
  check("super_admin lê a assinatura de B", superB?.status === "past_due");
}

async function testRoleGuards(): Promise<void> {
  group("papel administrativo");
  resetMockDatabase();
  clearMockSession();

  // barbeiro da A não gerencia assinatura
  await login("ana@barbearia.teste");
  const barberRes = await rpc("get_barbershop_subscription", { _barbershop_id: A });
  check("barbeiro é recusado (só admin gerencia)", barberRes.error !== null, `err=${barberRes.error?.code}`);

  // cliente é recusado
  await login("carla@cliente.teste");
  const clientRes = await rpc("get_barbershop_subscription", { _barbershop_id: A });
  check("cliente é recusado", clientRes.error !== null, `err=${clientRes.error?.code}`);

  // anônimo é recusado
  clearMockSession();
  const anonRes = await rpc("get_barbershop_subscription", { _barbershop_id: A });
  check("anônimo é recusado", anonRes.error !== null, `err=${anonRes.error?.code}`);
}

async function testWebhookIdempotency(): Promise<void> {
  group("webhook idempotente");
  resetMockDatabase();
  clearMockSession();

  const first = await rpc("record_billing_event", {
    _provider: "paddle", _event_id: "evt-100", _event_type: "subscription.created", _environment: "sandbox",
  });
  check("primeiro evento é novo (true)", first.data === true, `data=${first.data}`);

  const dup = await rpc("record_billing_event", {
    _provider: "paddle", _event_id: "evt-100", _event_type: "subscription.created", _environment: "sandbox",
  });
  check("evento duplicado é ignorado (false)", dup.data === false, `data=${dup.data}`);

  const other = await rpc("record_billing_event", {
    _provider: "paddle", _event_id: "evt-200", _event_type: "subscription.updated", _environment: "sandbox",
  });
  check("evento diferente é novo (true)", other.data === true);
}

async function testWebhookApplyOwnership(): Promise<void> {
  group("webhook: posse e ativação");
  resetMockDatabase();
  clearMockSession();

  // Posse INVÁLIDA: dono de C tentando aplicar na barbearia A → recusado.
  const invalid = await rpc("apply_subscription_from_webhook", subEvent({ _barbershop_id: A }));
  check("webhook com barbearia alheia é RECUSADO (posse)", invalid.error !== null, `err=${invalid.error?.message}`);

  // Pagamento aprovado: C (free) vira pro.
  const ok = await rpc("apply_subscription_from_webhook", subEvent({ _status: "active" }));
  check("webhook válido aplica sem erro", ok.error === null, `err=${ok.error?.message}`);

  await login(MOCK_ADMIN_C_EMAIL);
  const cSub = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: C }));
  check("C passou a ter assinatura active", cSub?.status === "active", `status=${cSub?.status}`);
  const cShop = getTableRows("barbershops").find((b) => b.id === C);
  const proPlan = getTableRows("plans").find((p) => p.name === "pro");
  check("plano de C virou pro (entitlement)", cShop?.plan_id === proPlan?.id);
}

async function testStatusTransitions(): Promise<void> {
  group("transições de status");
  resetMockDatabase();
  clearMockSession();

  // ativa
  await rpc("apply_subscription_from_webhook", subEvent({ _status: "active" }));
  // pagamento recusado → past_due (mantém plano)
  await rpc("apply_subscription_from_webhook", subEvent({ _status: "past_due" }));

  await login(MOCK_ADMIN_C_EMAIL);
  let cSub = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: C }));
  const proPlan = getTableRows("plans").find((p) => p.name === "pro");
  let cShop = getTableRows("barbershops").find((b) => b.id === C);
  check("pagamento recusado → status past_due", cSub?.status === "past_due", `status=${cSub?.status}`);
  check("past_due mantém o plano pro (período de graça)", cShop?.plan_id === proPlan?.id);

  // cancelamento programado
  clearMockSession();
  await rpc("apply_subscription_from_webhook", subEvent({ _status: "active", _cancel_at_period_end: true }));
  await login(MOCK_ADMIN_C_EMAIL);
  cSub = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: C }));
  check("cancelamento programado (active + cancel_at_period_end)", cSub?.status === "active" && cSub?.cancel_at_period_end === true);
}

async function testCancelDowngradeKeepsData(): Promise<void> {
  group("cancelamento e downgrade");
  resetMockDatabase();
  clearMockSession();

  // C ativa como pro, com dados existentes (serviços do seed).
  await rpc("apply_subscription_from_webhook", subEvent({ _status: "active" }));
  const servicesBefore = getTableRows("services").filter((s) => s.barbershop_id === C).length;

  // Cancelamento → volta para free.
  await rpc("apply_subscription_from_webhook", subEvent({ _status: "canceled", _plan_name: "free", _canceled_at: new Date().toISOString() }));

  const cShop = getTableRows("barbershops").find((b) => b.id === C);
  const freePlan = getTableRows("plans").find((p) => p.name === "free");
  check("cancelamento retorna C para o plano free", cShop?.plan_id === freePlan?.id);

  const servicesAfter = getTableRows("services").filter((s) => s.barbershop_id === C).length;
  check("downgrade PRESERVA os dados existentes (serviços)", servicesAfter === servicesBefore && servicesAfter > 0, `antes=${servicesBefore} depois=${servicesAfter}`);

  // Assinatura marcada como cancelada.
  await login(MOCK_ADMIN_C_EMAIL);
  const cSub = firstRow(await rpc("get_barbershop_subscription", { _barbershop_id: C }));
  check("assinatura de C fica canceled", cSub?.status === "canceled", `status=${cSub?.status}`);
}

async function testPlanLimitsAndFree(): Promise<void> {
  group("limites por plano");
  resetMockDatabase();
  clearMockSession();

  // C é free e está no limite (2 profissionais, limite 1; 50/50 agendamentos).
  await login(MOCK_ADMIN_C_EMAIL);
  const barberLimit = await rpc("check_barber_limit", { _barbershop_id: C });
  check("free no limite: check_barber_limit = false", barberLimit.data === false, `data=${barberLimit.data}`);
  const apptLimit = await rpc("check_appointment_limit", { _barbershop_id: C });
  check("free no limite: check_appointment_limit = false", apptLimit.data === false, `data=${apptLimit.data}`);

  // A é pro → ilimitado.
  await login(MOCK_ADMIN_EMAIL);
  const proBarber = await rpc("check_barber_limit", { _barbershop_id: A });
  check("pro: check_barber_limit = true (ilimitado)", proBarber.data === true);
}

async function testCheckoutHasNoFakeActivation(): Promise<void> {
  group("checkout não falsifica ativação");
  resetMockDatabase();
  clearMockSession();
  await login(MOCK_ADMIN_C_EMAIL);

  // Sem gateway real: as edge functions falham explicitamente (não há preço/URL falsos).
  const price = (await mockSupabaseClient.functions.invoke("get-paddle-price", {
    body: { priceId: "pro_monthly", environment: "sandbox" },
  })) as { error: unknown };
  check("get-paddle-price falha no offline (sem checkout falso)", price.error !== null);

  // Cliente não consegue inserir subscription direto (RLS/regra do mock).
  const direct = (await mockSupabaseClient
    .from("subscriptions")
    .insert({ user_id: MOCK_USER_IDS.adminCarlos, barbershop_id: C, paddle_subscription_id: "hack", paddle_customer_id: "x", product_id: "pro_plan", price_id: "pro_monthly", status: "active", environment: "sandbox" } as never)) as { error: unknown };
  check("cliente não grava subscription direto", direct.error !== null);
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface HarnessOutcome {
  passed: number;
  failed: number;
  report: string;
}

export async function runHarness(): Promise<HarnessOutcome> {
  const groups: Array<[string, () => Promise<void>]> = [
    ["leitura-isolamento", testReadAndIsolation],
    ["papeis", testRoleGuards],
    ["idempotencia", testWebhookIdempotency],
    ["posse-ativacao", testWebhookApplyOwnership],
    ["transicoes", testStatusTransitions],
    ["cancelamento-downgrade", testCancelDowngradeKeepsData],
    ["limites", testPlanLimitsAndFree],
    ["checkout", testCheckoutHasNoFakeActivation],
  ];

  for (const [name, fn] of groups) {
    try {
      await fn();
    } catch (err) {
      check(`grupo "${name}" executou sem exceção`, false, err instanceof Error ? err.message : String(err));
    }
  }

  const lines: string[] = [];
  let passed = 0;
  let failed = 0;
  let printedGroup = "";
  for (const item of checks) {
    if (item.group !== printedGroup) {
      lines.push(`\n▸ ${item.group}`);
      printedGroup = item.group;
    }
    if (item.ok) passed += 1;
    else failed += 1;
    const mark = item.ok ? "  ✓" : "  ✗";
    const detail = item.detail && !item.ok ? `  — ${item.detail}` : "";
    lines.push(`${mark} ${item.name}${detail}`);
  }
  lines.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  return { passed, failed, report: lines.join("\n") };
}
