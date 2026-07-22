/**
 * Harness da Área do Cliente, contra o Postgres LOCAL de verdade.
 *
 *   npx supabase start
 *   node scripts/run-cliente-harness.mjs
 *
 * Por que existe: a policy de UPDATE de `appointments` é
 * `USING (client_id = auth.uid() OR ...)` e não tem `WITH CHECK` próprio. Em
 * Postgres, UPDATE sem WITH CHECK reaproveita o USING para a linha nova — o que
 * impede transferir a reserva para outra pessoa, mas NÃO impede o dono de
 * reescrever qualquer outra coluna. Medido antes da correção, um cliente comum
 * conseguia, sobre a própria reserva: marcar como concluída, marcar falta,
 * trocar o serviço por um mais caro, mudar de barbearia, trocar de profissional
 * e reagendar para qualquer data/hora fora de qualquer grade.
 *
 * A migration `20260722230000_client_appointment_transitions` fecha isso com um
 * trigger BEFORE UPDATE (RLS não resolve: `WITH CHECK` só enxerga a linha nova,
 * e a regra depende de comparar OLD com NEW). Este harness prova, com papéis
 * reais via `SET LOCAL ROLE` + claims de JWT, que:
 *
 *   * os ataques são recusados com códigos identificáveis;
 *   * cancelar e reagendar legítimos continuam funcionando;
 *   * a equipe da barbearia não foi afetada;
 *   * o isolamento entre clientes se mantém;
 *   * concorrência não duplica nem perde o agendamento original.
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

/** SQL como um usuário autenticado — única forma de a RLS valer de fato. */
function como(userId, sql) {
  return psql(`
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"${userId}","role":"authenticated"}';
${sql}
ROLLBACK;`);
}

/** Igual, mas com COMMIT — para os testes de concorrência. */
function comoCommit(userId, sql) {
  return psql(`
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub":"${userId}","role":"authenticated"}';
${sql}
COMMIT;`);
}

/** SQL como visitante anônimo. */
function comoAnon(sql) {
  return psql(`BEGIN; SET LOCAL ROLE anon;\n${sql}\nROLLBACK;`);
}

const recusaDe = (out) => (out.match(/appointment_[a-z_]+/) || [null])[0];
const linhas = (out) => {
  const m = out.match(/\n\s*(\d+)\s*\n/);
  return m ? Number(m[1]) : null;
};

/* ---------------------------- fixtures ----------------------------- */

const SENT = "00000000-0000-0000-0000-000000000000";
const BS1 = "aa000000-0000-4000-8000-00000000fc01";
const BS2 = "aa000000-0000-4000-8000-00000000fc02";
const SV1 = "bb000000-0000-4000-8000-00000000fc01";
const SV2 = "bb000000-0000-4000-8000-00000000fc02";
const BRB = "cc000000-0000-4000-8000-00000000fcb1";
const CLI1 = "cc000000-0000-4000-8000-00000000fcc1";
const CLI2 = "cc000000-0000-4000-8000-00000000fcc2";
const APT1 = "dd000000-0000-4000-8000-00000000fca1";
const APT2 = "dd000000-0000-4000-8000-00000000fca2";
// 2026-09-10 e 2026-09-17 são quintas-feiras (EXTRACT(DOW) = 4).
const QUINTA = 4;
const DIA = "2026-09-10";
const OUTRA_QUINTA = "2026-09-17";

async function limpar() {
  await psql(`
DELETE FROM public.appointments    WHERE barbershop_id IN ('${BS1}','${BS2}');
DELETE FROM public.availability    WHERE barbershop_id IN ('${BS1}','${BS2}');
DELETE FROM public.schedule_blocks WHERE barbershop_id IN ('${BS1}','${BS2}');
DELETE FROM public.weekly_schedule WHERE barbershop_id IN ('${BS1}','${BS2}');
DELETE FROM public.services        WHERE barbershop_id IN ('${BS1}','${BS2}');
DELETE FROM public.client_blocks   WHERE barbershop_id IN ('${BS1}','${BS2}');
DELETE FROM public.user_roles      WHERE user_id IN ('${BRB}','${CLI1}','${CLI2}');
DELETE FROM public.barbershops     WHERE id IN ('${BS1}','${BS2}');
DELETE FROM auth.users             WHERE id IN ('${BRB}','${CLI1}','${CLI2}');
DELETE FROM public.profiles        WHERE user_id IN ('${BRB}','${CLI1}','${CLI2}');`);
}

async function semear() {
  await limpar();
  const usuario = (id, email) => `
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
VALUES ('${id}', '${SENT}', 'authenticated', 'authenticated', '${email}', 'x', now(), now(), now())
ON CONFLICT (id) DO NOTHING;`;

  const r = await psql(`
-- A sentinela precisa existir para ancorar o papel global de super_admin.
INSERT INTO public.barbershops (id, name, subdomain, status)
VALUES ('${SENT}', 'Sistema', '_system', 'approved') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.barbershops (id, name, subdomain, status, plan_id) VALUES
  ('${BS1}','Cliente Harness A','cli-harness-a','approved',(SELECT id FROM public.plans WHERE name='pro' LIMIT 1)),
  ('${BS2}','Cliente Harness B','cli-harness-b','approved',(SELECT id FROM public.plans WHERE name='pro' LIMIT 1));

${usuario(BRB, "harness-brb@cliente.local")}
${usuario(CLI1, "harness-cli1@cliente.local")}
${usuario(CLI2, "harness-cli2@cliente.local")}

UPDATE public.profiles SET full_name = 'Cliente Dois', phone = '11988887777' WHERE user_id = '${CLI2}';

INSERT INTO public.user_roles (user_id, barbershop_id, role) VALUES ('${BRB}', '${BS1}', 'barbeiro');

INSERT INTO public.services (id, barbershop_id, barber_id, name, duration_minutes, price, active) VALUES
  ('${SV1}','${BS1}','${BRB}','Corte', 30, 40, true),
  ('${SV2}','${BS1}','${BRB}','Premium', 60, 200, true);

INSERT INTO public.weekly_schedule (barbershop_id, barber_id, day_of_week, start_time, end_time, is_active)
VALUES ('${BS1}','${BRB}', ${QUINTA}, '09:00', '18:00', true);

-- Uma reserva de cada cliente, no mesmo profissional, sem sobreposição.
INSERT INTO public.appointments (id, barbershop_id, client_id, barber_id, service_id, date, start_time, end_time, status) VALUES
  ('${APT1}','${BS1}','${CLI1}','${BRB}','${SV1}', DATE '${DIA}', '10:00', '10:30', 'scheduled'),
  ('${APT2}','${BS1}','${CLI2}','${BRB}','${SV1}', DATE '${DIA}', '11:00', '11:30', 'scheduled');`);

  if (r.code !== 0 || /^ERROR:/m.test(r.out)) {
    check("cenário do harness criado", false, r.out.trim().slice(-300));
    return false;
  }
  check("cenário do harness criado", true);
  return true;
}

/** Restaura o estado da reserva do cliente 1 entre testes que dão COMMIT. */
async function restaurarApt1() {
  await psql(`
UPDATE public.appointments
   SET status = 'scheduled', date = DATE '${DIA}', start_time = '10:00', end_time = '10:30'
 WHERE id = '${APT1}';`);
}

const editar = (sets) =>
  `WITH u AS (UPDATE public.appointments SET ${sets} WHERE id = '${APT1}' RETURNING 1) SELECT count(*) FROM u;`;

/* ------------------------------ testes ----------------------------- */

async function testPrivacidadeDeProfiles() {
  group("profiles: leitura da própria linha");

  const proprio = await como(
    CLI1,
    `SELECT count(*) FROM public.profiles WHERE user_id = '${CLI1}';`,
  );
  check("cliente lê o próprio perfil", linhas(proprio.out) === 1, proprio.out.trim());

  const camposProprios = await como(
    CLI1,
    `SELECT full_name, phone, avatar_url FROM public.profiles WHERE user_id = '${CLI1}';`,
  );
  check(
    "campos do próprio perfil disponíveis (inclusive telefone)",
    !/permission denied/i.test(camposProprios.out) && !/ERROR/i.test(camposProprios.out),
    camposProprios.out.trim().slice(-200),
  );

  group("profiles: terceiros bloqueados");

  const total = await como(CLI1, `SELECT count(*) FROM public.profiles;`);
  check(
    "cliente NÃO enumera profiles (vê exatamente 1 linha: a sua)",
    linhas(total.out) === 1,
    `viu ${linhas(total.out)} linha(s)`,
  );

  const linhaAlheia = await como(
    CLI1,
    `SELECT count(*) FROM public.profiles WHERE user_id = '${CLI2}';`,
  );
  check("cliente não lê a linha de outro cliente", linhas(linhaAlheia.out) === 0, linhaAlheia.out.trim());

  const telefoneAlheio = await como(
    CLI1,
    `SELECT coalesce(string_agg(phone, ','), '(nada)') FROM public.profiles WHERE user_id = '${CLI2}';`,
  );
  check(
    "cliente não lê o telefone de outro cliente",
    telefoneAlheio.out.includes("(nada)") && !telefoneAlheio.out.includes("11988887777"),
    telefoneAlheio.out.trim().slice(-160),
  );

  // Tentativa de contornar por filtro: continua sem enxergar a linha.
  const porTelefone = await como(
    CLI1,
    `SELECT count(*) FROM public.profiles WHERE phone = '11988887777';`,
  );
  check("filtro por telefone não revela terceiros", linhas(porTelefone.out) === 0, porTelefone.out.trim());

  // Tentativa de contornar pela RPC de telefone: ela valida o vínculo.
  const rpcTelefone = await como(
    CLI1,
    `SELECT coalesce(public.get_client_phone('${CLI2}'), '(nulo)') AS r;`,
  );
  check(
    "get_client_phone recusa telefone de terceiro",
    rpcTelefone.out.includes("(nulo)"),
    rpcTelefone.out.trim().slice(-160),
  );

  group("profiles: anônimo");
  const anonTabela = await comoAnon(`SELECT count(*) FROM public.profiles;`);
  check(
    "anônimo não consulta profiles",
    /permission denied/i.test(anonTabela.out),
    anonTabela.out.trim().slice(-160),
  );

  group("caminhos seguros preservados");

  // Resumo público: nome e avatar de um conjunto conhecido, sem telefone.
  const resumo = await como(
    CLI1,
    `SELECT * FROM public.get_public_profile_summaries(ARRAY['${CLI2}']::uuid[]);`,
  );
  check(
    "resumo público devolve nome de terceiro",
    resumo.out.includes("Cliente Dois"),
    resumo.out.trim().slice(-200),
  );
  check(
    "resumo público NÃO devolve telefone",
    !resumo.out.includes("11988887777") && !resumo.out.includes("phone"),
    resumo.out.trim().slice(-200),
  );

  const resumoAnon = await comoAnon(
    `SELECT count(*) FROM public.get_public_profile_summaries(ARRAY['${CLI2}']::uuid[]);`,
  );
  check("anônimo usa o resumo público (avaliações)", linhas(resumoAnon.out) === 1, resumoAnon.out.trim());

  // Equipe: nomes via RPC, sem SELECT direto.
  const equipe = await como(
    BRB,
    `SELECT count(*) FROM public.get_barber_display_names(ARRAY['${BRB}']::uuid[]);`,
  );
  check("equipe continua obtendo nomes por RPC", linhas(equipe.out) === 1, equipe.out.trim());

  group("staff: clientes só do próprio tenant");

  const clientesDoTenant = await como(
    BRB,
    `SELECT count(*) FROM public.get_barbershop_clients('${BS1}');`,
  );
  check(
    "barbeiro lista clientes da própria barbearia",
    (linhas(clientesDoTenant.out) ?? 0) >= 1,
    clientesDoTenant.out.trim(),
  );

  const comTelefone = await como(
    BRB,
    `SELECT coalesce(string_agg(client_phone, ','), '(nada)') FROM public.get_barbershop_clients('${BS1}');`,
  );
  check(
    "telefone chega ao staff pelo caminho autorizado",
    comTelefone.out.includes("11988887777"),
    comTelefone.out.trim().slice(-160),
  );

  const tenantAlheio = await como(BRB, `SELECT count(*) FROM public.get_barbershop_clients('${BS2}');`);
  check(
    "staff não lista clientes de outra barbearia",
    /forbidden|denied|ERROR/i.test(tenantAlheio.out) || linhas(tenantAlheio.out) === 0,
    tenantAlheio.out.trim().slice(-160),
  );

  const clienteChamaRpc = await como(CLI1, `SELECT count(*) FROM public.get_barbershop_clients('${BS1}');`);
  check(
    "cliente comum não usa a RPC administrativa",
    /forbidden|denied|ERROR/i.test(clienteChamaRpc.out) || linhas(clienteChamaRpc.out) === 0,
    clienteChamaRpc.out.trim().slice(-160),
  );

  group("super_admin");
  const su = await psql(`
INSERT INTO public.user_roles (user_id, barbershop_id, role)
VALUES ('${CLI2}', '${SENT}', 'super_admin') ON CONFLICT DO NOTHING;`);
  if (!/^ERROR:/m.test(su.out)) {
    const global = await como(CLI2, `SELECT count(*) FROM public.profiles;`);
    check(
      "super_admin mantém leitura global de profiles",
      (linhas(global.out) ?? 0) > 1,
      global.out.trim(),
    );
    await psql(`DELETE FROM public.user_roles WHERE user_id = '${CLI2}' AND role = 'super_admin';`);
  } else {
    check("papel de super_admin criado para o teste", false, su.out.trim().slice(-200));
  }
}

async function testIsolamento() {
  group("identidade e isolamento");

  const meus = await como(CLI1, `SELECT count(*) FROM public.appointments WHERE client_id = '${CLI1}';`);
  check("cliente vê as próprias reservas", linhas(meus.out) === 1, meus.out.trim());

  const alheios = await como(CLI1, `SELECT count(*) FROM public.appointments WHERE client_id <> '${CLI1}';`);
  check("cliente não vê reservas de outro usuário", linhas(alheios.out) === 0, alheios.out.trim());

  const cancelarAlheio = await como(
    CLI1,
    `WITH u AS (UPDATE public.appointments SET status='cancelled' WHERE id='${APT2}' RETURNING 1) SELECT count(*) FROM u;`,
  );
  check("cliente não cancela reserva de outro", linhas(cancelarAlheio.out) === 0, cancelarAlheio.out.trim());

  const notas = await como(CLI1, `SELECT count(*) FROM public.client_notes;`);
  check("cliente não lê notas internas", linhas(notas.out) === 0, notas.out.trim());

  // Duas barbearias: a autorização é a identidade, não o tenant.
  await psql(`
INSERT INTO public.services (id, barbershop_id, barber_id, name, duration_minutes, price, active)
VALUES ('${SV2.slice(0, -1)}9','${BS2}','${BRB}','Corte B', 30, 50, true) ON CONFLICT DO NOTHING;
INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, date, start_time, end_time, status)
VALUES ('${BS2}','${CLI1}','${BRB}','${SV2.slice(0, -1)}9', DATE '${DIA}', '15:00', '15:30', 'scheduled')
ON CONFLICT DO NOTHING;`);
  const duasLojas = await como(
    CLI1,
    `SELECT count(DISTINCT barbershop_id) FROM public.appointments WHERE client_id = '${CLI1}';`,
  );
  check("cliente enxerga reservas de DUAS barbearias", linhas(duasLojas.out) === 2, duasLojas.out.trim());
}

async function testAtaques() {
  group("campos administrativos bloqueados");
  const casos = [
    ["status -> completed", `status='completed'`, "appointment_status_forbidden"],
    ["status -> no_show", `status='no_show'`, "appointment_status_forbidden"],
    ["troca de serviço (R$40 -> R$200)", `service_id='${SV2}'`, "appointment_field_locked"],
    ["move para outra barbearia", `barbershop_id='${BS2}'`, "appointment_field_locked"],
    ["troca de profissional", `barber_id='${CLI2}'`, "appointment_field_locked"],
    ["transfere o titular", `client_id='${CLI2}'`, "appointment_field_locked"],
  ];
  for (const [nome, sets, esperado] of casos) {
    const r = await como(CLI1, editar(sets));
    check(`${nome} → recusado`, recusaDe(r.out) === esperado, `${recusaDe(r.out) ?? r.out.trim().slice(-160)}`);
  }

  group("reagendamento revalidado no banco");
  const fora = [
    ["fora da grade (sábado)", `date=DATE '2026-09-12', start_time='10:00', end_time='10:30'`, "appointment_slot_unavailable"],
    ["após o expediente (19:00)", `date=DATE '${OUTRA_QUINTA}', start_time='19:00', end_time='19:30'`, "appointment_slot_unavailable"],
    ["estica a duração (30 → 360 min)", `end_time='16:00'`, "appointment_duration_mismatch"],
    ["joga para o passado", `date=DATE '2020-01-02', start_time='10:00', end_time='10:30'`, "appointment_reschedule_past"],
  ];
  for (const [nome, sets, esperado] of fora) {
    const r = await como(CLI1, editar(sets));
    check(`${nome} → recusado`, recusaDe(r.out) === esperado, `${recusaDe(r.out) ?? r.out.trim().slice(-160)}`);
  }

  // Dia bloqueado pelo profissional.
  await psql(`
INSERT INTO public.schedule_blocks (barbershop_id, barber_id, block_date, reason)
VALUES ('${BS1}','${BRB}', DATE '${OUTRA_QUINTA}', 'harness') ON CONFLICT DO NOTHING;`);
  const bloqueado = await como(
    CLI1,
    editar(`date=DATE '${OUTRA_QUINTA}', start_time='14:00', end_time='14:30'`),
  );
  check(
    "dia bloqueado pelo profissional → recusado",
    recusaDe(bloqueado.out) === "appointment_slot_unavailable",
    recusaDe(bloqueado.out) ?? bloqueado.out.trim().slice(-160),
  );
  await psql(`DELETE FROM public.schedule_blocks WHERE barbershop_id = '${BS1}';`);

  group("operações legítimas do cliente");
  const reagendar = await como(
    CLI1,
    editar(`date=DATE '${OUTRA_QUINTA}', start_time='14:00', end_time='14:30'`),
  );
  check("reagenda dentro da grade", linhas(reagendar.out) === 1, reagendar.out.trim().slice(-160));

  const cancelar = await como(CLI1, editar(`status='cancelled'`));
  check("cancela a própria reserva", linhas(cancelar.out) === 1, cancelar.out.trim().slice(-160));

  group("equipe não foi afetada");
  const concluir = await como(BRB, editar(`status='completed'`));
  check("barbeiro marca concluído", linhas(concluir.out) === 1, concluir.out.trim().slice(-160));
  const falta = await como(BRB, editar(`status='no_show'`));
  check("barbeiro marca falta", linhas(falta.out) === 1, falta.out.trim().slice(-160));
  const encaixe = await como(BRB, editar(`date=DATE '2026-12-25', start_time='03:00', end_time='09:00'`));
  check("barbeiro reagenda livremente (encaixe)", linhas(encaixe.out) === 1, encaixe.out.trim().slice(-160));
}

async function testStatusEncerrados() {
  group("status encerrados");
  await psql(`UPDATE public.appointments SET status='completed' WHERE id='${APT1}';`);
  const cancelarConcluido = await como(CLI1, editar(`status='cancelled'`));
  check(
    "cliente não cancela reserva concluída",
    recusaDe(cancelarConcluido.out) === "appointment_not_cancellable",
    recusaDe(cancelarConcluido.out) ?? cancelarConcluido.out.trim().slice(-160),
  );

  await psql(`UPDATE public.appointments SET status='no_show' WHERE id='${APT1}';`);
  const cancelarFalta = await como(CLI1, editar(`status='cancelled'`));
  check(
    "cliente não cancela reserva com falta",
    recusaDe(cancelarFalta.out) === "appointment_not_cancellable",
    recusaDe(cancelarFalta.out) ?? cancelarFalta.out.trim().slice(-160),
  );
  await restaurarApt1();
}

async function testBloqueio() {
  group("cliente bloqueado por falta");
  // `blocked_by` é NOT NULL: o bloqueio manual sempre tem um responsável.
  const criouBloqueio = await psql(`
INSERT INTO public.client_blocks (barbershop_id, client_id, blocked_until, reason, blocked_by)
VALUES ('${BS1}','${CLI1}', now() + interval '10 days', 'harness', '${BRB}');`);
  if (/^ERROR:/m.test(criouBloqueio.out)) {
    check("bloqueio de teste criado", false, criouBloqueio.out.trim().slice(-200));
    return;
  }

  const veProprio = await como(
    CLI1,
    `SELECT count(*) FROM public.client_blocks WHERE client_id = '${CLI1}';`,
  );
  check("vê o próprio bloqueio ativo", linhas(veProprio.out) === 1, veProprio.out.trim());

  const veAlheio = await como(
    CLI2,
    `SELECT count(*) FROM public.client_blocks WHERE client_id = '${CLI1}';`,
  );
  check("não vê bloqueio de outro cliente", linhas(veAlheio.out) === 0, veAlheio.out.trim());

  const apagaProprio = await como(
    CLI1,
    `WITH d AS (DELETE FROM public.client_blocks WHERE client_id = '${CLI1}' RETURNING 1) SELECT count(*) FROM d;`,
  );
  check("não consegue apagar o próprio bloqueio", linhas(apagaProprio.out) === 0, apagaProprio.out.trim());

  // Regra atual do produto: o bloqueio impede CRIAR (policy de INSERT), mas não
  // mexe no que já existe.
  const criar = await como(
    CLI1,
    `INSERT INTO public.appointments (barbershop_id, client_id, barber_id, service_id, date, start_time, end_time)
     VALUES ('${BS1}','${CLI1}','${BRB}','${SV1}', DATE '${OUTRA_QUINTA}', '16:00', '16:30');`,
  );
  check(
    "bloqueado não cria nova reserva",
    /row-level security/i.test(criar.out),
    criar.out.trim().slice(-160),
  );

  const cancelarBloqueado = await como(CLI1, editar(`status='cancelled'`));
  check("bloqueado ainda cancela reserva existente", linhas(cancelarBloqueado.out) === 1, cancelarBloqueado.out.trim().slice(-160));

  await psql(`DELETE FROM public.client_blocks WHERE barbershop_id = '${BS1}';`);
}

async function testConcorrencia() {
  group("concorrência");

  // 1) Dois cancelamentos simultâneos da MESMA reserva.
  await restaurarApt1();
  const c1 = comoCommit(
    CLI1,
    `WITH u AS (UPDATE public.appointments SET status='cancelled'
                 WHERE id='${APT1}' AND status='scheduled' RETURNING 1)
     SELECT count(*) AS n FROM u; SELECT pg_sleep(1);`,
  );
  await new Promise((r) => setTimeout(r, 200));
  const c2 = comoCommit(
    CLI1,
    `WITH u AS (UPDATE public.appointments SET status='cancelled'
                 WHERE id='${APT1}' AND status='scheduled' RETURNING 1)
     SELECT count(*) AS n FROM u;`,
  );
  const [r1, r2] = await Promise.all([c1, c2]);
  const total = (linhas(r1.out) ?? 0) + (linhas(r2.out) ?? 0);
  check("dois cancelamentos simultâneos: só um altera a linha", total === 1, `${linhas(r1.out)} + ${linhas(r2.out)}`);

  const estado = await psql(`SELECT status FROM public.appointments WHERE id='${APT1}';`);
  check("estado final é 'cancelled'", estado.out.includes("cancelled"), estado.out.trim());

  // 2) Duas contas disputando o MESMO horário no reagendamento.
  await restaurarApt1();
  await psql(`
UPDATE public.appointments SET status='scheduled', date=DATE '${DIA}', start_time='11:00', end_time='11:30'
 WHERE id='${APT2}';`);

  const alvo = `date=DATE '${OUTRA_QUINTA}', start_time='14:00', end_time='14:30'`;
  const a = comoCommit(
    CLI1,
    `WITH u AS (UPDATE public.appointments SET ${alvo} WHERE id='${APT1}' RETURNING 1) SELECT count(*) AS n FROM u;
     SELECT pg_sleep(2);`,
  );
  await new Promise((r) => setTimeout(r, 500));
  const b = comoCommit(
    CLI2,
    `WITH u AS (UPDATE public.appointments SET ${alvo} WHERE id='${APT2}' RETURNING 1) SELECT count(*) AS n FROM u;`,
  );
  const [ra, rb] = await Promise.all([a, b]);
  const conflito = /appointments_no_overlap_per_barber/.test(rb.out) || /appointments_no_overlap_per_barber/.test(ra.out);
  check("duas contas no mesmo horário: uma vence", conflito, `${ra.out.trim().slice(-120)} | ${rb.out.trim().slice(-120)}`);

  const sobreviventes = await psql(`
SELECT count(*) FROM public.appointments
 WHERE barber_id='${BRB}' AND date=DATE '${OUTRA_QUINTA}' AND start_time='14:00' AND status <> 'cancelled';`);
  check("nenhuma duplicação no horário disputado", linhas(sobreviventes.out) === 1, sobreviventes.out.trim());

  const perdedor = await psql(`SELECT status, date, start_time FROM public.appointments WHERE id='${APT2}';`);
  check(
    "o agendamento do perdedor foi preservado",
    perdedor.out.includes("scheduled") && perdedor.out.includes("11:00"),
    perdedor.out.trim().slice(-160),
  );

  await restaurarApt1();
}

/* ------------------------------ runner ----------------------------- */

async function main() {
  const ping = await psql("SELECT 1;");
  if (ping.code !== 0) {
    console.log(
      `\nPULADO — Postgres local indisponível (container "${CONTAINER}").\n` +
        `Suba o stack com "npx supabase start" e rode de novo.`,
    );
    process.exit(0);
  }

  group("pré-condição");
  const trigger = await psql(
    `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_enforce_client_appointment_transition';`,
  );
  check(
    "trigger de transições do cliente existe",
    trigger.out.includes("trg_enforce_client_appointment_transition"),
    'rode "npx supabase db reset --local --no-seed"',
  );

  if (await semear()) {
    try {
      await testIsolamento();
      await testPrivacidadeDeProfiles();
      await testAtaques();
      await testStatusEncerrados();
      await testBloqueio();
      await testConcorrencia();
    } finally {
      await limpar();
    }
  }

  const saida = [];
  let passed = 0;
  let failed = 0;
  let printed = "";
  for (const item of checks) {
    if (item.group !== printed) {
      saida.push(`\n▸ ${item.group}`);
      printed = item.group;
    }
    if (item.ok) passed += 1;
    else failed += 1;
    saida.push(`${item.ok ? "  ✓" : "  ✗"} ${item.name}${item.detail && !item.ok ? `  — ${item.detail}` : ""}`);
  }
  saida.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  console.log(saida.join("\n"));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
