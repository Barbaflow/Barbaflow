/**
 * Harness de banco da agenda, contra o Postgres LOCAL de verdade:
 * concorrência, disponibilidade derivada, idempotência e permissões por papel.
 *
 *   npx supabase start
 *   node scripts/run-agenda-concurrency-harness.mjs
 *
 * Por que existe: as três telas que criam atendimento montam a lista de
 * horários no cliente, leem os agendamentos e fazem `INSERT`. Entre ler e
 * gravar não havia nada no banco impedindo que duas requisições concorrentes
 * ocupassem o MESMO profissional no MESMO intervalo — duas abas, dois clientes
 * ou um duplo clique bastavam. A migration
 * `20260722180000_prevent_overlapping_appointments` fecha isso com uma
 * constraint EXCLUDE; este harness prova que ela funciona sob concorrência
 * real, com duas conexões simultâneas — não com dois awaits em sequência.
 *
 * A parte de concorrência roda como superusuário (RLS não se aplica) de
 * propósito: garante que a proteção vem da CONSTRAINT, e não de uma policy que
 * um caminho privilegiado poderia contornar. A parte de permissões faz o
 * oposto — assume cada papel via `SET LOCAL ROLE` + claims de JWT, dentro de
 * uma transação, que é a única forma de o RLS de fato ser aplicado.
 */
import { spawn } from "node:child_process";

const CONTAINER = "supabase_db_barbaflow";

/* ---------------------------- asserções ---------------------------- */

const checks = [];
let currentGroup = "geral";
const group = (name) => {
  currentGroup = name;
};
const check = (name, ok, detail = "") => {
  checks.push({ group: currentGroup, name, ok, detail });
};

/* ------------------------------ psql ------------------------------- */

/** Executa SQL no Postgres local. Resolve com { code, out } — nunca rejeita. */
function psql(sql) {
  return new Promise((resolve) => {
    const p = spawn(
      "docker",
      ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("error", () => resolve({ code: -1, out: "docker indisponível" }));
    p.on("close", (code) => resolve({ code: code ?? -1, out }));
    p.stdin.end(sql);
  });
}

/** Executa SQL assumindo um usuário autenticado, com RLS valendo de verdade. */
function psqlComo(userId, sql) {
  return psql(`
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"${userId}","role":"authenticated"}';
${sql}
ROLLBACK;`);
}

/** Executa SQL como visitante anônimo. */
function psqlComoAnon(sql) {
  return psql(`BEGIN; SET LOCAL ROLE anon;
${sql}
ROLLBACK;`);
}

const isOverlapError = (out) =>
  out.includes("appointments_no_overlap_per_barber") && out.includes("exclusion constraint");

/* ---------------------------- fixtures ----------------------------- */

// Ids fixos e próprios do harness: não colidem com seed nem com dados reais.
const BS = "aaaaaaaa-0000-4000-8000-00000000f001";
const SV = "bbbbbbbb-0000-4000-8000-00000000f001";
const B1 = "cccccccc-0000-4000-8000-00000000f001";
const B2 = "cccccccc-0000-4000-8000-00000000f002";
const DIA = "2026-08-10";
const cli = (n) => `dddddddd-0000-4000-8000-00000000f0${n}`;

// Segundo tenant + usuários com papéis reais, para exercitar RLS de verdade.
const BS2 = "aaaaaaaa-0000-4000-8000-00000000f002";
const SENTINELA = "00000000-0000-0000-0000-000000000000";
const U_ADMIN_A = "eeeeeeee-0000-4000-8000-00000000f001";
const U_ADMIN_B = "eeeeeeee-0000-4000-8000-00000000f002";
const U_SUPER = "eeeeeeee-0000-4000-8000-00000000f003";
// O profissional B1 também é um usuário: é ele quem tem a grade semanal.
const QUARTA = 3; // 2026-08-12 é uma quarta-feira
const DIA_GRADE = "2026-08-12";

const inserir = (clientId, barberId, ini, fim) => `
INSERT INTO public.appointments
  (barbershop_id, client_id, barber_id, service_id, date, start_time, end_time)
VALUES ('${BS}','${clientId}','${barberId}','${SV}', DATE '${DIA}', '${ini}', '${fim}');`;

async function limpar() {
  await psql(`
DELETE FROM public.appointments    WHERE barbershop_id IN ('${BS}','${BS2}');
DELETE FROM public.availability    WHERE barbershop_id IN ('${BS}','${BS2}');
DELETE FROM public.weekly_schedule WHERE barbershop_id IN ('${BS}','${BS2}');
DELETE FROM public.schedule_blocks WHERE barbershop_id IN ('${BS}','${BS2}');
DELETE FROM public.services        WHERE barbershop_id IN ('${BS}','${BS2}');
DELETE FROM public.user_roles      WHERE user_id IN ('${U_ADMIN_A}','${U_ADMIN_B}','${U_SUPER}','${B1}');
DELETE FROM public.barbershops     WHERE id IN ('${BS}','${BS2}');
DELETE FROM auth.users             WHERE id IN ('${U_ADMIN_A}','${U_ADMIN_B}','${U_SUPER}','${B1}');
DELETE FROM public.profiles        WHERE user_id IN ('${U_ADMIN_A}','${U_ADMIN_B}','${U_SUPER}','${B1}');`);
}

async function sear() {
  await limpar();
  const usuario = (id, email) => `
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
VALUES ('${id}', '${SENTINELA}', 'authenticated', 'authenticated', '${email}', 'x',
        now(), now(), now())
ON CONFLICT (id) DO NOTHING;`;

  const r = await psql(`
-- A sentinela precisa existir para ancorar o papel global do super_admin.
INSERT INTO public.barbershops (id, name, subdomain, status)
VALUES ('${SENTINELA}', 'Sistema', '_system', 'approved') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.barbershops (id, name, subdomain, status, plan_id) VALUES
  ('${BS}',  'Harness A', 'harness-a', 'approved', (SELECT id FROM public.plans WHERE name = 'pro' LIMIT 1)),
  ('${BS2}', 'Harness B', 'harness-b', 'approved', (SELECT id FROM public.plans WHERE name = 'pro' LIMIT 1));

${usuario(U_ADMIN_A, "harness-admin-a@local")}
${usuario(U_ADMIN_B, "harness-admin-b@local")}
${usuario(U_SUPER, "harness-super@local")}
${usuario(B1, "harness-barbeiro@local")}

INSERT INTO public.user_roles (user_id, barbershop_id, role) VALUES ('${U_ADMIN_A}', '${BS}',  'admin_barbearia');
INSERT INTO public.user_roles (user_id, barbershop_id, role) VALUES ('${U_ADMIN_B}', '${BS2}', 'admin_barbearia');
INSERT INTO public.user_roles (user_id, barbershop_id, role) VALUES ('${B1}',        '${BS}',  'barbeiro');
INSERT INTO public.user_roles (user_id, barbershop_id, role) VALUES ('${U_SUPER}',   '${SENTINELA}', 'super_admin');

INSERT INTO public.services (id, barbershop_id, barber_id, name, duration_minutes, price, active)
VALUES ('${SV}', '${BS}', '${B1}', 'Corte', 30, 40, true);

-- Grade semanal salva e NADA mais: "Gerar Agenda" nunca é chamado.
INSERT INTO public.weekly_schedule (barbershop_id, barber_id, day_of_week, start_time, end_time, is_active)
VALUES ('${BS}', '${B1}', ${QUARTA}, '09:00', '12:00', true);`);
  if (r.code !== 0 || /^ERROR:/m.test(r.out)) {
    check("seed do harness criado", false, r.out.trim().slice(-300));
    return false;
  }
  return true;
}

/* ------------------------------ testes ----------------------------- */

async function testDisponibilidadeDerivada() {
  group("disponibilidade sem 'Gerar Agenda'");

  // O seed gravou APENAS a grade semanal. Se o público dependesse de
  // availability, isto devolveria zero — que era exatamente o bug.
  const vazio = await psql(`SELECT count(*) FROM public.availability WHERE barbershop_id = '${BS}';`);
  check("availability começa vazia (ninguém clicou em 'Gerar Agenda')", /\n\s*0\s*\n/.test(vazio.out), vazio.out.trim());

  const janelas = await psqlComoAnon(
    `SELECT start_time, end_time, status FROM public.get_public_availability_windows('${BS}','${B1}', DATE '${DIA_GRADE}');`,
  );
  check(
    "salvar a grade semanal já disponibiliza a janela publicamente",
    janelas.out.includes("09:00:00") && janelas.out.includes("12:00:00") && janelas.out.includes("livre"),
    janelas.out.trim().slice(-200),
  );

  group("idempotência da geração");
  const primeira = await psql(
    `SELECT public.generate_availability_from_schedule('${B1}','${BS}', DATE '${DIA_GRADE}', DATE '${DIA_GRADE}');`,
  );
  const apos1 = await psql(`SELECT count(*) FROM public.availability WHERE barbershop_id = '${BS}';`);
  check("primeira geração grava 1 janela", /\n\s*1\s*\n/.test(primeira.out) && /\n\s*1\s*\n/.test(apos1.out), `${primeira.out}|${apos1.out}`);

  const segunda = await psql(
    `SELECT public.generate_availability_from_schedule('${B1}','${BS}', DATE '${DIA_GRADE}', DATE '${DIA_GRADE}');`,
  );
  const apos2 = await psql(`SELECT count(*) FROM public.availability WHERE barbershop_id = '${BS}';`);
  check("gerar de novo não grava nada (contador honesto: 0)", /\n\s*0\s*\n/.test(segunda.out), segunda.out.trim());
  check("mesma quantidade de registros após regenerar", /\n\s*1\s*\n/.test(apos2.out), apos2.out.trim());

  const duplicata = await psql(`
INSERT INTO public.availability (barbershop_id, barber_id, date, start_time, end_time, status)
VALUES ('${BS}','${B1}', DATE '${DIA_GRADE}', '09:00', '12:00', 'livre');`);
  check(
    "constraint única recusa janela idêntica",
    duplicata.out.includes("availability_janela_unica"),
    duplicata.out.trim().slice(-200),
  );

  const folga = await psql(`
INSERT INTO public.availability (barbershop_id, barber_id, date, start_time, end_time, status)
VALUES ('${BS}','${B1}', DATE '${DIA_GRADE}', '09:00', '12:00', 'folga');`);
  check(
    "mesmo intervalo com OUTRO status continua permitido (significado diferente)",
    folga.code === 0 && !folga.out.includes("availability_janela_unica"),
    folga.out.trim().slice(-200),
  );
  await psql(`DELETE FROM public.availability WHERE barbershop_id = '${BS}' AND status = 'folga';`);

  group("grade alterada não deixa janela obsoleta no público");
  await psql(`UPDATE public.weekly_schedule SET is_active = false WHERE barber_id = '${B1}';`);
  const desativada = await psqlComoAnon(
    `SELECT count(*) FROM public.get_public_availability_windows('${BS}','${B1}', DATE '${DIA_GRADE}');`,
  );
  const sobrou = await psql(`SELECT count(*) FROM public.availability WHERE barbershop_id = '${BS}';`);
  check("desativar o dia zera as janelas públicas na hora", /\n\s*0\s*\n/.test(desativada.out), desativada.out.trim());
  check(
    "linha antiga de availability não vaza para o público",
    /\n\s*1\s*\n/.test(sobrou.out),
    "a linha continua gravada, mas é ignorada por ser 'livre'",
  );

  await psql(
    `UPDATE public.weekly_schedule SET is_active = true, start_time = '14:00', end_time = '16:00' WHERE barber_id = '${B1}';`,
  );
  const alterada = await psqlComoAnon(
    `SELECT start_time, end_time FROM public.get_public_availability_windows('${BS}','${B1}', DATE '${DIA_GRADE}');`,
  );
  check(
    "alterar o horário da grade reflete no público sem regenerar",
    alterada.out.includes("14:00:00") && !alterada.out.includes("09:00:00"),
    alterada.out.trim().slice(-200),
  );
  await psql(
    `UPDATE public.weekly_schedule SET start_time = '09:00', end_time = '12:00' WHERE barber_id = '${B1}';`,
  );

  group("bloqueio do dia continua valendo");
  await psql(`
INSERT INTO public.schedule_blocks (barbershop_id, barber_id, block_date, reason)
VALUES ('${BS}','${B1}', DATE '${DIA_GRADE}', 'harness');`);
  const bloqueado = await psqlComoAnon(
    `SELECT count(*) FROM public.get_public_availability_windows('${BS}','${B1}', DATE '${DIA_GRADE}');`,
  );
  check("dia bloqueado não oferece janela", /\n\s*0\s*\n/.test(bloqueado.out), bloqueado.out.trim());
  await psql(`DELETE FROM public.schedule_blocks WHERE barbershop_id = '${BS}';`);
}

async function testPermissoes() {
  group("super_admin no tenant selecionado");
  const leGrade = await psqlComo(
    U_SUPER,
    `SELECT count(*) FROM public.weekly_schedule WHERE barbershop_id = '${BS}';`,
  );
  check("super_admin lê weekly_schedule do tenant", /\n\s*1\s*\n/.test(leGrade.out), leGrade.out.trim());

  const criou = await psqlComo(
    U_SUPER,
    `WITH i AS (
       INSERT INTO public.schedule_blocks (barbershop_id, barber_id, block_date, reason)
       VALUES ('${BS}','${B1}', DATE '2026-08-19', 'super')
       RETURNING 1
     ) SELECT count(*) AS gravadas FROM i;`,
  );
  check("super_admin cria schedule_block", /\n\s*1\s*\n/.test(criou.out), criou.out.trim().slice(-200));

  const removeu = await psqlComo(
    U_SUPER,
    `INSERT INTO public.schedule_blocks (barbershop_id, barber_id, block_date, reason)
       VALUES ('${BS}','${B1}', DATE '2026-08-19', 'super');
     WITH d AS (
       DELETE FROM public.schedule_blocks
        WHERE barbershop_id = '${BS}' AND block_date = DATE '2026-08-19'
       RETURNING 1
     ) SELECT count(*) AS removidas FROM d;`,
  );
  check("super_admin remove schedule_block", /\n\s*1\s*\n/.test(removeu.out), removeu.out.trim().slice(-200));

  group("isolamento entre tenants");
  const alheio = await psqlComo(
    U_ADMIN_B,
    `SELECT count(*) FROM public.weekly_schedule WHERE barbershop_id = '${BS}';`,
  );
  check("admin do tenant B não enxerga a grade do tenant A", /\n\s*0\s*\n/.test(alheio.out), alheio.out.trim());

  group("barbeiro e admin: regra preservada");
  const propria = await psqlComo(
    B1,
    `SELECT count(*) FROM public.weekly_schedule WHERE barber_id = '${B1}';`,
  );
  check("barbeiro vê a própria grade", /\n\s*1\s*\n/.test(propria.out), propria.out.trim());

  const editaPropria = await psqlComo(
    B1,
    `WITH u AS (
       UPDATE public.weekly_schedule SET end_time = '17:00'
        WHERE barber_id = '${B1}' RETURNING 1
     ) SELECT count(*) AS afetadas FROM u;`,
  );
  check("barbeiro edita a própria grade", /\n\s*1\s*\n/.test(editaPropria.out), editaPropria.out.trim().slice(-160));

  // Isto NÃO foi ampliado de propósito: a policy original de UPDATE é
  // estritamente `barber_id = auth.uid()`, e continua sendo.
  const adminEditaAlheia = await psqlComo(
    U_ADMIN_A,
    `WITH u AS (
       UPDATE public.weekly_schedule SET end_time = '23:00'
        WHERE barber_id = '${B1}' RETURNING 1
     ) SELECT count(*) AS afetadas FROM u;`,
  );
  check(
    "admin continua sem editar a grade de outro profissional",
    /\n\s*0\s*\n/.test(adminEditaAlheia.out),
    adminEditaAlheia.out.trim().slice(-160),
  );

  group("anônimo");
  const anonTabela = await psqlComoAnon(`SELECT count(*) FROM public.weekly_schedule;`);
  check("anônimo não lê weekly_schedule", anonTabela.out.includes("permission denied"), anonTabela.out.trim().slice(-120));

  const anonAppt = await psqlComoAnon(`SELECT count(*) FROM public.appointments;`);
  check("anônimo não lê appointments", anonAppt.out.includes("permission denied"), anonAppt.out.trim().slice(-120));

  const anonRpc = await psqlComoAnon(
    `SELECT * FROM public.get_public_busy_intervals('${BS}','${B1}', DATE '${DIA}');`,
  );
  check(
    "RPC pública responde ao anônimo e devolve só horários",
    !anonRpc.out.includes("permission denied") &&
      anonRpc.out.includes("start_time") &&
      !anonRpc.out.includes("client_id"),
    anonRpc.out.trim().slice(-200),
  );
}

async function testCorrida() {
  group("corrida real (duas conexões simultâneas)");

  // A segura a transação aberta; B chega no meio e tem de esperar o commit de A
  // para então bater na constraint. Sem a constraint, as duas passariam.
  const a = psql(`
BEGIN;
${inserir(cli("0a"), B1, "10:00", "10:30")}
SELECT pg_sleep(3);
COMMIT;`);

  await new Promise((r) => setTimeout(r, 1000));

  const b = psql(`
BEGIN;
${inserir(cli("0b"), B1, "10:15", "10:45")}
COMMIT;`);

  const [ra, rb] = await Promise.all([a, b]);

  const aOk = ra.code === 0 && !isOverlapError(ra.out);
  const bRecusado = isOverlapError(rb.out);
  check("uma das criações é aceita", aOk, ra.out.trim().slice(-200));
  check("a outra recebe erro identificável de conflito", bRecusado, rb.out.trim().slice(-200));

  const cont = await psql(
    `SELECT count(*) FROM public.appointments WHERE barber_id = '${B1}' AND status <> 'cancelled';`,
  );
  check("não ficam duas linhas sobrepostas", /\n\s*1\s*\n/.test(cont.out), cont.out.trim());

  const sqlstate = await psql(`
DO $$
BEGIN
  ${inserir(cli("0c"), B1, "10:10", "10:40")}
EXCEPTION WHEN exclusion_violation THEN
  RAISE NOTICE 'SQLSTATE=%', SQLSTATE;
END; $$;`);
  check(
    "conflito chega como SQLSTATE 23P01 (traduzível na interface)",
    sqlstate.out.includes("SQLSTATE=23P01"),
    sqlstate.out.trim().slice(-200),
  );
}

async function testRegras() {
  group("regras preservadas");

  const adjacente = await psql(inserir(cli("0d"), B1, "10:30", "11:00"));
  check(
    "atendimento adjacente (começa quando o outro termina) é aceito",
    adjacente.code === 0 && !isOverlapError(adjacente.out),
    adjacente.out.trim().slice(-200),
  );

  const outroBarbeiro = await psql(inserir(cli("0e"), B2, "10:00", "10:30"));
  check(
    "mesmo horário para OUTRO profissional é aceito",
    outroBarbeiro.code === 0 && !isOverlapError(outroBarbeiro.out),
    outroBarbeiro.out.trim().slice(-200),
  );

  const sobreposto = await psql(inserir(cli("0f"), B1, "10:20", "10:50"));
  check("sobreposição no mesmo profissional é recusada", isOverlapError(sobreposto.out));

  await psql(
    `UPDATE public.appointments SET status = 'cancelled'
      WHERE barber_id = '${B1}' AND start_time = '10:00';`,
  );
  const aposCancelar = await psql(inserir(cli("1a"), B1, "10:00", "10:30"));
  check(
    "cancelamento libera o horário",
    aposCancelar.code === 0 && !isOverlapError(aposCancelar.out),
    aposCancelar.out.trim().slice(-200),
  );

  group("reagendamento");
  // Mover um atendimento para cima de outro tem de ser recusado do mesmo jeito
  // que criar — a constraint vale para UPDATE também.
  const mover = await psql(
    `UPDATE public.appointments
        SET start_time = '10:30', end_time = '11:00'
      WHERE barber_id = '${B1}' AND client_id = '${cli("1a")}';`,
  );
  check("reagendar para horário ocupado é recusado", isOverlapError(mover.out), mover.out.trim().slice(-200));

  const moverLivre = await psql(
    `UPDATE public.appointments
        SET start_time = '15:00', end_time = '15:30'
      WHERE barber_id = '${B1}' AND client_id = '${cli("1a")}';`,
  );
  check(
    "reagendar para horário livre é aceito",
    moverLivre.code === 0 && !isOverlapError(moverLivre.out),
    moverLivre.out.trim().slice(-200),
  );
}

/* ------------------------------ runner ----------------------------- */

async function main() {
  const ping = await psql("SELECT 1;");
  if (ping.code !== 0) {
    console.log(
      `\nPULADO — Postgres local indisponível (container "${CONTAINER}").\n` +
        `Suba o stack com "npx supabase start" e rode de novo.\n${ping.out.trim().slice(0, 300)}`,
    );
    process.exit(0);
  }

  const temConstraint = await psql(
    `SELECT conname FROM pg_constraint WHERE conname = 'appointments_no_overlap_per_barber';`,
  );
  group("pré-condição");
  check(
    "constraint appointments_no_overlap_per_barber existe",
    temConstraint.out.includes("appointments_no_overlap_per_barber"),
    'rode "npx supabase db reset --local --no-seed"',
  );

  if (!(await sear())) {
    // `sear()` já registrou o motivo real da falha.
  } else {
    check("seed do harness criado", true);
    try {
      await testDisponibilidadeDerivada();
      await testPermissoes();
      await testCorrida();
      await testRegras();
    } finally {
      await limpar();
    }
  }

  const linhas = [];
  let passed = 0;
  let failed = 0;
  let printed = "";
  for (const item of checks) {
    if (item.group !== printed) {
      linhas.push(`\n▸ ${item.group}`);
      printed = item.group;
    }
    if (item.ok) passed += 1;
    else failed += 1;
    linhas.push(`${item.ok ? "  ✓" : "  ✗"} ${item.name}${item.detail && !item.ok ? `  — ${item.detail}` : ""}`);
  }
  linhas.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  console.log(linhas.join("\n"));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
