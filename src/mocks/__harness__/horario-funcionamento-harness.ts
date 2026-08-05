/**
 * Harness do horário de funcionamento da barbearia (migration 20260805170000).
 *
 * O sistema não tinha o conceito: `weekly_schedule` é por PROFISSIONAL, e a aba
 * rotulada "Horários de Funcionamento" mostrava a grade pessoal de quem estava
 * logado. Nada dizia "esta casa atende das 9 às 18", e nada impedia um barbeiro
 * de se cadastrar das 6h às 23h.
 *
 * Este é o PR 1 de 3: schema e validação, sem tela e sem exposição pública.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS DUAS INVARIANTES QUE ESTE ARQUIVO EXISTE PARA TRAVAR
 *
 *   1. LINHA AUSENTE ≠ FECHADO. Sem envelope para o dia, não há restrição — é
 *      isto que faz a migration não quebrar as barbearias de hoje. Se alguém
 *      inverter esse padrão, todas as grades existentes viram inválidas de uma
 *      vez, e o primeiro teste abaixo cai;
 *   2. A REGRA NÃO É CONTORNÁVEL PELA ORDEM. Sem o segundo trigger, bastaria
 *      envelope largo → turno fora → envelope apertado. O grupo "apertar o
 *      expediente" é o que prova que esse caminho está fechado.
 *
 * E uma decisão que parece frouxidão e não é: turno INATIVO não é validado. É o
 * que permite ao admin desativar os conflitos quando aperta o expediente — sem
 * isso ele ficaria preso entre os dois triggers, sem saída.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows, setTableRows } from "@/mocks/store";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_B_ID,
  MOCK_SUPER_ADMIN_EMAIL,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

const ROOT = process.cwd();
const MIGRATION = path.join(ROOT, "supabase", "migrations", "20260805170000_business_hours.sql");

/** Segunda-feira: o dia usado em quase todos os cenários. */
const SEGUNDA = 1;
/** Terça: usado onde é preciso um dia SEM envelope, para provar a ausência. */
const TERCA = 2;

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function group(titulo: string) {
  linhas.push(`\n▸ ${titulo}`);
}

function check(nome: string, ok: boolean, detalhe = "") {
  if (ok) {
    passou++;
    linhas.push(`  ✓ ${nome}`);
  } else {
    falhou++;
    linhas.push(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function login(email: string) {
  const res = await mockSupabaseClient.auth.signInWithPassword({ email, password: "qualquer-senha" });
  if (res.error || !res.data.session) throw new Error(`Falha no login fictício: ${email}`);
}

/** Zera o cenário: sem envelope e sem turnos na segunda da barbearia A. */
function limparSegunda() {
  setTableRows("business_hours", []);
  setTableRows(
    "weekly_schedule",
    getTableRows("weekly_schedule").filter(
      (t) => !(t.barbershop_id === MOCK_BARBERSHOP_ID && Number(t.day_of_week) === SEGUNDA),
    ),
  );
}

async function definirExpediente(campos: Record<string, unknown>) {
  return (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: SEGUNDA,
    ...campos,
  });
}

async function cadastrarTurno(campos: Record<string, unknown>) {
  return (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberAna,
    day_of_week: SEGUNDA,
    is_active: true,
    ...campos,
  });
}

/* ══════════ 1. sem envelope, nada muda ══════════ */

async function testeSemEnvelope() {
  group("envelope ausente: compatibilidade com o que já existe");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();

  check("a tabela de expediente nasce vazia", getTableRows("business_hours").length === 0);

  const madrugada = await cadastrarTurno({ start_time: "06:00", end_time: "23:00" });
  check(
    "turno das 06:00 às 23:00 é aceito quando não há expediente definido",
    madrugada.error === null,
    madrugada.error?.message ?? "",
  );

  // O dia SEM envelope continua livre mesmo quando OUTRO dia já tem.
  await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  const outroDia = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberBruno,
    day_of_week: TERCA,
    start_time: "07:00",
    end_time: "22:00",
    is_active: true,
  });
  check(
    "expediente da segunda não restringe a terça",
    outroDia.error === null,
    outroDia.error?.message ?? "",
  );
  check(
    "ausência de linha é 'sem restrição', não 'fechado'",
    outroDia.error === null,
    "se algum dia isto inverter, toda grade existente vira inválida de uma vez",
  );
}

/* ══════════ 2. turno contra o envelope ══════════ */

async function testeTurnoContraEnvelope() {
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await definirExpediente({ open_time: "09:00", close_time: "18:00" });

  group("turno dentro do expediente");

  const dentro = await cadastrarTurno({ start_time: "09:00", end_time: "18:00" });
  check("turno igual ao envelope passa (bordas inclusivas)", dentro.error === null, dentro.error?.message ?? "");

  const folgado = await cadastrarTurno({ start_time: "10:00", end_time: "17:00", barber_id: MOCK_USER_IDS.barberBruno });
  check("turno mais estreito passa", folgado.error === null, folgado.error?.message ?? "");

  group("turno fora do expediente");

  const cedo = await cadastrarTurno({ start_time: "08:00", end_time: "12:00", barber_id: MOCK_USER_IDS.admin });
  check("abrir antes do expediente é recusado", cedo.error !== null, cedo.error?.message ?? "sem erro");
  check(
    "a mensagem diz o expediente e o turno",
    (cedo.error?.message ?? "").includes("09:00") &&
      (cedo.error?.message ?? "").includes("18:00") &&
      (cedo.error?.message ?? "").includes("08:00"),
    cedo.error?.message ?? "",
  );
  check(
    "e diz o que fazer, sem detalhe técnico",
    (cedo.error?.message ?? "").includes("ampliar o funcionamento") &&
      !/SQLSTATE|constraint|trigger|null/i.test(cedo.error?.message ?? ""),
    cedo.error?.message ?? "",
  );

  const tarde = await cadastrarTurno({ start_time: "14:00", end_time: "20:00", barber_id: MOCK_USER_IDS.admin });
  check("fechar depois do expediente é recusado", tarde.error !== null, tarde.error?.message ?? "sem erro");

  const engloba = await cadastrarTurno({ start_time: "07:00", end_time: "23:00", barber_id: MOCK_USER_IDS.admin });
  check("turno que engloba o expediente é recusado", engloba.error !== null, engloba.error?.message ?? "sem erro");

  group("turno inativo não é validado (é a saída do admin)");

  const inativo = await cadastrarTurno({
    start_time: "06:00",
    end_time: "23:00",
    is_active: false,
    barber_id: MOCK_USER_IDS.admin,
  });
  check(
    "turno fora do expediente é aceito quando inativo",
    inativo.error === null,
    inativo.error?.message ?? "",
  );

  const reativar = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: true })
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("barber_id", MOCK_USER_IDS.admin)
    .eq("start_time", "06:00");
  check(
    "mas REATIVAR o mesmo turno é recusado",
    reativar.error !== null,
    reativar.error?.message ?? "sem erro",
  );
}

/* ══════════ 3. dia fechado ══════════ */

async function testeDiaFechado() {
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();

  group("dia fechado não aceita turno nenhum");

  const fechado = await definirExpediente({ is_closed: true });
  check("marca a segunda como fechada", fechado.error === null, fechado.error?.message ?? "");

  const tentativa = await cadastrarTurno({ start_time: "09:00", end_time: "18:00" });
  check("turno em dia fechado é recusado", tentativa.error !== null, tentativa.error?.message ?? "sem erro");
  check(
    "a mensagem nomeia o dia",
    (tentativa.error?.message ?? "").includes("segunda-feira"),
    tentativa.error?.message ?? "",
  );

  group("coerência da própria linha de expediente");

  const incoerente = await (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: 3,
    is_closed: true,
    open_time: "09:00",
    close_time: "18:00",
  });
  check("dia fechado COM horário é recusado", incoerente.error !== null, incoerente.error?.message ?? "sem erro");

  const invertido = await (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: 4,
    open_time: "18:00",
    close_time: "09:00",
  });
  check(
    "fechar antes de abrir é recusado (sem virada de dia)",
    invertido.error !== null,
    invertido.error?.message ?? "sem erro",
  );

  const semHorario = await (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: 5,
  });
  check("dia aberto sem horário é recusado", semHorario.error !== null, semHorario.error?.message ?? "sem erro");

  const duplicado = await definirExpediente({ open_time: "10:00", close_time: "16:00" });
  check("dois expedientes para o mesmo dia é recusado", duplicado.error !== null, duplicado.error?.message ?? "sem erro");
}

/* ══════════ 4. apertar o expediente com turno já cadastrado ══════════ */

async function testeApertarExpediente() {
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();

  group("apertar o expediente: a regra não é contornável pela ordem");

  // Sem envelope, o turno largo entra.
  const largo = await cadastrarTurno({ start_time: "08:00", end_time: "20:00" });
  check("turno 08:00–20:00 entra antes de existir expediente", largo.error === null, largo.error?.message ?? "");

  // Agora o admin tenta apertar: é aqui que a ordem seria explorada.
  const aperta = await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  check("definir expediente que deixa o turno de fora é recusado", aperta.error !== null, aperta.error?.message ?? "sem erro");
  check(
    "a mensagem LISTA o conflito, com nome e faixa",
    (aperta.error?.message ?? "").includes("08:00") && (aperta.error?.message ?? "").includes("20:00"),
    aperta.error?.message ?? "",
  );
  check(
    "e diz as duas saídas possíveis",
    (aperta.error?.message ?? "").includes("Amplie") && (aperta.error?.message ?? "").includes("desative"),
    aperta.error?.message ?? "",
  );
  check("nada foi gravado", getTableRows("business_hours").length === 0);
  check(
    "e o turno de outra pessoa segue intacto",
    getTableRows("weekly_schedule").some(
      (t) => t.barbershop_id === MOCK_BARBERSHOP_ID && t.start_time === "08:00" && t.is_active !== false,
    ),
    "nunca apagar nem aparar dado alheio é o ponto desta regra",
  );

  group("apertar o expediente: a saída do admin funciona");

  const desativa = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: false })
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("day_of_week", SEGUNDA)
    .eq("start_time", "08:00");
  check("desativar o turno em conflito é permitido", desativa.error === null, desativa.error?.message ?? "");

  const agora = await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  check("e então o expediente entra", agora.error === null, agora.error?.message ?? "");

  group("expediente que NÃO conflita passa direto");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await cadastrarTurno({ start_time: "10:00", end_time: "16:00" });
  const compativel = await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  check("expediente que engloba os turnos existentes é aceito", compativel.error === null, compativel.error?.message ?? "");
}

/* ══════════ 5. sem exceção para super_admin ══════════ */

async function testeSuperAdmin() {
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await definirExpediente({ open_time: "09:00", close_time: "18:00" });

  group("a validação não abre exceção para super_admin");

  await login(MOCK_SUPER_ADMIN_EMAIL);

  const foraComoSuper = await cadastrarTurno({ start_time: "06:00", end_time: "12:00" });
  check(
    "super_admin também não grava turno fora do expediente",
    foraComoSuper.error !== null,
    foraComoSuper.error?.message ?? "sem erro",
  );
  check(
    "com a MESMA mensagem, sem tratamento especial",
    (foraComoSuper.error?.message ?? "").includes("fica fora do expediente"),
    foraComoSuper.error?.message ?? "",
  );

  // Poder escrever é outra coisa: ele PODE definir expediente, não pode
  // definir errado. Sem isso ninguém conserta tenant com problema.
  const superDefine = await (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_B_ID,
    day_of_week: SEGUNDA,
    open_time: "08:00",
    close_time: "20:00",
  });
  check(
    "mas super_admin PODE definir expediente de qualquer barbearia",
    superDefine.error === null,
    superDefine.error?.message ?? "",
  );

  group("escrita é da administração do tenant");

  await login("ana@barbearia.teste");
  const barbeiroTenta = await (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: 6,
    open_time: "09:00",
    close_time: "13:00",
  });
  check(
    "barbeiro comum não define expediente",
    barbeiroTenta.error !== null,
    barbeiroTenta.error?.message ?? "sem erro",
  );
}

/* ══════════ 6. a migration ══════════ */

function testeMigration() {
  const sql = readFileSync(MIGRATION, "utf8");
  const codigo = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration: tabela");

  check("cria business_hours", /CREATE TABLE IF NOT EXISTS public\.business_hours/.test(codigo));
  check("FK para barbershops com cascade", /REFERENCES public\.barbershops\(id\) ON DELETE CASCADE/.test(codigo));
  check("day_of_week entre 0 e 6", /CHECK \(day_of_week BETWEEN 0 AND 6\)/.test(codigo));
  check("um expediente por dia", /UNIQUE \(barbershop_id, day_of_week\)/.test(codigo));
  check(
    "CHECK de coerência: fechado sem horário, aberto com abre < fecha",
    /is_closed AND open_time IS NULL AND close_time IS NULL/.test(codigo) &&
      /NOT is_closed AND open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time/.test(codigo),
  );
  check("documenta que ausência não é fechado", /LINHA AUSENTE ≠ FECHADO/.test(sql));

  group("migration: RLS e grants");

  check("liga RLS", /ALTER TABLE public\.business_hours ENABLE ROW LEVEL SECURITY/.test(codigo));
  check("equipe lê", /CREATE POLICY "Staff can view business hours of their barbershop"/.test(codigo));
  check("administração escreve", /CREATE POLICY "Admins manage business hours of their barbershop"/.test(codigo));
  check("concede CRUD nominal a authenticated", /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.business_hours TO authenticated/.test(codigo));
  check(
    "NÃO concede nada a anon",
    !/GRANT[^;]*business_hours[^;]*TO[^;]*anon/i.test(codigo),
    "a leitura pública é do PR 3, por RPC SECURITY DEFINER",
  );

  group("migration: triggers");

  check("trigger em weekly_schedule", /CREATE TRIGGER trg_enforce_shift_within_business_hours[\s\S]{0,120}BEFORE INSERT OR UPDATE ON public\.weekly_schedule/.test(codigo));
  check("trigger em business_hours", /CREATE TRIGGER trg_business_hours_fit_shifts[\s\S]{0,120}BEFORE INSERT OR UPDATE ON public\.business_hours/.test(codigo));
  check("as duas funções são SECURITY DEFINER", (codigo.match(/SECURITY DEFINER/g) ?? []).length >= 2);
  check("com search_path fixo", (codigo.match(/SET search_path TO 'public'/g) ?? []).length >= 2);
  check("usam check_violation", (codigo.match(/ERRCODE = 'check_violation'/g) ?? []).length >= 3);
  check("ausência de envelope passa livre", /IF NOT FOUND THEN\s*\n\s*RETURN NEW;/.test(codigo));
  check("turno inativo não é validado", /IF NOT COALESCE\(NEW\.is_active, true\) THEN/.test(codigo));
  check("só turnos ativos contam como conflito", /AND w\.is_active/.test(codigo));
  check("o conflito é listado, não apagado", /string_agg/.test(codigo) && !/DELETE FROM public\.weekly_schedule/i.test(codigo));
  check("nenhum UPDATE silencioso em grade alheia", !/UPDATE public\.weekly_schedule/i.test(codigo));

  group("migration: forma");

  check("nenhum DROP TABLE no código executável", !/DROP TABLE/i.test(codigo));
  check("documenta rollback", /ROLLBACK/.test(sql));
  check("registra que a tabela nasce vazia", /tabela nasce vazia/.test(sql));
  check("explica por que turno inativo escapa", /preso entre dois triggers/.test(sql));
}

/* ══════════ 7. paridade mock ↔ SQL ══════════ */

function testeParidade() {
  group("paridade entre mock e migration");

  const regras = readFileSync(path.join(ROOT, "src", "mocks", "rules.ts"), "utf8");
  check("mock valida o expediente", regras.includes("validateBusinessHours"));
  check("mock valida o turno contra o expediente", regras.includes("validateShiftWithinBusinessHours"));
  check("mock cita a migration", regras.includes("20260805170000"));
  check("mock trata ausência de envelope como sem restrição", /Ausência de envelope = sem restrição/.test(regras));
  check("mock ignora turno inativo", /if \(!ativo\) return null;/.test(regras));
  check("mock só conta turno ativo como conflito", /if \(turno\.is_active === false\) return false;/.test(regras));
  check("mock autoriza escrita só para administração", regras.includes("authorizeBusinessHours"));

  const builder = readFileSync(path.join(ROOT, "src", "mocks", "query-builder.ts"), "utf8");
  check("query-builder liga business_hours", /case "business_hours":/.test(builder));
  check("e passa a grade pela validação nova", /return validateWeeklySchedule\(row, existing\)/.test(builder));
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  resetMockDatabase();

  await testeSemEnvelope();
  await testeTurnoContraEnvelope();
  await testeDiaFechado();
  await testeApertarExpediente();
  await testeSuperAdmin();
  testeMigration();
  testeParidade();

  resetMockDatabase();
  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
