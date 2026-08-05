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
const MIGRATION_RPC = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260805180000_business_hours_apply_with_conflicts.sql",
);

function lerArquivo(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Fonte sem comentário. As asserções de "a tela FAZ x" precisam olhar código —
 * vários destes arquivos explicam em prosa o que deixaram de fazer, e a prosa
 * casaria com o regex.
 */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

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

/**
 * Cada ação é feita por QUEM a faz de verdade.
 *
 * Não é preciosismo: a policy de `weekly_schedule` deixa cada pessoa gerenciar
 * só a própria grade (`barber_id = auth.uid()`), e o mock passou a espelhar
 * isso nesta frente. Um helper que criasse turno alheio logado como admin
 * "provaria" um fluxo que o banco recusa — foi exatamente o que estes testes
 * faziam antes, e o que a regra nova revelou.
 */
const EMAIL_DE: Record<string, string> = {
  [MOCK_USER_IDS.admin]: MOCK_ADMIN_EMAIL,
  [MOCK_USER_IDS.barberAna]: "ana@barbearia.teste",
  [MOCK_USER_IDS.barberBruno]: "bruno@barbearia.teste",
};

/** Expediente é da administração. */
async function definirExpediente(campos: Record<string, unknown>) {
  await login(MOCK_ADMIN_EMAIL);
  return (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: SEGUNDA,
    ...campos,
  });
}

/** Grade é de cada profissional — entra logado como o dono do turno. */
async function cadastrarTurno(campos: Record<string, unknown>) {
  const dono = String(campos.barber_id ?? MOCK_USER_IDS.barberAna);
  await login(EMAIL_DE[dono] ?? MOCK_ADMIN_EMAIL);
  return (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: dono,
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
  await login("bruno@barbearia.teste");
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

  group("apertar o expediente: a saída do admin é a RPC, não o UPDATE direto");

  // O admin NÃO pode desativar turno alheio pelo caminho comum — a policy de
  // UPDATE de weekly_schedule não o inclui. Esta é a razão de existir a RPC:
  await login(MOCK_ADMIN_EMAIL);
  const tentaDireto = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: false })
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("day_of_week", SEGUNDA)
    .eq("start_time", "08:00");
  check(
    "admin NÃO desativa turno alheio pelo UPDATE direto",
    tentaDireto.error !== null,
    tentaDireto.error?.message ?? "sem erro",
  );

  const viaRpc = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: true,
  });
  check("mas a RPC resolve e salva", !viaRpc.error, JSON.stringify(viaRpc.error));
  check("desativando exatamente 1 turno", viaRpc.data?.deactivated === 1, JSON.stringify(viaRpc.data));
  check("e o expediente entra", getTableRows("business_hours").length === 1);

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

  // cadastrarTurno entra como o DONO do turno; para as asserções seguintes
  // valerem para o super_admin, o turno é criado por ele.
  await login(MOCK_SUPER_ADMIN_EMAIL);
  const foraComoSuper = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberAna,
    day_of_week: SEGUNDA,
    start_time: "06:00",
    end_time: "12:00",
    is_active: true,
  });
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

/* ══════════ 6. a RPC de aplicar com resolução de conflito ══════════ */

async function testeRpcAplicar() {
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();

  group("apply_business_hours: o caminho normal");

  const semConflito = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: false,
  });
  check("salva o expediente quando não há conflito", !semConflito.error, JSON.stringify(semConflito.error));
  check("e nada foi desativado", semConflito.data?.deactivated === 0, JSON.stringify(semConflito.data));

  group("apply_business_hours: recusa quando há conflito e não foi mandado resolver");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await cadastrarTurno({ start_time: "08:00", end_time: "20:00" });
  // `cadastrarTurno` entra como o dono do turno; a RPC é da administração.
  await login(MOCK_ADMIN_EMAIL);

  const recusa = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: false,
  });
  check("recusa sem _deactivate_conflicts", Boolean(recusa.error), JSON.stringify(recusa.error));
  check("com a mensagem que lista o conflito", String(recusa.error?.message ?? "").includes("08:00"), String(recusa.error?.message));
  check("e o turno segue ATIVO", getTableRows("weekly_schedule").some((t) => t.start_time === "08:00" && t.is_active !== false));
  check("e o expediente NÃO foi gravado", getTableRows("business_hours").length === 0);

  group("apply_business_hours: resolve quando mandado, sem apagar nada");

  const resolve = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: true,
  });
  check("aceita com _deactivate_conflicts", !resolve.error, JSON.stringify(resolve.error));
  check("informa quantos desativou", resolve.data?.deactivated === 1, JSON.stringify(resolve.data));
  check("o expediente entrou", getTableRows("business_hours").length === 1);

  const turno = getTableRows("weekly_schedule").find((t) => t.start_time === "08:00");
  check("o turno NÃO foi apagado", Boolean(turno), "desativar nunca é apagar");
  check("apenas desativado", turno?.is_active === false, String(turno?.is_active));

  group("apply_business_hours: autorização");

  await login("ana@barbearia.teste");
  const barbeiroTenta = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: 3,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: true,
  });
  check("barbeiro comum é recusado", Boolean(barbeiroTenta.error), JSON.stringify(barbeiroTenta.error));
  check(
    "e a recusa é de privilégio, não de regra",
    String(barbeiroTenta.error?.code ?? "").includes("insufficient_privilege"),
    String(barbeiroTenta.error?.code),
  );
}

/* ══════════ 7. o mock reflete quem pode mexer na grade alheia ══════════ */

async function testeGradeAlheia() {
  resetMockDatabase();
  group("grade alheia: só a própria pessoa (e o super_admin)");

  await login(MOCK_ADMIN_EMAIL);
  const linhaDaAna = getTableRows("weekly_schedule").find(
    (t) => t.barber_id === MOCK_USER_IDS.barberAna && t.barbershop_id === MOCK_BARBERSHOP_ID,
  );
  const adminTenta = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: false })
    .eq("id", String(linhaDaAna?.id));
  check(
    "admin_barbearia NÃO desativa turno de outro profissional",
    Boolean(adminTenta.error),
    adminTenta.error?.message ?? "sem erro",
  );
  check(
    "é ESTA a razão de a resolução de conflito precisar de RPC",
    Boolean(adminTenta.error),
    "a policy de UPDATE de weekly_schedule não inclui admin_barbearia",
  );

  await login(MOCK_SUPER_ADMIN_EMAIL);
  const superTenta = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: false })
    .eq("id", String(linhaDaAna?.id));
  check("super_admin alcança", !superTenta.error, superTenta.error?.message ?? "");
}

/* ══════════ 8. a tela ══════════ */

function testeTela() {
  const editor = lerArquivo("src/components/BusinessHoursEditor.tsx");
  const semComent = semComentarios(editor);
  const dash = lerArquivo("src/components/BarberDashboard.tsx");

  group("aba Horários: duas seções nomeadas pelo que são");

  check("o título enganoso saiu do cabeçalho da aba", !/>Horários de Funcionamento</.test(dash));
  check("existe a seção do expediente da barbearia", dash.includes("Funcionamento da barbearia"));
  check("existe a seção pessoal", dash.includes("Minha agenda"));
  check("e ela diz que vale só para quem está logado", /Vale só para você|vale só para você/.test(dash));
  check("a aba passa isAdmin para a seção", /<ScheduleTab isAdmin=\{isAdmin\} \/>/.test(dash));
  check("o editor recebe canEdit do papel", /<BusinessHoursEditor barbershopId=\{resolvedBarbershopId\} canEdit=\{isAdmin\} \/>/.test(dash));

  group("expediente: exibição por papel");

  check("os 7 dias são renderizados", /DIAS\.map/.test(semComent) && (editor.match(/valor: [0-6]/g) ?? []).length === 7);
  check("admin edita: toggle e campos de hora", /<Switch/.test(semComent) && /type="time"/.test(semComent));
  check("barbeiro só lê: sem Switch quando canEdit é falso", /canEdit \? \(/.test(semComent));
  check("e vê o aviso de que o limite é da administração", editor.includes("Definido pela administração"));
  check(
    "distingue 'sem restrição' de 'fechado'",
    editor.includes("Sem restrição") && editor.includes("não há limite"),
    "linha ausente não é dia fechado — é o ponto que a tela não pode confundir",
  );

  group("fluxo de conflito");

  check("não resolve sozinho: exige segundo clique", editor.includes("Desativar esses turnos e salvar"));
  check("mostra a mensagem do banco", /mensagemDeConflito/.test(semComent));
  check("lista os turnos com nome e faixa", /listaDeConflito\.map/.test(semComent));
  check("avisa que nada é apagado", editor.includes("não são apagados"));
  check("oferece cancelar", editor.includes("Cancelar"));
  check(
    "a lista vem de CONSULTA, não de parsing da mensagem",
    /from\("weekly_schedule"\)[\s\S]{0,200}is_active/.test(semComent) && !/split\(.*mensagem/.test(semComent),
    "depender do texto do trigger seria depender de prosa",
  );
  check("usa a RPC para salvar", semComent.includes("apply_business_hours"));
  check("e passa o sinalizador explícito", /_deactivate_conflicts: desativarConflitos/.test(semComent));

  group("erros: mensagem do banco quando é regra de negócio");

  const grade = semComentarios(lerArquivo("src/components/WeeklyScheduleEditor.tsx"));
  check("WeeklyScheduleEditor trata 23514 no INSERT", /error\.code === "23514"/.test(grade));
  check("mostra a mensagem, não um texto genérico", (grade.match(/toast\.error\(error\.message\)/g) ?? []).length >= 2);
  check("e também no toggle (reativar turno fora)", /handleToggle[\s\S]{0,400}23514/.test(grade));
  check("falha de carga não vira lista vazia", /erroCarga/.test(semComent));

  group("layout (§3): nada de largura fixa que possa estourar");

  check(
    "a linha do dia usa flex-wrap",
    /flex flex-wrap items-center/.test(semComent),
    "sem wrap, os 4 blocos do dia estouram em tela estreita",
  );
  check("o nome do dia tem largura MÍNIMA, não fixa", /min-w-\[7\.5rem\]/.test(semComent));
  check("os campos de hora têm largura fixa pequena e previsível", /w-\[7\.5rem\]/.test(semComent));
  check("o painel de conflito também quebra", /flex flex-wrap gap-2 pt-1/.test(semComent));
  check(
    "variantes de breakpoint são strings literais",
    /hidden sm:inline/.test(semComent) && /sm:hidden/.test(semComent) && !/\$\{[^}]*\}:(inline|hidden)/.test(semComent),
    "Tailwind não gera classe montada por interpolação (§3.6)",
  );
  check(
    "o dia tem versão curta para tela estreita",
    /curto: "Dom"/.test(semComent) && /\{dia\.curto\}/.test(semComent),
    "'Segunda-feira' em 390px empurraria os campos para fora",
  );
}

/* ══════════ 9. a migration ══════════ */

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

/* ══════════ 9b. a migration da RPC ══════════ */

function testeMigrationRpc() {
  const sql = readFileSync(MIGRATION_RPC, "utf8");
  const codigo = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration da RPC: forma");

  check("cria apply_business_hours", /CREATE OR REPLACE FUNCTION public\.apply_business_hours/.test(codigo));
  check("é SECURITY DEFINER", /SECURITY DEFINER/.test(codigo));
  check("com search_path fixo", /SET search_path TO 'public'/.test(codigo));
  check("EXECUTE só para authenticated", /GRANT EXECUTE ON FUNCTION public\.apply_business_hours[^;]*TO authenticated/.test(codigo));
  check("revoga de PUBLIC", /REVOKE ALL ON FUNCTION public\.apply_business_hours[^;]*FROM PUBLIC/.test(codigo));
  check("nada para anon", !/TO[^;\n]*\banon\b/i.test(codigo));

  group("migration da RPC: a autorização não é afrouxada");

  check(
    "exige admin do tenant ou super_admin, como a policy da tabela",
    /has_role_in_barbershop\(_caller, _barbershop_id, 'admin_barbearia'/.test(codigo) &&
      /has_role\(_caller, 'super_admin'/.test(codigo),
  );
  check("recusa sem sessão", /_caller IS NULL/.test(codigo));

  group("migration da RPC: só desativa, nunca apaga nem edita horário");

  check("o UPDATE mexe em is_active", /SET is_active = false/.test(codigo));
  check("e em mais nada além de updated_at", !/SET is_active = false,\s*\n\s*start_time|SET is_active = false,\s*\n\s*end_time/.test(codigo));
  check("nenhum DELETE", !/DELETE FROM/i.test(codigo));
  check("condicionado ao sinalizador explícito", /IF _deactivate_conflicts THEN/.test(codigo));
  check(
    "desativa ANTES do upsert",
    codigo.indexOf("IF _deactivate_conflicts THEN") < codigo.indexOf("INSERT INTO public.business_hours"),
    "o trigger de conflito só conta turno ativo — a ordem é o que faz funcionar",
  );

  group("migration da RPC: o comentário com `;` foi corrigido");

  check("regrava o COMMENT da tabela", /COMMENT ON TABLE public\.business_hours IS/.test(codigo));
  const comentario = /COMMENT ON TABLE public\.business_hours IS([\s\S]*?);\n/.exec(codigo)?.[1] ?? "";
  check("e o texto novo não tem `;`", !comentario.includes(";"), comentario.slice(0, 120));
  check("sem tocar no schema", !/ALTER TABLE|CREATE TABLE|DROP/i.test(codigo));

  group("migration da RPC: não duplica a anterior");

  check(
    "não recria os triggers de 20260805170000",
    !/CREATE TRIGGER trg_enforce_shift_within_business_hours|CREATE TRIGGER trg_business_hours_fit_shifts/.test(codigo),
  );
  check("documenta rollback", /ROLLBACK/.test(sql));
  check(
    "registra POR QUE a RPC existe",
    /policy de UPDATE de `weekly_schedule`[\s\S]{0,400}admin_barbearia/.test(sql) ||
      /admin_barbearia` NÃO está ali/.test(sql),
    "sem esse registro, o próximo leitor acha que é SECURITY DEFINER por preguiça",
  );
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
  await testeRpcAplicar();
  await testeGradeAlheia();
  testeTela();
  testeMigration();
  testeMigrationRpc();
  testeParidade();

  resetMockDatabase();
  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
