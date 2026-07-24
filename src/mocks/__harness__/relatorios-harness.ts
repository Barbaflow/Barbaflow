/**
 * Harness automatizado dos relatórios de vendas do modo offline.
 *
 * Exercita a MESMA superfície do app (mockSupabaseClient.rpc) contra as RPCs
 * report_* — que espelham a migration 20260724120000_sales_reports_rpcs.sql.
 * Rodado por scripts/run-relatorios-harness.mjs (Vite SSR + localStorage em
 * memória). Não é framework de teste — é um script de verificação.
 *
 * Cenário determinístico (datas fixas, não depende de "hoje"): a barbearia A
 * tem 4 comandas FECHADAS no período, mais uma ABERTA, uma CANCELADA e uma
 * FORA do período — todas com valores conhecidos, para conferir os agregados
 * ao centavo. Fuso da barbearia A: America/Sao_Paulo (UTC−3).
 *
 * Cobre: período, timezone, exclusão de aberta/cancelada/fora-de-período,
 * descontos, ticket médio, serviços, produtos, barbeiros, pagamentos divididos,
 * isolamento entre tenants, cliente/anon sem acesso, super_admin, restrição do
 * barbeiro ao próprio resultado, valores zerados e consistência entre agregações.
 */
import { mockSupabaseClient } from "@/mocks/client";
import { getTableRows, resetMockDatabase, setTableRows, type MockRow } from "@/mocks/store";
import { clearMockSession } from "@/mocks/auth";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_ADMIN_B_EMAIL,
  MOCK_BARBERSHOP_B_ID,
  MOCK_BARBERSHOP_ID,
  MOCK_PRODUCT_IDS,
  MOCK_SERVICE_IDS,
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

function rows(result: RpcResult): Record<string, unknown>[] {
  return Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
}

function firstRow(result: RpcResult): Record<string, unknown> | null {
  return rows(result)[0] ?? null;
}

const approx = (a: unknown, b: number, tol = 0.005): boolean =>
  Math.abs(Number(a) - b) <= tol;

/* ------------------------------------------------------------------ */
/* Cenário determinístico                                              */
/* ------------------------------------------------------------------ */

const A = MOCK_BARBERSHOP_ID;
const B = MOCK_BARBERSHOP_B_ID;
const ANA = MOCK_USER_IDS.barberAna;
const BRUNO = MOCK_USER_IDS.barberBruno;
const BIANCA = MOCK_USER_IDS.barberBianca;

// Período: [Jul 10 00:00, Jul 12 00:00) no fuso America/Sao_Paulo (UTC−3).
const START = "2026-07-10T03:00:00.000Z";
const END = "2026-07-12T03:00:00.000Z";
// Período vazio (nenhuma venda): dezembro.
const EMPTY_START = "2026-12-01T03:00:00.000Z";
const EMPTY_END = "2026-12-02T03:00:00.000Z";

let seq = 0;
const id = (p: string): string => `${p}-rel-${(seq += 1).toString(16).padStart(4, "0")}`;

interface ItemSpec {
  type: "service" | "product";
  ref: string;
  desc: string;
  price: number;
  qty: number;
}
interface PaySpec {
  method: string;
  amount: number;
}
interface TicketSpec {
  bs: string;
  barber: string;
  status: "fechada" | "aberta" | "cancelada";
  closedAt: string | null;
  discount: number;
  items: ItemSpec[];
  pays: PaySpec[];
}

function buildScenario(specs: TicketSpec[]): void {
  const tickets: MockRow[] = [];
  const items: MockRow[] = [];
  const payments: MockRow[] = [];

  for (const s of specs) {
    const ticketId = id("tk");
    const subtotal = s.items.reduce((sum, it) => sum + it.price * it.qty, 0);
    const total = s.status === "fechada" ? Math.max(0, subtotal - s.discount) : subtotal;
    tickets.push({
      id: ticketId,
      barbershop_id: s.bs,
      barber_id: s.barber,
      appointment_id: null,
      client_id: null,
      opened_by: s.barber,
      closed_by: s.status === "fechada" ? s.barber : null,
      status: s.status,
      subtotal,
      discount_type: "fixed",
      discount_amount: s.discount,
      total,
      closed_at: s.closedAt,
      created_at: START,
      updated_at: START,
    });
    for (const it of s.items) {
      items.push({
        id: id("it"),
        ticket_id: ticketId,
        barbershop_id: s.bs,
        item_type: it.type,
        service_id: it.type === "service" ? it.ref : null,
        product_id: it.type === "product" ? it.ref : null,
        description: it.desc,
        unit_price: it.price,
        quantity: it.qty,
        total: it.price * it.qty,
        created_at: s.closedAt ?? START,
      });
    }
    for (const p of s.pays) {
      payments.push({
        id: id("pay"),
        ticket_id: ticketId,
        barbershop_id: s.bs,
        payment_method_id: null,
        method_name: p.method,
        amount: p.amount,
        created_at: s.closedAt ?? START,
      });
    }
  }

  setTableRows("tickets", tickets);
  setTableRows("ticket_items", items);
  setTableRows("ticket_payments", payments);
}

function seedScenario(): void {
  resetMockDatabase();
  clearMockSession();
  buildScenario([
    // ── Barbearia A: 4 fechadas no período ──
    // T1: Ana, Jul10 10:00 local — corte 100, sem desconto, pago em dinheiro.
    {
      bs: A, barber: ANA, status: "fechada", closedAt: "2026-07-10T13:00:00.000Z", discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.corte, desc: "Corte", price: 100, qty: 1 }],
      pays: [{ method: "Dinheiro", amount: 100 }],
    },
    // T2: Ana, Jul10 17:00 local — barba 50 + pomada 30, desconto 10 (total 70),
    //      PAGAMENTO DIVIDIDO Pix 40 + Dinheiro 30.
    {
      bs: A, barber: ANA, status: "fechada", closedAt: "2026-07-10T20:00:00.000Z", discount: 10,
      items: [
        { type: "service", ref: MOCK_SERVICE_IDS.barba, desc: "Barba", price: 50, qty: 1 },
        { type: "product", ref: MOCK_PRODUCT_IDS.pomadaA, desc: "Pomada", price: 30, qty: 1 },
      ],
      pays: [{ method: "Pix", amount: 40 }, { method: "Dinheiro", amount: 30 }],
    },
    // T3: Bruno, Jul11 09:00 local — combo 60, cartão.
    {
      bs: A, barber: BRUNO, status: "fechada", closedAt: "2026-07-11T12:00:00.000Z", discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.combo, desc: "Combo", price: 60, qty: 1 }],
      pays: [{ method: "Cartão", amount: 60 }],
    },
    // T8: Ana, FRONTEIRA DE FUSO — 02:30Z Jul11 = 23:30 local Jul10 → conta em Jul10.
    {
      bs: A, barber: ANA, status: "fechada", closedAt: "2026-07-11T02:30:00.000Z", discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.corte, desc: "Corte", price: 20, qty: 1 }],
      pays: [{ method: "Dinheiro", amount: 20 }],
    },
    // ── Excluídas ──
    // Aberta (não entra).
    {
      bs: A, barber: ANA, status: "aberta", closedAt: null, discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.corte, desc: "Corte", price: 999, qty: 1 }],
      pays: [],
    },
    // Cancelada (não entra).
    {
      bs: A, barber: BRUNO, status: "cancelada", closedAt: null, discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.corte, desc: "Corte", price: 999, qty: 1 }],
      pays: [],
    },
    // Fechada FORA do período (junho) — não entra em julho.
    {
      bs: A, barber: ANA, status: "fechada", closedAt: "2026-06-01T13:00:00.000Z", discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.corte, desc: "Corte", price: 500, qty: 1 }],
      pays: [{ method: "Dinheiro", amount: 500 }],
    },
    // ── Barbearia B: 1 fechada no período, SEM pagamento (divergência) ──
    {
      bs: B, barber: BIANCA, status: "fechada", closedAt: "2026-07-10T13:00:00.000Z", discount: 0,
      items: [{ type: "service", ref: MOCK_SERVICE_IDS.corteB, desc: "Corte B", price: 200, qty: 1 }],
      pays: [],
    },
  ]);
}

/* ------------------------------------------------------------------ */
/* Grupos de teste                                                     */
/* ------------------------------------------------------------------ */

async function testSummaryAndRules(): Promise<void> {
  group("resumo e regras financeiras");
  seedScenario();
  await login(MOCK_ADMIN_EMAIL);

  const sum = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: START, _end: END }));
  check("resumo retornou uma linha", sum !== null);
  if (!sum) return;

  check("bruto = Σ subtotais (260)", approx(sum.gross, 260), `bruto=${sum.gross}`);
  check("desconto = Σ descontos aplicados (10)", approx(sum.discount, 10), `desc=${sum.discount}`);
  check("líquido = Σ totais (250)", approx(sum.net, 250), `liq=${sum.net}`);
  check("bruto − desconto = líquido", approx(Number(sum.gross) - Number(sum.discount), Number(sum.net)));
  check("comandas fechadas = 4 (aberta/cancelada/fora excluídas)", Number(sum.closed_count) === 4, `n=${sum.closed_count}`);
  check("ticket médio = líquido/comandas (62,50)", approx(sum.avg_ticket, 62.5), `tm=${sum.avg_ticket}`);
  check("serviços vendidos = 4", Number(sum.services_count) === 4, `svc=${sum.services_count}`);
  check("produtos vendidos = 1", Number(sum.products_count) === 1, `prd=${sum.products_count}`);
}

async function testPeriodEmptyAndZeros(): Promise<void> {
  group("período vazio e zeros");
  seedScenario();
  await login(MOCK_ADMIN_EMAIL);

  const sum = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: EMPTY_START, _end: EMPTY_END }));
  check("período sem vendas retorna linha", sum !== null);
  check("líquido zero", approx(sum?.net, 0), `liq=${sum?.net}`);
  check("comandas zero", Number(sum?.closed_count) === 0);
  check("ticket médio 0 (sem divisão por zero)", approx(sum?.avg_ticket, 0));

  const svc = rows(await rpc("report_services", { _barbershop_id: A, _start: EMPTY_START, _end: EMPTY_END }));
  check("serviços vazios no período sem vendas", svc.length === 0);
}

async function testTimezoneAndTimeseries(): Promise<void> {
  group("timezone e evolução temporal");
  seedScenario();
  await login(MOCK_ADMIN_EMAIL);

  const series = rows(await rpc("report_sales_timeseries", { _barbershop_id: A, _start: START, _end: END }));
  const byDay = new Map(series.map((d) => [String(d.day), d]));

  check("dois dias com venda", series.length === 2, `dias=${series.map((d) => d.day).join(",")}`);
  // T8 fechou 02:30Z Jul11, mas 23:30 local Jul10 → deve cair em Jul10.
  check("fronteira de fuso: venda 02:30Z conta em Jul10", byDay.has("2026-07-10"));
  check("Jul10 tem 3 comandas (inclui a da fronteira)", Number(byDay.get("2026-07-10")?.closed_count) === 3, `n=${byDay.get("2026-07-10")?.closed_count}`);
  check("Jul10 líquido = 190", approx(byDay.get("2026-07-10")?.net, 190), `net=${byDay.get("2026-07-10")?.net}`);
  check("Jul11 tem 1 comanda", Number(byDay.get("2026-07-11")?.closed_count) === 1);
  check("Jul11 líquido = 60", approx(byDay.get("2026-07-11")?.net, 60));

  const totalNet = series.reduce((s, d) => s + Number(d.net), 0);
  const totalCount = series.reduce((s, d) => s + Number(d.closed_count), 0);
  check("Σ série diária = líquido do período (250)", approx(totalNet, 250), `Σ=${totalNet}`);
  check("Σ comandas/dia = comandas do período (4)", totalCount === 4);
}

async function testServicesAndProducts(): Promise<void> {
  group("serviços e produtos");
  seedScenario();
  await login(MOCK_ADMIN_EMAIL);

  const svc = rows(await rpc("report_services", { _barbershop_id: A, _start: START, _end: END }));
  const svcByName = new Map(svc.map((s) => [String(s.name), s]));
  check("corte agregou 2 vendas (snapshot, sem preço atual)", Number(svcByName.get("Corte")?.quantity) === 2, `q=${svcByName.get("Corte")?.quantity}`);
  check("corte receita = 120 (100+20)", approx(svcByName.get("Corte")?.revenue, 120), `r=${svcByName.get("Corte")?.revenue}`);
  check("ranking por receita: corte primeiro", String(svc[0]?.name) === "Corte", `1º=${svc[0]?.name}`);
  const svcRevenue = svc.reduce((s, r) => s + Number(r.revenue), 0);
  check("Σ receita de serviços = 230 (120+60+50)", approx(svcRevenue, 230), `Σ=${svcRevenue}`);

  const prd = rows(await rpc("report_products", { _barbershop_id: A, _start: START, _end: END }));
  check("um produto vendido (pomada)", prd.length === 1, `n=${prd.length}`);
  check("pomada receita = 30", approx(prd[0]?.revenue, 30));
  check("pomada qty = 1", Number(prd[0]?.quantity) === 1);
  check("pomada traz estoque atual (informativo)", prd[0]?.stock_quantity !== null && prd[0]?.stock_quantity !== undefined, `stock=${prd[0]?.stock_quantity}`);
}

async function testByBarber(): Promise<void> {
  group("profissionais");
  seedScenario();
  await login(MOCK_ADMIN_EMAIL);

  const barbers = rows(await rpc("report_by_barber", { _barbershop_id: A, _start: START, _end: END }));
  const byId = new Map(barbers.map((b) => [String(b.barber_id), b]));
  check("dois profissionais com venda", barbers.length === 2);
  check("Ana: 3 comandas", Number(byId.get(ANA)?.tickets_count) === 3, `n=${byId.get(ANA)?.tickets_count}`);
  check("Ana: líquido 190", approx(byId.get(ANA)?.net, 190), `net=${byId.get(ANA)?.net}`);
  check("Ana: 3 serviços", Number(byId.get(ANA)?.services_count) === 3);
  check("Bruno: líquido 60", approx(byId.get(BRUNO)?.net, 60));
  check("ranking por líquido: Ana primeiro", String(barbers[0]?.barber_id) === ANA);
  const netSum = barbers.reduce((s, b) => s + Number(b.net), 0);
  check("Σ líquido por barbeiro = líquido do período (250)", approx(netSum, 250), `Σ=${netSum}`);
}

async function testPayments(): Promise<void> {
  group("formas de pagamento");
  seedScenario();
  await login(MOCK_ADMIN_EMAIL);

  const pays = rows(await rpc("report_payment_methods", { _barbershop_id: A, _start: START, _end: END }));
  const byName = new Map(pays.map((p) => [String(p.method_name), p]));
  check("Dinheiro soma 150 (100+30+20)", approx(byName.get("Dinheiro")?.amount, 150), `d=${byName.get("Dinheiro")?.amount}`);
  check("Dinheiro em 3 comandas", Number(byName.get("Dinheiro")?.tickets_count) === 3);
  check("Pix soma 40 (parcela do split)", approx(byName.get("Pix")?.amount, 40));
  check("Pix em 1 comanda (split não duplica comanda)", Number(byName.get("Pix")?.tickets_count) === 1);
  check("Cartão soma 60", approx(byName.get("Cartão")?.amount, 60));

  const paidSum = pays.reduce((s, p) => s + Number(p.amount), 0);
  check("Σ pagamentos = líquido (250) quando pagamentos completos", approx(paidSum, 250), `Σ=${paidSum}`);

  // Barbearia B: comanda sem pagamento → divergência detectável.
  await login(MOCK_ADMIN_B_EMAIL);
  const sumB = firstRow(await rpc("report_sales_summary", { _barbershop_id: B, _start: START, _end: END }));
  const paysB = rows(await rpc("report_payment_methods", { _barbershop_id: B, _start: START, _end: END }));
  const paidB = paysB.reduce((s, p) => s + Number(p.amount), 0);
  check("B: divergência pagamentos(0) ≠ líquido(200) é detectável", !approx(paidB, Number(sumB?.net)), `pago=${paidB} liq=${sumB?.net}`);
}

async function testIsolationAndRoles(): Promise<void> {
  group("isolamento e papéis");
  seedScenario();

  // Admin A não vê B, e A ≠ B.
  await login(MOCK_ADMIN_EMAIL);
  const aSum = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: START, _end: END }));
  const adminAonB = await rpc("report_sales_summary", { _barbershop_id: B, _start: START, _end: END });
  check("admin A vê A (líquido 250)", approx(aSum?.net, 250));
  check("admin A é BARRADO em B (isolamento)", adminAonB.error?.code === "MOCK_FORBIDDEN", `err=${adminAonB.error?.code}`);

  // Admin B vê só B (líquido 200).
  await login(MOCK_ADMIN_B_EMAIL);
  const bSum = firstRow(await rpc("report_sales_summary", { _barbershop_id: B, _start: START, _end: END }));
  check("admin B vê B (líquido 200)", approx(bSum?.net, 200), `net=${bSum?.net}`);
  check("A (250) ≠ B (200): tenants isolados", !approx(aSum?.net, Number(bSum?.net)));

  // super_admin vê o tenant explicitamente selecionado.
  await login(MOCK_SUPER_ADMIN_EMAIL);
  const superOnB = firstRow(await rpc("report_sales_summary", { _barbershop_id: B, _start: START, _end: END }));
  check("super_admin vê B selecionado (200)", approx(superOnB?.net, 200));
  const superOnA = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: START, _end: END }));
  check("super_admin vê A selecionado (250)", approx(superOnA?.net, 250));

  // Cliente comum (Carla, cliente da barbearia A) é barrado.
  clearMockSession();
  await login("carla@cliente.teste");
  const clientRes = await rpc("report_sales_summary", { _barbershop_id: A, _start: START, _end: END });
  check("cliente comum é barrado", clientRes.error !== null, `err=${clientRes.error?.code}`);

  // Anônimo é barrado.
  clearMockSession();
  const anonRes = await rpc("report_sales_summary", { _barbershop_id: A, _start: START, _end: END });
  check("anônimo é barrado", anonRes.error !== null, `err=${anonRes.error?.code}`);
}

async function testBarberRestriction(): Promise<void> {
  group("barbeiro vê só os próprios resultados");
  seedScenario();

  // Ana (barbeira) — só as próprias comandas: T1,T2,T8 → líquido 190, 3 comandas.
  await login("ana@barbearia.teste");
  const anaSum = firstRow(await rpc("report_sales_summary", { _barbershop_id: A, _start: START, _end: END }));
  const loggedAsAna = anaSum !== null && Number(anaSum.closed_count) === 3;
  check("Ana logou como barbeira e recebeu resumo", anaSum !== null, `sum=${JSON.stringify(anaSum)}`);
  check("Ana vê só as próprias 3 comandas", Number(anaSum?.closed_count) === 3, `n=${anaSum?.closed_count}`);
  check("Ana: líquido próprio = 190 (não 250)", approx(anaSum?.net, 190), `net=${anaSum?.net}`);

  // Mesmo pedindo o relatório por barbeiro, só aparece ela mesma.
  const anaBarbers = rows(await rpc("report_by_barber", { _barbershop_id: A, _start: START, _end: END }));
  check("Ana no report_by_barber vê só a própria linha", loggedAsAna && anaBarbers.length === 1 && String(anaBarbers[0]?.barber_id) === ANA, `linhas=${anaBarbers.length}`);
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
    ["resumo", testSummaryAndRules],
    ["periodo-vazio", testPeriodEmptyAndZeros],
    ["timezone", testTimezoneAndTimeseries],
    ["servicos-produtos", testServicesAndProducts],
    ["profissionais", testByBarber],
    ["pagamentos", testPayments],
    ["isolamento", testIsolationAndRoles],
    ["barbeiro", testBarberRestriction],
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
