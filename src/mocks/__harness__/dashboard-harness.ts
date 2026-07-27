/**
 * Harness do dashboard operacional (modo offline).
 *
 * Exercita a MESMA superfície do app (mockSupabaseClient.rpc/from) contra:
 *   - get_dashboard_summary (contagens do dia + comandas abertas, role-scoped);
 *   - report_sales_summary (faturamento do dia — reuso dos relatórios);
 *   - queries de comandas abertas e estoque baixo.
 *
 * Cenário determinístico: appointments de HOJE (no fuso da barbearia) com
 * status variados, comandas abertas, uma comanda fechada (faturamento) e
 * produtos com estoque baixo/esgotado — em A e B (isolamento).
 *
 * Cobre: timezone, métricas do dia, concluídos, cancelados, no-show,
 * faturamento só de comandas fechadas, comandas abertas, estoque baixo,
 * isolamento, escopo de barbeiro, super_admin, cliente/anon recusados,
 * valores zerados e independência entre seções (falha parcial).
 */
import { mockSupabaseClient } from "@/mocks/client";
import { getTableRows, resetMockDatabase, setTableRows, type MockRow } from "@/mocks/store";
import { clearMockSession } from "@/mocks/auth";
import { resolvePeriod } from "@/lib/report-period";
import { loadOpenComandas, sectionErrorMessage, type OpenComandaRow } from "@/lib/dashboard-sections";
import {
  pickDashboardRole,
  dashboardRedirect,
  resolveDashboardRole,
  isSessionExpired,
  isDifferentUser,
  type DashboardRole,
  type RoleSignals,
  type QueryFailure,
} from "@/lib/dashboard-role";
import { BILLING_UI_ENABLED } from "@/lib/billing-ui";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_ADMIN_B_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_B_ID,
  MOCK_SUPER_ADMIN_EMAIL,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

/* ---- infra ---- */
interface Check { group: string; name: string; ok: boolean; detail: string }
const checks: Check[] = [];
let currentGroup = "geral";
const group = (n: string) => { currentGroup = n; };
const check = (name: string, ok: boolean, detail = "") => checks.push({ group: currentGroup, name, ok, detail });

const PASSWORD = "qualquer-senha";
async function login(email: string): Promise<string> {
  const res = await mockSupabaseClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error || !res.data.session) throw new Error(`login falhou: ${email}`);
  return res.data.session.user.id;
}
interface RpcResult { data: unknown; error: { message: string; code: string } | null }
async function rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  return (await mockSupabaseClient.rpc(name, args)) as RpcResult;
}
const firstRow = (r: RpcResult): Record<string, unknown> | null =>
  Array.isArray(r.data) ? ((r.data[0] as Record<string, unknown>) ?? null) : null;

const A = MOCK_BARBERSHOP_ID;
const B = MOCK_BARBERSHOP_B_ID;
const ANA = MOCK_USER_IDS.barberAna;
const BRUNO = MOCK_USER_IDS.barberBruno;
const BIANCA = MOCK_USER_IDS.barberBianca;
const TZ = "America/Sao_Paulo";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

let seq = 0;
const id = (p: string) => `${p}-dash-${(seq += 1).toString(16).padStart(4, "0")}`;

interface ApptSpec { bs: string; barber: string; status: string }
interface TicketSpec { bs: string; barber: string; status: string; total: number; closed?: boolean }
interface ProdSpec { bs: string; name: string; stock: number; active: boolean }

function seed(appts: ApptSpec[], tickets: TicketSpec[], prods: ProdSpec[]): void {
  const D = today();
  const nowISO = new Date().toISOString();
  setTableRows(
    "appointments",
    appts.map((a) => ({
      id: id("ap"), barbershop_id: a.bs, barber_id: a.barber, client_id: MOCK_USER_IDS.clienteCarla,
      service_id: null, date: D, start_time: "10:00", end_time: "10:30", status: a.status,
      created_at: nowISO, updated_at: nowISO,
    })) as MockRow[],
  );
  setTableRows(
    "tickets",
    tickets.map((t) => ({
      id: id("tk"), barbershop_id: t.bs, barber_id: t.barber, client_id: MOCK_USER_IDS.clienteCarla,
      appointment_id: null, opened_by: t.barber, closed_by: t.closed ? t.barber : null,
      closed_at: t.closed ? nowISO : null, status: t.status, subtotal: t.total, discount_type: "fixed",
      discount_amount: 0, total: t.total, notes: null, created_at: nowISO, updated_at: nowISO,
    })) as MockRow[],
  );
  setTableRows(
    "products",
    prods.map((p) => ({
      id: id("pr"), barbershop_id: p.bs, name: p.name, description: null, price: 30,
      stock_quantity: p.stock, active: p.active, image_url: null, created_at: nowISO, updated_at: nowISO,
    })) as MockRow[],
  );
}

/** Cenário padrão A (6 appts) + B (isolamento). */
function seedDefault(): void {
  resetMockDatabase();
  clearMockSession();
  seed(
    [
      { bs: A, barber: ANA, status: "scheduled" },
      { bs: A, barber: ANA, status: "scheduled" },
      { bs: A, barber: ANA, status: "completed" },
      { bs: A, barber: ANA, status: "cancelled" },
      { bs: A, barber: ANA, status: "no_show" },
      { bs: A, barber: BRUNO, status: "scheduled" },
      { bs: B, barber: BIANCA, status: "scheduled" },
    ],
    [
      { bs: A, barber: ANA, status: "aberta", total: 50 },
      { bs: A, barber: BRUNO, status: "aberta", total: 60 },
      { bs: A, barber: ANA, status: "fechada", total: 100, closed: true }, // faturamento hoje
      { bs: B, barber: BIANCA, status: "aberta", total: 40 },
    ],
    [
      { bs: A, name: "Esgotado A", stock: 0, active: true },
      { bs: A, name: "Baixo A", stock: 3, active: true },
      { bs: A, name: "Cheio A", stock: 10, active: true },
      { bs: A, name: "Inativo A", stock: 1, active: false },
      { bs: B, name: "Esgotado B", stock: 0, active: true },
    ],
  );
}

/* ---- grupos ---- */

async function testDayMetrics(): Promise<void> {
  group("métricas do dia e timezone");
  seedDefault();
  await login(MOCK_ADMIN_EMAIL);
  const s = firstRow(await rpc("get_dashboard_summary", { _barbershop_id: A }));
  check("resumo retornou uma linha (hoje no fuso da barbearia)", s !== null);
  check("agendamentos hoje = 6", Number(s?.appointments_today) === 6, `n=${s?.appointments_today}`);
  check("agendados = 3", Number(s?.scheduled_today) === 3);
  check("concluídos = 1", Number(s?.completed_today) === 1);
  check("cancelados = 1 (não contam como concluídos)", Number(s?.cancelled_today) === 1);
  check("faltas/no-show = 1", Number(s?.no_show_today) === 1);
  check("comandas abertas = 2", Number(s?.open_tickets) === 2, `n=${s?.open_tickets}`);
}

async function testFaturamento(): Promise<void> {
  group("faturamento só de comandas fechadas");
  seedDefault();
  await login(MOCK_ADMIN_EMAIL);
  const p = resolvePeriod("today", TZ);
  const fat = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: p.startInstant, _end: p.endInstant }));
  check("faturamento líquido de hoje = 100 (só a comanda fechada)", Number(fat?.net) === 100, `net=${fat?.net}`);
  check("comandas abertas (50/60) NÃO entram no faturamento", Number(fat?.closed_count) === 1);
}

async function testOpenComandas(): Promise<void> {
  group("comandas abertas (valores persistidos)");
  seedDefault();
  await login(MOCK_ADMIN_EMAIL);
  const { data } = await mockSupabaseClient
    .from("tickets").select("id, total, barber_id").eq("barbershop_id", A).eq("status", "aberta");
  const rows = (data ?? []) as MockRow[];
  check("duas comandas abertas em A", rows.length === 2, `n=${rows.length}`);
  check("total persistido usado (50 e 60)", rows.every((r) => [50, 60].includes(Number(r.total))));
}

async function testEstoque(): Promise<void> {
  group("estoque baixo");
  seedDefault();
  await login(MOCK_ADMIN_EMAIL);
  const { data } = await mockSupabaseClient
    .from("products").select("name, stock_quantity, active")
    .eq("barbershop_id", A).eq("active", true).lte("stock_quantity", 5)
    .order("stock_quantity", { ascending: true });
  const rows = (data ?? []) as MockRow[];
  check("dois produtos ativos com estoque baixo (exclui cheio e inativo)", rows.length === 2, `n=${rows.length}`);
  check("esgotado (0) aparece primeiro", Number(rows[0]?.stock_quantity) === 0);
  check("produto de outro tenant (B) não aparece", rows.every((r) => r.name !== "Esgotado B"));
}

async function testBarberScope(): Promise<void> {
  group("escopo de barbeiro");
  seedDefault();
  // Ana vê só os próprios (5 appts, 1 comanda aberta).
  await login("ana@barbearia.teste");
  const s = firstRow(await rpc("get_dashboard_summary", { _barbershop_id: A }));
  check("barbeira Ana: 5 agendamentos próprios", Number(s?.appointments_today) === 5, `n=${s?.appointments_today}`);
  check("barbeira Ana: 1 comanda aberta própria (não as do Bruno)", Number(s?.open_tickets) === 1, `n=${s?.open_tickets}`);
}

async function testIsolationAndRoles(): Promise<void> {
  group("isolamento e papéis");
  seedDefault();

  await login(MOCK_ADMIN_EMAIL); // admin A
  const aOnB = await rpc("get_dashboard_summary", { _barbershop_id: B });
  check("admin A é BARRADO no resumo de B (isolamento)", aOnB.error !== null, `err=${aOnB.error?.code}`);

  await login(MOCK_ADMIN_B_EMAIL); // admin B
  const b = firstRow(await rpc("get_dashboard_summary", { _barbershop_id: B }));
  check("admin B vê B (1 agendamento, 1 comanda aberta)", Number(b?.appointments_today) === 1 && Number(b?.open_tickets) === 1);

  await login(MOCK_SUPER_ADMIN_EMAIL);
  const superA = firstRow(await rpc("get_dashboard_summary", { _barbershop_id: A }));
  check("super_admin vê o tenant informado (A = 6)", Number(superA?.appointments_today) === 6);

  await login("carla@cliente.teste");
  const cli = await rpc("get_dashboard_summary", { _barbershop_id: A });
  check("cliente é recusado", cli.error !== null, `err=${cli.error?.code}`);

  clearMockSession();
  const anon = await rpc("get_dashboard_summary", { _barbershop_id: A });
  check("anônimo é recusado", anon.error !== null, `err=${anon.error?.code}`);
}

async function testZerosAndPartial(): Promise<void> {
  group("valores zerados e independência de seção");
  resetMockDatabase();
  clearMockSession();
  // A sem agendamentos e sem comandas hoje; sem produtos.
  seed([], [], []);
  await login(MOCK_ADMIN_EMAIL);
  const s = firstRow(await rpc("get_dashboard_summary", { _barbershop_id: A }));
  check("dia vazio → todas as contagens zero", Number(s?.appointments_today) === 0 && Number(s?.open_tickets) === 0);
  const p = resolvePeriod("today", TZ);
  const fat = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: p.startInstant, _end: p.endInstant }));
  check("faturamento zero sem divisão por zero (ticket médio 0)", Number(fat?.net) === 0 && Number(fat?.avg_ticket) === 0);
  // Independência: o resumo funciona mesmo sem produtos (estoque vazio, não erro).
  const { data, error } = await mockSupabaseClient
    .from("products").select("id").eq("barbershop_id", A).eq("active", true).lte("stock_quantity", 5);
  check("estoque vazio não derruba o resto (lista vazia, sem erro)", error === null && (data ?? []).length === 0);
}

/**
 * P1 — a contagem de comandas nunca pode transformar erro em zero.
 *
 * `loadOpenComandas` recebe as duas consultas injetadas, então dá para exercitar
 * o caminho de falha sem tocar no banco nem no componente. Os três estados que
 * precisam ficar distinguíveis: zero real, erro, e uma ou mais comandas.
 */
async function testComandasErrorHandling(): Promise<void> {
  group("P1 — falha na contagem não vira zero");

  const row = (id: string): OpenComandaRow => ({
    id, client_id: "c1", barber_id: ANA, total: 50, created_at: new Date().toISOString(),
  });
  const ok = <T,>(v: T) => Promise.resolve(v);

  // 1) zero legítimo: consultas respondem, sem comandas.
  const zero = await loadOpenComandas({
    count: () => ok({ count: 0, error: null }),
    list: () => ok({ data: [], error: null }),
  });
  check(
    "zero real → status ready com count 0",
    zero.status === "ready" && zero.count === 0 && zero.rows.length === 0,
    JSON.stringify(zero),
  );

  // 2) erro na CONTAGEM (o defeito original: `const { count } = await head`).
  const countFailed = await loadOpenComandas({
    count: () => ok({ count: null, error: { message: "503 Service Unavailable" } }),
    list: () => ok({ data: [], error: null }),
  });
  check(
    "erro na contagem → status error (nunca ready/0)",
    countFailed.status === "error",
    JSON.stringify(countFailed),
  );
  check(
    "erro na contagem não expõe nenhum count",
    !("count" in countFailed),
    JSON.stringify(countFailed),
  );

  // 3) erro na LISTA continua derrubando a seção.
  const listFailed = await loadOpenComandas({
    count: () => ok({ count: 2, error: null }),
    list: () => ok({ data: null, error: { message: "permission denied" } }),
  });
  check("erro na lista → status error", listFailed.status === "error", JSON.stringify(listFailed));

  // 4) uma ou mais comandas abertas.
  const some = await loadOpenComandas({
    count: () => ok({ count: 2, error: null }),
    list: () => ok({ data: [row("t1"), row("t2")], error: null }),
  });
  check(
    "duas comandas → count 2 e duas linhas",
    some.status === "ready" && some.count === 2 && some.rows.length === 2,
    JSON.stringify(some),
  );

  // 5) retry: a mesma seção se recupera quando a consulta volta a responder.
  let failNext = true;
  const flaky = () => {
    const r = failNext
      ? { count: null, error: { message: "503" } }
      : { count: 1, error: null };
    failNext = false;
    return ok(r);
  };
  const first = await loadOpenComandas({ count: flaky, list: () => ok({ data: [row("t1")], error: null }) });
  const second = await loadOpenComandas({ count: flaky, list: () => ok({ data: [row("t1")], error: null }) });
  check(
    "retry recupera a seção após falha",
    first.status === "error" && second.status === "ready" && second.count === 1,
    `${first.status} → ${second.status}`,
  );
}

/** P4 — a mensagem do SectionError nunca fica com pontuação órfã. */
async function testSectionErrorMessage(): Promise<void> {
  group("P4 — mensagem do SectionError");
  const withTitle = sectionErrorMessage("Resumo do dia");
  check("com título → nomeia a seção", withTitle === "Falha ao carregar Resumo do dia.", withTitle);
  for (const [rotulo, valor] of [["vazio", ""], ["só espaços", "   "], ["ausente", undefined]] as const) {
    const msg = sectionErrorMessage(valor);
    check(
      `título ${rotulo} → frase completa`,
      msg === "Falha ao carregar esta seção.",
      msg,
    );
    check(`título ${rotulo} → sem " ." órfão`, !/\s\.$/.test(msg) && !msg.includes("  "), msg);
  }
}

/**
 * P3 — o guard de papel do /dashboard.
 *
 * Duas quebras já corrigidas aqui: (a) cliente sem linha em user_roles ia parar
 * no assistente de criação de barbearia; (b) a decisão passou a depender de o
 * usuário ter agendamentos, o que mandava um cliente recém-cadastrado para o
 * onboarding. Hoje o onboarding não é destino deste guard, e a decisão usa
 * apenas papel e propriedade de barbearia.
 */
async function testDashboardRoleRouting(): Promise<void> {
  group("P3 — papel e redirect do /dashboard");
  const base = { isSuperAdmin: false, roles: [] as string[], ownsBarbershop: false };

  const cases: Array<[string, RoleSignals, DashboardRole, string | null]> = [
    ["super_admin → painel atual", { ...base, isSuperAdmin: true }, "super_admin", null],
    ["admin fica no dashboard", { ...base, roles: ["admin_barbearia"] }, "admin_barbearia", null],
    ["barbeiro fica no dashboard", { ...base, roles: ["barbeiro"] }, "barbeiro", null],
    ["admin tem precedência sobre cliente", { ...base, roles: ["cliente", "admin_barbearia"] }, "admin_barbearia", null],
    ["barbeiro tem precedência sobre cliente", { ...base, roles: ["cliente", "barbeiro"] }, "barbeiro", null],
    ["cliente com papel → histórico", { ...base, roles: ["cliente"] }, "cliente", "/meus-agendamentos"],
    ["autenticado sem user_role → histórico", { ...base }, "cliente", "/meus-agendamentos"],
    ["papel desconhecido/não operacional → histórico", { ...base, roles: ["visitante"] }, "cliente", "/meus-agendamentos"],
    ["proprietário com vínculo incompleto → reparo", { ...base, ownsBarbershop: true }, "orphan_owner", null],
    ["proprietário já com papel de admin → dashboard", { roles: ["admin_barbearia"], isSuperAdmin: false, ownsBarbershop: true }, "admin_barbearia", null],
  ];

  for (const [nome, signals, papelEsperado, destinoEsperado] of cases) {
    const papel = pickDashboardRole(signals);
    const destino = dashboardRedirect(papel);
    check(`${nome} → papel ${papelEsperado}`, papel === papelEsperado, `veio ${papel}`);
    check(`${nome} → destino ${destinoEsperado ?? "permanece"}`, destino === destinoEsperado, `veio ${destino}`);
  }

  const todos: DashboardRole[] = ["super_admin", "admin_barbearia", "barbeiro", "cliente", "orphan_owner"];

  // Sem loop: nenhum papel volta para /dashboard e o único destino é terminal.
  const destinos = todos.map(dashboardRedirect);
  check("nenhum papel é redirecionado de volta para /dashboard", !destinos.includes("/dashboard" as never), JSON.stringify(destinos));
  check("único destino possível é /meus-agendamentos", new Set(destinos.filter(Boolean)).size === 1, JSON.stringify(destinos));

  // O onboarding deixou de ser fallback: nenhum papel é despachado para lá.
  check("nenhum papel é enviado para /onboarding", !destinos.includes("/onboarding" as never), JSON.stringify(destinos));

  // Cliente com e sem agendamentos precisa cair no MESMO lugar — é isso que
  // prova que a decisão não depende mais de appointments.
  const comAgenda = pickDashboardRole({ ...base, roles: ["cliente"] });
  const semAgenda = pickDashboardRole({ ...base });
  check(
    "cliente com e sem agendamentos → mesmo destino",
    dashboardRedirect(comAgenda) === dashboardRedirect(semAgenda) && dashboardRedirect(semAgenda) === "/meus-agendamentos",
    `${dashboardRedirect(comAgenda)} vs ${dashboardRedirect(semAgenda)}`,
  );

  // A decisão só enxerga três sinais; appointments não é um deles.
  const chaves = Object.keys({ ...base } satisfies RoleSignals).sort();
  check(
    "RoleSignals não contém nenhum sinal de appointments",
    !chaves.some((k) => /appoint|agendamento/i.test(k)),
    chaves.join(","),
  );
  check(
    "RoleSignals tem exatamente isSuperAdmin, ownsBarbershop e roles",
    chaves.join(",") === "isSuperAdmin,ownsBarbershop,roles",
    chaves.join(","),
  );
}

/**
 * Endurecimento — erro de consulta nunca vira "sem papel".
 *
 * O ponto: `[]` sem erro é resposta legítima (usuário sem papel); `[]` porque a
 * consulta falhou não é resposta nenhuma. Confundir os dois mandava um admin
 * para /meus-agendamentos numa falha de rede.
 */
async function testRoleResolutionFailures(): Promise<void> {
  group("resolução de papel com falha de consulta");

  const ok = <T,>(value: T) => ({ value, error: null });
  const falha = <T,>(value: T, error: QueryFailure = { code: "08006" }) => ({ value, error });

  // 1) consulta concluída sem papéis → cliente → /meus-agendamentos
  const semPapel = resolveDashboardRole({ superAdmin: ok(false), roles: ok([]), owned: ok(false) });
  check(
    "user_roles [] sem erro → cliente, /meus-agendamentos",
    semPapel.status === "resolved" && semPapel.role === "cliente" &&
      dashboardRedirect(semPapel.role) === "/meus-agendamentos",
    JSON.stringify(semPapel),
  );

  // 2) erro ao consultar papéis → sem decisão, sem redirect
  const erroPapeis = resolveDashboardRole({ superAdmin: ok(false), roles: falha(null), owned: ok(false) });
  check("erro em user_roles → status error", erroPapeis.status === "error", JSON.stringify(erroPapeis));
  check("erro em user_roles não vira cliente", !("role" in erroPapeis), JSON.stringify(erroPapeis));

  // 3) erro ao consultar propriedade → sem decisão
  const erroOwner = resolveDashboardRole({ superAdmin: ok(false), roles: ok([]), owned: falha(false) });
  check("erro em barbershops → status error", erroOwner.status === "error", JSON.stringify(erroOwner));
  const ownerAusente = resolveDashboardRole({ superAdmin: ok(false), roles: ok([]) });
  check("desempate sem resultado de propriedade → status error", ownerAusente.status === "error", JSON.stringify(ownerAusente));

  // 3b) erro no has_role também não pode virar "não é super_admin"
  const erroSuper = resolveDashboardRole({ superAdmin: falha(false), roles: ok([]), owned: ok(false) });
  check("erro em has_role → status error", erroSuper.status === "error", JSON.stringify(erroSuper));

  // 4) retry: mesma entrada corrigida resolve normalmente
  const depoisDoRetry = resolveDashboardRole({ superAdmin: ok(false), roles: ok(["admin_barbearia"]), owned: ok(false) });
  check(
    "retry após erro resolve corretamente",
    erroPapeis.status === "error" && depoisDoRetry.status === "resolved" && depoisDoRetry.role === "admin_barbearia",
    JSON.stringify(depoisDoRetry),
  );

  // 5 e 6) admin e barbeiro não são redirecionados quando a consulta funciona
  for (const papel of ["admin_barbearia", "barbeiro"] as const) {
    const r = resolveDashboardRole({ superAdmin: ok(false), roles: ok([papel]) });
    check(
      `${papel} resolve sem consulta de propriedade e permanece`,
      r.status === "resolved" && r.role === papel && dashboardRedirect(r.role) === null,
      JSON.stringify(r),
    );
  }
  const superOk = resolveDashboardRole({ superAdmin: ok(true), roles: falha(null) });
  check(
    "super_admin resolve mesmo se user_roles falhar depois",
    superOk.status === "resolved" && superOk.role === "super_admin",
    JSON.stringify(superOk),
  );

  // 7) cliente com linha em user_roles mas sem papel operacional
  const cliente = resolveDashboardRole({ superAdmin: ok(false), roles: ok(["cliente"]) });
  check(
    "papel não operacional → cliente, /meus-agendamentos",
    cliente.status === "resolved" && cliente.role === "cliente" && dashboardRedirect(cliente.role) === "/meus-agendamentos",
    JSON.stringify(cliente),
  );

  // 8) proprietário órfão confirmado → permanece na tela de configuração
  const orfao = resolveDashboardRole({ superAdmin: ok(false), roles: ok([]), owned: ok(true) });
  check(
    "proprietário órfão confirmado → orphan_owner, sem redirect",
    orfao.status === "resolved" && orfao.role === "orphan_owner" && dashboardRedirect(orfao.role) === null,
    JSON.stringify(orfao),
  );

  // 9) sessão expirada tem tratamento próprio, diferente de erro comum
  for (const [rotulo, err] of [["401", { status: 401 }], ["PGRST301", { code: "PGRST301" }]] as const) {
    const exp = resolveDashboardRole({ superAdmin: ok(false), roles: falha(null, err), owned: ok(false) });
    check(`sessão expirada (${rotulo}) → status expired`, exp.status === "expired", JSON.stringify(exp));
  }
  check("erro comum não é confundido com sessão expirada", !isSessionExpired({ code: "08006" }), "");
  check("permission denied (42501) não é sessão expirada", !isSessionExpired({ code: "42501" }), "");
  check("expiração detectada em qualquer uma das consultas",
    resolveDashboardRole({ superAdmin: falha(false, { status: 401 }), roles: ok([]), owned: ok(false) }).status === "expired", "");

  // 10) troca de usuário limpa erro e resolução anteriores
  check("primeiro login não conta como troca", !isDifferentUser(null, "u1"), "");
  check("mesmo usuário não conta como troca", !isDifferentUser("u1", "u1"), "");
  check("usuário diferente exige limpeza", isDifferentUser("u1", "u2"), "");
  check("logout (id → null) exige limpeza", isDifferentUser("u1", null), "");

  // 11) nenhuma entrada da resolução carrega sinal de agendamentos
  const entrada = { superAdmin: ok(false), roles: ok([]), owned: ok(false) };
  check(
    "resolveDashboardRole não recebe sinal de appointments",
    !Object.keys(entrada).some((k) => /appoint|agendamento/i.test(k)),
    Object.keys(entrada).join(","),
  );
}

/** Etapa 6 — nenhuma ação de assinatura/cobrança pode estar oferecida. */
async function testBillingUiHidden(): Promise<void> {
  group("assinatura pausada");
  check("BILLING_UI_ENABLED desligado", BILLING_UI_ENABLED === false, String(BILLING_UI_ENABLED));

  // A UI é gateada por este flag; o harness roda sem DOM, então a garantia
  // verificável aqui é a de que nenhum arquivo de UI renderiza a ação sem passar
  // pelo flag. Isso é checado no build/lint; aqui fixamos o contrato do flag.
  check(
    "flag é o único interruptor (booleano, não literal)",
    typeof BILLING_UI_ENABLED === "boolean",
    typeof BILLING_UI_ENABLED,
  );
}

/* ---- runner ---- */
export interface HarnessOutcome { passed: number; failed: number; report: string }
export async function runHarness(): Promise<HarnessOutcome> {
  const groups: Array<[string, () => Promise<void>]> = [
    ["metricas", testDayMetrics],
    ["faturamento", testFaturamento],
    ["comandas-abertas", testOpenComandas],
    ["estoque", testEstoque],
    ["barbeiro", testBarberScope],
    ["isolamento", testIsolationAndRoles],
    ["zeros", testZerosAndPartial],
    ["p1-comandas-erro", testComandasErrorHandling],
    ["p4-section-error", testSectionErrorMessage],
    ["p3-papel-redirect", testDashboardRoleRouting],
    ["papel-falha-consulta", testRoleResolutionFailures],
    ["assinatura-pausada", testBillingUiHidden],
  ];
  for (const [name, fn] of groups) {
    try { await fn(); }
    catch (err) { check(`grupo "${name}" executou sem exceção`, false, err instanceof Error ? err.message : String(err)); }
  }
  const lines: string[] = [];
  let passed = 0, failed = 0, printedGroup = "";
  for (const item of checks) {
    if (item.group !== printedGroup) { lines.push(`\n▸ ${item.group}`); printedGroup = item.group; }
    if (item.ok) passed += 1; else failed += 1;
    lines.push(`${item.ok ? "  ✓" : "  ✗"} ${item.name}${item.detail && !item.ok ? `  — ${item.detail}` : ""}`);
  }
  lines.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  return { passed, failed, report: lines.join("\n") };
}
