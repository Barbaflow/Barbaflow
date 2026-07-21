/**
 * Harness automatizado do onboarding + planos/limites do modo offline.
 *
 * Exercita a MESMA superfície que o app usa (mockSupabaseClient), sem rede:
 * login, from(), rpc(), functions.invoke(). Rodado por
 * `scripts/run-plan-harness.mjs` (Vite SSR), que injeta um localStorage em
 * memória. Não é um teste de framework — é um script de verificação.
 *
 * Cobre: onboarding válido, onboarding repetido, vínculo inicial de admin,
 * slug inválido/duplicado, plano inexistente, limite de profissionais, limite
 * de agendamentos, plano ilimitado, alteração administrativa de plano,
 * histórico da mudança, usuário sem permissão, isolamento entre tenants e
 * ausência de checkout falso.
 */
import { mockSupabaseClient } from "@/mocks/client";
import { getTableRows, resetMockDatabase } from "@/mocks/store";
import { clearMockSession } from "@/mocks/auth";
import {
  MOCK_ADMIN_C_EMAIL,
  MOCK_ADMIN_D_EMAIL,
  MOCK_ADMIN_EMAIL,
  MOCK_ADMIN_B_EMAIL,
  MOCK_BARBERSHOP_C_ID,
  MOCK_BARBERSHOP_D_ID,
  MOCK_BARBERSHOP_E_ID,
  MOCK_BARBERSHOP_ID,
  MOCK_NO_BARBERSHOP_EMAIL,
  MOCK_PLAN_IDS,
  MOCK_SERVICE_IDS,
  MOCK_SUPER_ADMIN_EMAIL,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";
import { pickFutureFreeSlots } from "@/mocks/__harness__/slots";

/* ------------------------------------------------------------------ */
/* Infra de asserção                                                   */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

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

/** Resultado no formato do query builder / rpc do mock. */
interface MockResultLike {
  data: unknown;
  error: { message: string; code: string } | null;
}

function firstRow(result: MockResultLike): Row | null {
  const { data } = result;
  if (Array.isArray(data)) return (data[0] as Row) ?? null;
  return (data as Row) ?? null;
}

function rowsOf(result: MockResultLike): Row[] {
  const { data } = result;
  return Array.isArray(data) ? (data as Row[]) : data ? [data as Row] : [];
}

const PASSWORD = "qualquer-senha";

async function login(email: string): Promise<string> {
  const res = await mockSupabaseClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error || !res.data.session) {
    throw new Error(`Falha no login fictício: ${email} — ${res.error?.message ?? "sem sessão"}`);
  }
  return res.data.session.user.id;
}

/* ------------------------------------------------------------------ */
/* Grupos de teste                                                     */
/* ------------------------------------------------------------------ */

/** Barbearia criada pelo onboarding — compartilhada entre os testes do grupo. */
async function testOnboarding(): Promise<void> {
  group("onboarding");
  resetMockDatabase();
  clearMockSession();

  const userId = await login(MOCK_NO_BARBERSHOP_EMAIL);

  /* ---- estado inicial: sem barbearia ---- */
  const initialRoles = await mockSupabaseClient
    .from("user_roles")
    .select("*")
    .eq("user_id", userId);
  const initialOwned = await mockSupabaseClient
    .from("barbershops")
    .select("id")
    .eq("owner_id", userId);
  check(
    "usuário começa sem barbearia (sem papéis nem barbearia própria)",
    rowsOf(initialRoles).length === 0 && rowsOf(initialOwned).length === 0,
    `papéis=${rowsOf(initialRoles).length} próprias=${rowsOf(initialOwned).length}`,
  );

  /* ---- passo 1 do wizard: subdomínio disponível ---- */
  const slug = "barbearia-nova";
  const avail = await mockSupabaseClient
    .from("barbershops")
    .select("id")
    .eq("subdomain", slug)
    .maybeSingle();
  check("subdomínio livre antes de criar", firstRow(avail) === null);

  /* ---- passo final: cria a barbearia (owner = próprio usuário) ---- */
  const created = await mockSupabaseClient
    .from("barbershops")
    .insert({
      name: "Barbearia Nova (onboarding)",
      subdomain: slug,
      primary_color: "#123456",
      secondary_color: "#0A0A0A",
      owner_id: userId,
      cep: "20000-000",
      street: "Rua do Teste",
      number: "10",
      neighborhood: "Centro",
      city: "Niterói",
      state: "RJ",
    })
    .select()
    .single();

  const shop = firstRow(created);
  check("cria a barbearia sem erro", created.error === null && shop !== null, created.error?.message ?? "");

  const shopId = shop ? String(shop.id) : "";

  /* ---- plano inicial = free ---- */
  check(
    "plano inicial atribuído = free",
    shop?.plan_id === MOCK_PLAN_IDS.free,
    `plan_id=${String(shop?.plan_id)}`,
  );
  check("status inicial = approved (ativada automaticamente)", shop?.status === "approved");

  /* ---- vínculo admin_barbearia para o próprio usuário ---- */
  const roleRes = await mockSupabaseClient.from("user_roles").insert({
    user_id: userId,
    barbershop_id: shopId,
    role: "admin_barbearia",
  });
  check("cria o vínculo admin_barbearia sem erro", roleRes.error === null, roleRes.error?.message ?? "");

  const adminRole = await mockSupabaseClient
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .eq("barbershop_id", shopId)
    .eq("role", "admin_barbearia")
    .maybeSingle();
  check("vínculo admin_barbearia confirmado no banco", firstRow(adminRole) !== null);

  /* ---- persistência: a barbearia está no localStorage ---- */
  const persisted =
    typeof localStorage !== "undefined"
      ? String(localStorage.getItem("barbaflow.mock.db.v1") ?? "").includes(shopId)
      : getTableRows("barbershops").some((row) => row.id === shopId);
  check("barbearia persiste (sobrevive ao reload)", persisted);

  /* ---- slug duplicado é recusado ---- */
  const dup = await mockSupabaseClient
    .from("barbershops")
    .insert({ name: "Clone", subdomain: "modelo", owner_id: userId });
  check("slug duplicado recusado", dup.error !== null, dup.error?.message ?? "sem erro");

  /* ---- slug inválido (curto) recusado ---- */
  const short = await mockSupabaseClient
    .from("barbershops")
    .insert({ name: "Curto", subdomain: "ab", owner_id: userId });
  check("slug inválido (curto demais) recusado", short.error !== null, short.error?.message ?? "sem erro");

  /* ---- slug reservado recusado ---- */
  const reserved = await mockSupabaseClient
    .from("barbershops")
    .insert({ name: "Reservado", subdomain: "admin", owner_id: userId });
  check("slug reservado recusado", reserved.error !== null, reserved.error?.message ?? "sem erro");

  /* ---- não pode criar barbearia para OUTRO usuário ---- */
  const foreign = await mockSupabaseClient
    .from("barbershops")
    .insert({ name: "De outro", subdomain: "de-outro", owner_id: MOCK_USER_IDS.admin });
  check(
    "onboarding recusa criar barbearia para outro usuário",
    foreign.error !== null && foreign.error?.code === "MOCK_FORBIDDEN",
    foreign.error?.message ?? "sem erro",
  );

  /* ---- repetir onboarding para si mesmo é permitido (produto atual permite) ---- */
  const second = await mockSupabaseClient
    .from("barbershops")
    .insert({ name: "Segunda barbearia", subdomain: "segunda-nova", owner_id: userId })
    .select()
    .single();
  check(
    "repetir onboarding para o próprio usuário é permitido",
    second.error === null && firstRow(second) !== null,
    second.error?.message ?? "",
  );

  /* ---- limite de profissionais do plano free na barbearia recém-criada ---- */
  // A barbearia nasce free (1 profissional) e já tem o admin → adicionar um
  // segundo profissional é bloqueado na camada de escrita.
  const extraBarber = await mockSupabaseClient.from("user_roles").insert({
    user_id: MOCK_USER_IDS.clienteCarla,
    barbershop_id: shopId,
    role: "barbeiro",
  });
  check(
    "free: 2º profissional bloqueado na barbearia recém-criada",
    extraBarber.error !== null,
    extraBarber.error?.message ?? "sem erro",
  );
}

async function testLimits(): Promise<void> {
  group("limites de plano");
  resetMockDatabase();
  clearMockSession();

  /* ---- Barbearia C (free, no limite) ---- */
  await login(MOCK_ADMIN_C_EMAIL);

  const barberLimitC = await mockSupabaseClient.rpc("check_barber_limit", {
    _barbershop_id: MOCK_BARBERSHOP_C_ID,
  });
  check("check_barber_limit(C free) = false (no limite)", barberLimitC.data === false, String(barberLimitC.data));

  const addBarberC = await mockSupabaseClient.from("user_roles").insert({
    user_id: MOCK_USER_IDS.clienteCaio,
    barbershop_id: MOCK_BARBERSHOP_C_ID,
    role: "barbeiro",
  });
  check(
    "free: inclusão de profissional bloqueada (camada mock)",
    addBarberC.error !== null,
    addBarberC.error?.message ?? "sem erro",
  );

  const apptLimitC = await mockSupabaseClient.rpc("check_appointment_limit", {
    _barbershop_id: MOCK_BARBERSHOP_C_ID,
  });
  check("check_appointment_limit(C 50/50) = false", apptLimitC.data === false, String(apptLimitC.data));

  const bookC = await mockSupabaseClient.from("appointments").insert({
    barbershop_id: MOCK_BARBERSHOP_C_ID,
    barber_id: MOCK_USER_IDS.barberCaco,
    client_id: MOCK_USER_IDS.clienteCarla,
    service_id: MOCK_SERVICE_IDS.corteC,
    date: "2999-01-01",
    start_time: "10:00:00",
    end_time: "10:30:00",
    status: "scheduled",
  });
  check(
    "free no limite: novo agendamento bloqueado",
    bookC.error !== null && String(bookC.error?.message).includes("Limite de agendamentos"),
    bookC.error?.message ?? "sem erro",
  );

  /* ---- Barbearia A (pro, ilimitado) ---- */
  clearMockSession();
  await login(MOCK_ADMIN_EMAIL);

  const apptLimitA = await mockSupabaseClient.rpc("check_appointment_limit", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  });
  check("check_appointment_limit(A pro) = true (ilimitado)", apptLimitA.data === true, String(apptLimitA.data));

  const barberLimitA = await mockSupabaseClient.rpc("check_barber_limit", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  });
  check("check_barber_limit(A pro) = true (ilimitado)", barberLimitA.data === true, String(barberLimitA.data));

  // Agenda um slot livre real do Ana e confirma que o contador mensal sobe.
  // O slot é escolhido no FUTURO com margem (ver __harness__/slots.ts): a regra
  // "não agendar no passado" continua ativa, o harness é que não escolhe mais
  // um horário de hoje que já passou.
  const slotRes = await mockSupabaseClient
    .from("availability")
    .select("*")
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("barber_id", MOCK_USER_IDS.barberAna)
    .eq("status", "livre")
    .order("date")
    .order("start_time");
  const slot = pickFutureFreeSlots(rowsOf(slotRes), 1)[0];
  check("fixtures oferecem horário futuro para o teste de plano", slot !== undefined, "nenhum slot futuro");

  if (slot) {
    const before = firstRow(
      await mockSupabaseClient
        .from("barbershops")
        .select("appointments_this_month")
        .eq("id", MOCK_BARBERSHOP_ID)
        .single(),
    );
    const book = await mockSupabaseClient.from("appointments").insert({
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      client_id: MOCK_USER_IDS.clienteCarla,
      service_id: MOCK_SERVICE_IDS.corte,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      status: "scheduled",
    });
    check("pro ilimitado: agendamento aceito", book.error === null, book.error?.message ?? "");

    const after = firstRow(
      await mockSupabaseClient
        .from("barbershops")
        .select("appointments_this_month")
        .eq("id", MOCK_BARBERSHOP_ID)
        .single(),
    );
    check(
      "contador appointments_this_month incrementa no insert (trigger)",
      Number(after?.appointments_this_month) === Number(before?.appointments_this_month) + 1,
      `${String(before?.appointments_this_month)} -> ${String(after?.appointments_this_month)}`,
    );
  } else {
    check("pro ilimitado: slot livre encontrado", false, "nenhum slot livre no seed");
  }

  /* ---- Barbearia D (enterprise, ilimitado) ---- */
  clearMockSession();
  await login(MOCK_ADMIN_D_EMAIL); // Denise, dona/admin da D

  const barberLimitD = await mockSupabaseClient.rpc("check_barber_limit", {
    _barbershop_id: MOCK_BARBERSHOP_D_ID,
  });
  check("check_barber_limit(D enterprise) = true (ilimitado)", barberLimitD.data === true, String(barberLimitD.data));

  // Dona da D adiciona um profissional — enterprise não tem limite.
  const addBarberD = await mockSupabaseClient.from("user_roles").insert({
    user_id: MOCK_USER_IDS.clienteBento,
    barbershop_id: MOCK_BARBERSHOP_D_ID,
    role: "barbeiro",
  });
  check(
    "enterprise ilimitado: inclusão de profissional aceita",
    addBarberD.error === null,
    addBarberD.error?.message ?? "",
  );
}

async function testAdminPlanChange(): Promise<void> {
  group("mudança administrativa de plano");
  resetMockDatabase();
  clearMockSession();

  const ritaId = await login(MOCK_SUPER_ADMIN_EMAIL);

  const logsBefore = rowsOf(await mockSupabaseClient.from("plan_change_logs").select("*")).length;

  /* ---- muda o plano da C: free -> pro (fluxo do AdminDashboard) ---- */
  const upd = await mockSupabaseClient
    .from("barbershops")
    .update({ plan_id: MOCK_PLAN_IDS.pro })
    .eq("id", MOCK_BARBERSHOP_C_ID);
  check("super_admin altera plan_id da barbearia", upd.error === null, upd.error?.message ?? "");

  const logIns = await mockSupabaseClient.from("plan_change_logs").insert({
    barbershop_id: MOCK_BARBERSHOP_C_ID,
    old_plan_id: MOCK_PLAN_IDS.free,
    new_plan_id: MOCK_PLAN_IDS.pro,
    changed_by: ritaId,
  });
  check("super_admin registra plan_change_logs", logIns.error === null, logIns.error?.message ?? "");

  const cAfter = firstRow(
    await mockSupabaseClient.from("barbershops").select("plan_id").eq("id", MOCK_BARBERSHOP_C_ID).single(),
  );
  check("plano da C agora é pro", cAfter?.plan_id === MOCK_PLAN_IDS.pro, String(cAfter?.plan_id));

  const logsAfter = rowsOf(await mockSupabaseClient.from("plan_change_logs").select("*")).length;
  check("histórico registrou a mudança (+1)", logsAfter === logsBefore + 1, `${logsBefore} -> ${logsAfter}`);

  /* ---- aprova a barbearia E (pending -> approved) ---- */
  const approveE = await mockSupabaseClient
    .from("barbershops")
    .update({ status: "approved" })
    .eq("id", MOCK_BARBERSHOP_E_ID);
  check("super_admin aprova barbearia pendente", approveE.error === null, approveE.error?.message ?? "");

  /* ---- plano inexistente é recusado ---- */
  const badPlan = await mockSupabaseClient
    .from("barbershops")
    .update({ plan_id: "00000000-0000-4000-8000-deadbeef0000" })
    .eq("id", MOCK_BARBERSHOP_C_ID);
  check("plano inexistente recusado", badPlan.error !== null, badPlan.error?.message ?? "sem erro");
}

async function testPermissionsAndIsolation(): Promise<void> {
  group("permissões e isolamento");
  resetMockDatabase();
  clearMockSession();

  /* ---- admin_barbearia (Carlos) não muda plano/status ---- */
  await login(MOCK_ADMIN_C_EMAIL);

  const planByAdmin = await mockSupabaseClient
    .from("barbershops")
    .update({ plan_id: MOCK_PLAN_IDS.enterprise })
    .eq("id", MOCK_BARBERSHOP_C_ID);
  check(
    "admin_barbearia NÃO altera plan_id (própria barbearia)",
    planByAdmin.error !== null && planByAdmin.error?.code === "MOCK_FORBIDDEN",
    planByAdmin.error?.message ?? "sem erro",
  );

  const statusByAdmin = await mockSupabaseClient
    .from("barbershops")
    .update({ status: "rejected" })
    .eq("id", MOCK_BARBERSHOP_C_ID);
  check(
    "admin_barbearia NÃO altera status administrativo",
    statusByAdmin.error !== null && statusByAdmin.error?.code === "MOCK_FORBIDDEN",
    statusByAdmin.error?.message ?? "sem erro",
  );

  const logByAdmin = await mockSupabaseClient.from("plan_change_logs").insert({
    barbershop_id: MOCK_BARBERSHOP_C_ID,
    old_plan_id: MOCK_PLAN_IDS.free,
    new_plan_id: MOCK_PLAN_IDS.pro,
    changed_by: MOCK_USER_IDS.adminCarlos,
  });
  check(
    "admin_barbearia NÃO registra plan_change_logs",
    logByAdmin.error !== null && logByAdmin.error?.code === "MOCK_FORBIDDEN",
    logByAdmin.error?.message ?? "sem erro",
  );

  /* ---- admin de outra barbearia (Carlos) não toca na barbearia D ---- */
  const crossPlan = await mockSupabaseClient
    .from("barbershops")
    .update({ plan_id: MOCK_PLAN_IDS.free })
    .eq("id", MOCK_BARBERSHOP_D_ID);
  check(
    "isolamento: admin da C não altera a barbearia D",
    crossPlan.error !== null,
    crossPlan.error?.message ?? "sem erro",
  );

  /* ---- Beatriz (admin da B) não altera config da A e não lê limite da A ---- */
  clearMockSession();
  await login(MOCK_ADMIN_B_EMAIL);

  const crossConfig = await mockSupabaseClient
    .from("barbershops")
    .update({ name: "Invasão" })
    .eq("id", MOCK_BARBERSHOP_ID);
  check(
    "isolamento: admin da B não altera configurações da A",
    crossConfig.error !== null && crossConfig.error?.code === "MOCK_FORBIDDEN",
    crossConfig.error?.message ?? "sem erro",
  );

  const crossRpc = await mockSupabaseClient.rpc("check_barber_limit", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  });
  check(
    "isolamento: check_barber_limit(A) negado para staff da B",
    crossRpc.error !== null && crossRpc.error?.code === "MOCK_FORBIDDEN",
    crossRpc.error?.message ?? "sem erro",
  );
}

async function testSubscriptionsAndPaddle(): Promise<void> {
  group("assinaturas e Paddle");
  resetMockDatabase();
  clearMockSession();

  const alexId = await login(MOCK_ADMIN_EMAIL);

  const ownActive = await mockSupabaseClient.rpc("has_active_subscription", {
    user_uuid: alexId,
    check_env: "live",
  });
  check("has_active_subscription(própria, ativa) = true", ownActive.data === true, String(ownActive.data));

  const otherByNonAdmin = await mockSupabaseClient.rpc("has_active_subscription", {
    user_uuid: MOCK_USER_IDS.adminDenise,
    check_env: "live",
  });
  check(
    "has_active_subscription(de outro) = false para não super_admin",
    otherByNonAdmin.data === false,
    String(otherByNonAdmin.data),
  );

  /* ---- super_admin enxerga assinaturas de qualquer um ---- */
  clearMockSession();
  await login(MOCK_SUPER_ADMIN_EMAIL);

  const trialing = await mockSupabaseClient.rpc("has_active_subscription", {
    user_uuid: MOCK_USER_IDS.adminDenise,
    check_env: "live",
  });
  check("super_admin vê assinatura em teste (trialing) = true", trialing.data === true, String(trialing.data));

  const canceled = await mockSupabaseClient.rpc("has_active_subscription", {
    user_uuid: MOCK_USER_IDS.adminBeatriz,
    check_env: "live",
  });
  check("assinatura cancelada/expirada = false", canceled.data === false, String(canceled.data));

  /* ---- Paddle / Functions falham explicitamente, sem checkout falso ---- */
  const price = await mockSupabaseClient.functions.invoke("get-paddle-price", {
    body: { priceId: "pro_monthly", environment: "live" },
  });
  check(
    "get-paddle-price indisponível offline (sem priceId falso)",
    price.error !== null && price.data === null,
    price.error?.message ?? "sem erro",
  );

  const portal = await mockSupabaseClient.functions.invoke("create-portal-session", {
    body: { environment: "live" },
  });
  check(
    "create-portal-session indisponível offline (sem URL falsa)",
    portal.error !== null && portal.data === null,
    portal.error?.message ?? "sem erro",
  );

  /* ---- não é possível marcar assinatura como paga pelo cliente ---- */
  clearMockSession();
  await login(MOCK_ADMIN_EMAIL);
  const fakeSub = await mockSupabaseClient.from("subscriptions").insert({
    user_id: alexId,
    paddle_subscription_id: "fake",
    paddle_customer_id: "fake",
    product_id: "fake",
    price_id: "pro_monthly",
    status: "active",
    environment: "live",
  });
  check(
    "cliente NÃO grava assinatura (sem sucesso falso de cobrança)",
    fakeSub.error !== null && fakeSub.error?.code === "MOCK_FORBIDDEN",
    fakeSub.error?.message ?? "sem erro",
  );
}

async function testRestore(): Promise<void> {
  group("restaurar dados");
  resetMockDatabase();
  clearMockSession();

  const c = firstRow(
    await mockSupabaseClient.from("barbershops").select("plan_id").eq("id", MOCK_BARBERSHOP_C_ID).single(),
  );
  check("após restaurar: barbearia C volta ao plano free", c?.plan_id === MOCK_PLAN_IDS.free, String(c?.plan_id));

  const logs = rowsOf(await mockSupabaseClient.from("plan_change_logs").select("*")).length;
  check("após restaurar: histórico de plano volta ao seed (3)", logs === 3, `logs=${logs}`);
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
    ["onboarding", testOnboarding],
    ["limites", testLimits],
    ["mudanca-plano", testAdminPlanChange],
    ["permissoes", testPermissionsAndIsolation],
    ["assinaturas", testSubscriptionsAndPaddle],
    ["restaurar", testRestore],
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
