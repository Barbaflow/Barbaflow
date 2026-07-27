/**
 * Harness de comandas contra o Postgres LOCAL de verdade: ciclo de vida
 * (abrir/itens/fechar/cancelar), isolamento entre tenants, estoque no
 * fechamento e concorrência na última unidade.
 *
 *   npx supabase start
 *   npx supabase db reset --local --no-seed
 *   node scripts/run-comandas-harness.mjs
 *
 * Como o de concorrência da agenda: a parte de papéis assume cada usuário via
 * `SET LOCAL ROLE authenticated` + claims de JWT (RLS de fato aplicada); a
 * corrida usa DUAS conexões simultâneas para provar que a atomicidade vem do
 * banco (FOR UPDATE em close_ticket), não do React.
 */
import { spawn } from "node:child_process";
import { pularPorFaltaDeBanco } from "./harness-db-skip.mjs";

const CONTAINER = "supabase_db_barbaflow";

/* ---------------------------- asserções ---------------------------- */
const checks = [];
let currentGroup = "geral";
const group = (name) => (currentGroup = name);
const check = (name, ok, detail = "") => checks.push({ group: currentGroup, name, ok, detail });

/* ------------------------------ psql ------------------------------- */
function psql(sql) {
  return new Promise((resolve) => {
    const p = spawn("docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", () => resolve({ code: -1, out: "docker indisponível" }));
    p.on("close", (code) => resolve({ code: code ?? -1, out }));
    p.stdin.end(sql);
  });
}
/** Roda como usuário autenticado. commit=true persiste; senão descarta (só leitura/deny). */
function como(userId, sql, commit = false) {
  return psql(
    `BEGIN;\nSET LOCAL ROLE authenticated;\nSET LOCAL request.jwt.claims TO '{"sub":"${userId}","role":"authenticated"}';\n${sql}\n${commit ? "COMMIT;" : "ROLLBACK;"}`,
  );
}
const comoAnon = (sql) => psql(`BEGIN; SET LOCAL ROLE anon;\n${sql}\nROLLBACK;`);

const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const num = (out, n) => new RegExp(`\\n\\s*${n}\\s*\\n`).test(out);

/* ---------------------------- fixtures ----------------------------- */
const BS_A = "aaaaaaaa-0000-4000-8000-0000000c0001";
const BS_B = "aaaaaaaa-0000-4000-8000-0000000c0002";
const SENT = "00000000-0000-0000-0000-000000000000";
const ADMIN_A = "eeeeeeee-0000-4000-8000-0000000c0001";
const ADMIN_B = "eeeeeeee-0000-4000-8000-0000000c0002";
const SUPER = "eeeeeeee-0000-4000-8000-0000000c0003";
const CLIENT = "dddddddd-0000-4000-8000-0000000c0001";
const BARBER_A = "cccccccc-0000-4000-8000-0000000c0001";
const SVC_A = "bbbbbbbb-0000-4000-8000-0000000c0001";
const SVC_B = "bbbbbbbb-0000-4000-8000-0000000c0002";
const PRD_A = "ffffffff-0000-4000-8000-0000000c0001"; // estoque 5
const PRD_LOW = "ffffffff-0000-4000-8000-0000000c0002"; // estoque 1
const PRD_B = "ffffffff-0000-4000-8000-0000000c0003"; // tenant B
const APPT_A = "99999999-0000-4000-8000-0000000c0001";

const ALL_USERS = [ADMIN_A, ADMIN_B, SUPER, CLIENT, BARBER_A];

async function limpar() {
  await psql(`
DELETE FROM public.tickets        WHERE barbershop_id IN ('${BS_A}','${BS_B}');
DELETE FROM public.appointments   WHERE barbershop_id IN ('${BS_A}','${BS_B}');
DELETE FROM public.products       WHERE barbershop_id IN ('${BS_A}','${BS_B}');
DELETE FROM public.services       WHERE barbershop_id IN ('${BS_A}','${BS_B}');
DELETE FROM public.user_roles     WHERE user_id IN (${ALL_USERS.map((u) => `'${u}'`).join(",")});
DELETE FROM public.barbershops    WHERE id IN ('${BS_A}','${BS_B}');
DELETE FROM auth.users            WHERE id IN (${ALL_USERS.map((u) => `'${u}'`).join(",")});
DELETE FROM public.profiles       WHERE user_id IN (${ALL_USERS.map((u) => `'${u}'`).join(",")});`);
}

async function semear() {
  await limpar();
  const usuario = (id, email) => `
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES ('${id}','${SENT}','authenticated','authenticated','${email}','x', now(), now(), now())
ON CONFLICT (id) DO NOTHING;`;
  const r = await psql(`
INSERT INTO public.barbershops (id, name, subdomain, status) VALUES ('${SENT}','Sistema','_system','approved') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.barbershops (id, name, subdomain, status, plan_id) VALUES
  ('${BS_A}','Comandas A','comandas-a','approved',(SELECT id FROM public.plans WHERE name='pro' LIMIT 1)),
  ('${BS_B}','Comandas B','comandas-b','approved',(SELECT id FROM public.plans WHERE name='pro' LIMIT 1));
${usuario(ADMIN_A, "c-admin-a@local")}${usuario(ADMIN_B, "c-admin-b@local")}${usuario(SUPER, "c-super@local")}${usuario(CLIENT, "c-cliente@local")}${usuario(BARBER_A, "c-barbeiro@local")}
INSERT INTO public.user_roles (user_id, barbershop_id, role) VALUES
  ('${ADMIN_A}','${BS_A}','admin_barbearia'),
  ('${ADMIN_B}','${BS_B}','admin_barbearia'),
  ('${BARBER_A}','${BS_A}','barbeiro'),
  ('${SUPER}','${SENT}','super_admin');
INSERT INTO public.services (id, barbershop_id, barber_id, name, duration_minutes, price, active) VALUES
  ('${SVC_A}','${BS_A}','${BARBER_A}','Corte A', 30, 40, true),
  ('${SVC_B}','${BS_B}','${ADMIN_B}','Corte B', 30, 50, true);
INSERT INTO public.products (id, barbershop_id, name, price, stock_quantity, active) VALUES
  ('${PRD_A}','${BS_A}','Pomada A', 30, 5, true),
  ('${PRD_LOW}','${BS_A}','Última Unidade', 25, 1, true),
  ('${PRD_B}','${BS_B}','Pomada B', 30, 5, true);
INSERT INTO public.appointments (id, barbershop_id, client_id, barber_id, service_id, date, start_time, end_time, status) VALUES
  ('${APPT_A}','${BS_A}','${CLIENT}','${BARBER_A}','${SVC_A}', DATE '2026-09-02', '10:00', '10:30', 'scheduled');`);
  if (r.code !== 0 || /^ERROR:/m.test(r.out)) {
    check("seed do harness criado", false, r.out.trim().slice(-400));
    return false;
  }
  check("seed do harness criado", true);
  return true;
}

/** Abre comanda e devolve o uuid (ou null). */
async function abrir(userId, args) {
  const r = await como(userId, `SELECT 'TK=' || public.open_ticket(${args}) AS r;`, true);
  const m = r.out.match(/TK=([0-9a-f-]{36})/i);
  return { id: m ? m[1] : null, out: r.out };
}

/* ------------------------------ testes ----------------------------- */
async function testAbertura() {
  group("abertura");

  // Manual (sem agendamento/cliente), barbeiro responsável do tenant.
  const man = await abrir(ADMIN_A, `'${BS_A}', NULL, NULL, '${BARBER_A}'`);
  check("abre comanda manual (staff)", !!man.id, man.out.trim().slice(-200));
  if (man.id) {
    const st = await psql(`SELECT status, subtotal, total FROM public.tickets WHERE id='${man.id}';`);
    check("comanda nasce aberta e zerada", st.out.includes("aberta") && st.out.includes("0.00"), st.out.trim());
  }

  // Por agendamento: adiciona serviço inicial e é idempotente.
  const a1 = await abrir(ADMIN_A, `'${BS_A}', '${APPT_A}'`);
  check("abre comanda por agendamento", !!a1.id, a1.out.trim().slice(-200));
  const a2 = await abrir(ADMIN_A, `'${BS_A}', '${APPT_A}'`);
  check("reabrir o mesmo agendamento é idempotente (mesma comanda)", a1.id && a1.id === a2.id, `${a1.id} vs ${a2.id}`);
  if (a1.id) {
    const it = await psql(`SELECT description, unit_price, total FROM public.ticket_items WHERE ticket_id='${a1.id}';`);
    check("serviço inicial entra com preço do catálogo (40.00)", it.out.includes("Corte A") && it.out.includes("40.00"), it.out.trim());
    const sub = await psql(`SELECT subtotal, total FROM public.tickets WHERE id='${a1.id}';`);
    check("subtotal/total recalculados no banco (40.00)", sub.out.includes("40.00"), sub.out.trim());
  }
  return { man: man.id, appt: a1.id };
}

async function testItensEEstoque(ctx) {
  group("itens e estoque (aberta não baixa)");
  const tk = ctx.man;
  if (!tk) return;

  // Adiciona produto (5 em estoque) qty 2 — estoque NÃO deve baixar enquanto aberta.
  await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tk}','${BS_A}','product','${PRD_A}','x', 2);`, true);
  const est = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_A}';`);
  check("produto adicionado NÃO baixa estoque com a comanda aberta", num(est.out, 5), est.out.trim());

  // Preço do produto veio do catálogo (30) e total = 60.
  const it = await psql(`SELECT unit_price, quantity, total FROM public.ticket_items WHERE ticket_id='${tk}' AND item_type='product';`);
  check("produto entra com preço do catálogo e total = preço×qtd (60.00)", it.out.includes("30.00") && it.out.includes("60.00"), it.out.trim());

  // Alterar quantidade com total FORJADO: servidor recalcula (ignora o total do front).
  await como(ADMIN_A, `UPDATE public.ticket_items SET quantity=3, total=999 WHERE ticket_id='${tk}' AND item_type='product';`, true);
  const it2 = await psql(`SELECT total FROM public.ticket_items WHERE ticket_id='${tk}' AND item_type='product';`);
  check("total do item é recalculado no banco, ignorando o valor enviado (90.00)", it2.out.includes("90.00") && !it2.out.includes("999"), it2.out.trim());
}

async function testIsolamento(ctx) {
  group("isolamento entre tenants");
  const tk = ctx.man;

  const prodB = await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tk}','${BS_A}','product','${PRD_B}','x',1);`);
  check("produto de outra barbearia é recusado", prodB.out.includes("tenant_invalido"), prodB.out.trim().slice(-160));

  const svcB = await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, service_id, description, quantity) VALUES ('${tk}','${BS_A}','service','${SVC_B}','x',1);`);
  check("serviço de outro tenant é recusado", svcB.out.includes("tenant_invalido"), svcB.out.trim().slice(-160));

  const apptOutro = await abrir(ADMIN_B, `'${BS_B}', '${APPT_A}'`);
  check("agendamento de outro tenant é recusado", apptOutro.out.includes("tenant_invalido"), apptOutro.out.trim().slice(-160));

  const barbAlheio = await abrir(ADMIN_A, `'${BS_A}', NULL, NULL, '${ADMIN_B}'`);
  check("barbeiro de outro tenant é recusado", barbAlheio.out.includes("tenant_invalido"), barbAlheio.out.trim().slice(-160));

  const veAlheio = await como(ADMIN_B, `SELECT count(*) FROM public.tickets WHERE barbershop_id='${BS_A}';`);
  check("admin B não enxerga comandas de A (RLS)", num(veAlheio.out, 0), veAlheio.out.trim());

  const veProprio = await como(ADMIN_A, `SELECT count(*) FROM public.tickets WHERE barbershop_id='${BS_A}';`);
  check("admin A enxerga as próprias comandas", !num(veProprio.out, 0), veProprio.out.trim());
}

async function testPapeis(ctx) {
  group("papéis (cliente não administra; anon fora; super_admin dentro)");

  const cliAbre = await abrir(CLIENT, `'${BS_A}', NULL, NULL, '${BARBER_A}'`);
  check("cliente comum não abre comanda (forbidden)", cliAbre.out.includes("forbidden"), cliAbre.out.trim().slice(-160));

  const cliItem = await como(CLIENT, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, description, unit_price, quantity) VALUES ('${ctx.man}','${BS_A}','custom','x',10,1);`);
  check("cliente comum não insere item (RLS)", /row-level security|permission denied/.test(cliItem.out), cliItem.out.trim().slice(-160));

  const cliFecha = await como(CLIENT, `SELECT public.close_ticket('${ctx.man}');`);
  check("cliente comum não fecha comanda (forbidden)", cliFecha.out.includes("forbidden"), cliFecha.out.trim().slice(-160));

  const anon = await comoAnon(`SELECT count(*) FROM public.tickets;`);
  check("anônimo não acessa comandas", anon.out.includes("permission denied"), anon.out.trim().slice(-120));

  const sup = await abrir(SUPER, `'${BS_A}', NULL, NULL, '${BARBER_A}'`);
  check("super_admin abre comanda", !!sup.id, sup.out.trim().slice(-160));
}

async function testFechamento(ctx) {
  group("fechamento (transacional; baixa no fechamento)");
  const tk = ctx.appt; // comanda por agendamento, tem o serviço (40)

  // Adiciona 2 unidades do produto (estoque 5) e fecha.
  await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tk}','${BS_A}','product','${PRD_A}','x',2);`, true);
  const fechou = await como(ADMIN_A, `SELECT public.close_ticket('${tk}', '[{"method_name":"Pix","amount":100}]'::jsonb);`, true);
  check("fecha comanda com estoque suficiente", !/ERROR/.test(fechou.out), fechou.out.trim().slice(-200));

  const est = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_A}';`);
  check("estoque baixa SÓ no fechamento (5 → 3)", num(est.out, 3), est.out.trim());

  const t = await psql(`SELECT status, subtotal, total, closed_at IS NOT NULL AS fechado FROM public.tickets WHERE id='${tk}';`);
  check("status vira 'fechada' com closed_at", t.out.includes("fechada") && /\bt\b/.test(t.out), t.out.trim());
  check("subtotal recalculado no banco = 40 + 2×30 = 100.00", t.out.includes("100.00"), t.out.trim());

  const appt = await psql(`SELECT status FROM public.appointments WHERE id='${APPT_A}';`);
  check("agendamento vinculado vira 'completed'", appt.out.includes("completed"), appt.out.trim());

  // Imutabilidade da comanda fechada.
  const mexe = await como(ADMIN_A, `UPDATE public.tickets SET discount_amount=5 WHERE id='${tk}';`);
  check("comanda fechada é imutável (update recusado)", mexe.out.includes("comanda_imutavel"), mexe.out.trim().slice(-160));
  const addItem = await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, description, unit_price, quantity) VALUES ('${tk}','${BS_A}','custom','x',5,1);`);
  check("não adiciona item em comanda fechada", addItem.out.includes("comanda_nao_aberta"), addItem.out.trim().slice(-160));
  const refecha = await como(ADMIN_A, `SELECT public.close_ticket('${tk}');`);
  check("fechar de novo é recusado", refecha.out.includes("comanda_nao_aberta"), refecha.out.trim().slice(-160));
}

async function testEstoqueInsuficiente() {
  group("estoque insuficiente não deixa baixa parcial");
  const tk = (await abrir(ADMIN_A, `'${BS_A}', NULL, NULL, '${BARBER_A}'`)).id;
  // pede 6 de um produto com 5 (após o teste anterior o estoque é 3, então pede 4)
  await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tk}','${BS_A}','product','${PRD_A}','x',10);`, true);
  const estAntes = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_A}';`);
  const fecha = await como(ADMIN_A, `SELECT public.close_ticket('${tk}');`, true);
  check("fechar com estoque insuficiente é recusado", fecha.out.includes("estoque_insuficiente"), fecha.out.trim().slice(-200));
  const estDepois = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_A}';`);
  check("nenhuma baixa parcial: estoque intacto", estAntes.out.trim() === estDepois.out.trim(), `${estAntes.out.trim()} == ${estDepois.out.trim()}`);
  const st = await psql(`SELECT status FROM public.tickets WHERE id='${tk}';`);
  check("comanda permanece aberta após falha", st.out.includes("aberta"), st.out.trim());
}

async function testCancelamento() {
  group("cancelamento (só aberta, sem estoque)");
  const tk = (await abrir(ADMIN_A, `'${BS_A}', NULL, NULL, '${BARBER_A}'`)).id;
  await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tk}','${BS_A}','product','${PRD_A}','x',1);`, true);
  const estAntes = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_A}';`);
  const canc = await como(ADMIN_A, `UPDATE public.tickets SET status='cancelada' WHERE id='${tk}';`, true);
  check("cancela comanda aberta", !/ERROR/.test(canc.out), canc.out.trim().slice(-160));
  const estDepois = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_A}';`);
  check("cancelar não movimenta estoque", estAntes.out.trim() === estDepois.out.trim(), `${estAntes.out.trim()} == ${estDepois.out.trim()}`);
  const mexe = await como(ADMIN_A, `UPDATE public.tickets SET status='aberta' WHERE id='${tk}';`);
  check("comanda cancelada é imutável", mexe.out.includes("comanda_imutavel"), mexe.out.trim().slice(-160));
}

async function testCorridaUltimaUnidade() {
  group("corrida na última unidade (duas conexões)");
  // Duas comandas, cada uma com 1 do produto de estoque 1.
  const tkA = (await abrir(ADMIN_A, `'${BS_A}', NULL, NULL, '${BARBER_A}'`)).id;
  const tkB = (await abrir(ADMIN_A, `'${BS_A}', NULL, NULL, '${BARBER_A}'`)).id;
  await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tkA}','${BS_A}','product','${PRD_LOW}','x',1);`, true);
  await como(ADMIN_A, `INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, product_id, description, quantity) VALUES ('${tkB}','${BS_A}','product','${PRD_LOW}','x',1);`, true);

  const claims = `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims TO '{"sub":"${ADMIN_A}","role":"authenticated"}';`;
  // A segura a linha do produto (FOR UPDATE) por 3s; B chega no meio e espera.
  const a = psql(`BEGIN; ${claims} SELECT public.close_ticket('${tkA}'); SELECT pg_sleep(3); COMMIT;`);
  await new Promise((r) => setTimeout(r, 1000));
  const b = psql(`BEGIN; ${claims} SELECT public.close_ticket('${tkB}'); COMMIT;`);
  const [ra, rb] = await Promise.all([a, b]);

  const umOk = !/ERROR/.test(ra.out);
  const outroRecusado = rb.out.includes("estoque_insuficiente");
  check("uma comanda fecha", umOk, ra.out.trim().slice(-160));
  check("a outra recebe estoque_insuficiente (não vende a mesma última unidade)", outroRecusado, rb.out.trim().slice(-160));
  const est = await psql(`SELECT stock_quantity FROM public.products WHERE id='${PRD_LOW}';`);
  check("estoque final = 0 (nunca negativo)", num(est.out, 0), est.out.trim());
}

/* ------------------------------ runner ----------------------------- */
async function main() {
  const ping = await psql("SELECT 1;");
  if (ping.code !== 0) {
    pularPorFaltaDeBanco(CONTAINER, ping.out.trim().slice(0, 300));
  }
  group("pré-condição");
  const temRpc = await psql(`SELECT proname FROM pg_proc WHERE proname IN ('open_ticket','close_ticket');`);
  check("RPCs open_ticket/close_ticket existem", temRpc.out.includes("open_ticket") && temRpc.out.includes("close_ticket"), 'rode "npx supabase db reset --local --no-seed"');

  if (await semear()) {
    try {
      const ctx = await testAbertura();
      await testItensEEstoque(ctx);
      await testIsolamento(ctx);
      await testPapeis(ctx);
      await testFechamento(ctx);
      await testEstoqueInsuficiente();
      await testCancelamento();
      await testCorridaUltimaUnidade();
    } finally {
      await limpar();
    }
  }

  const linhas = [];
  let passed = 0, failed = 0, printed = "";
  for (const item of checks) {
    if (item.group !== printed) { linhas.push(`\n▸ ${item.group}`); printed = item.group; }
    item.ok ? passed++ : failed++;
    linhas.push(`${item.ok ? "  ✓" : "  ✗"} ${item.name}${item.detail && !item.ok ? `  — ${item.detail}` : ""}`);
  }
  linhas.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  console.log(linhas.join("\n"));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
