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
