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
import { nowInTenantTZ } from "@/lib/tz";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows, setTableRows } from "@/mocks/store";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_B_ID,
  MOCK_BARBERSHOP_E_ID,
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

/** Domingo: o dia que o cenário público fecha, para provar `is_closed`. */
const DOMINGO = 0;
/** Segunda-feira: o dia usado em quase todos os cenários. */
const SEGUNDA = 1;
/** Terça: usado onde é preciso um dia SEM envelope, para provar a ausência. */
const TERCA = 2;

/* ══════════ o relógio do harness ══════════ */

/**
 * "Hoje" do harness, fixo — uma QUARTA-FEIRA.
 *
 * Antes disto o harness ficava vermelho em 3 dos 7 dias da semana, e verde nos
 * outros 4, sem que uma linha de código mudasse. O mecanismo: as datas do
 * fixture nascem de `isoDateOffset(n)` = `new Date()` + n, enquanto os cenários
 * daqui escolhem data por aritmética de dia da semana. Nos dias em que as duas
 * contas caem na mesma data, um cenário esbarra no dado de outro:
 *
 *   sex/sáb  a âncora de agendamento (+2 e +1) cai no DOMINGO, e o banco recusa
 *            — corretamente — fechar um dia que tem compromisso marcado;
 *   seg      a próxima segunda futura é hoje+7, exatamente onde o fixture põe
 *            as férias da Ana, e dia bloqueado não devolve janela nenhuma.
 *
 * Fixar a âncora resolve na raiz: o fixture inteiro passa a ser gerado a partir
 * de uma data que não anda, e as duas contas param de se cruzar por acaso.
 *
 * Fixa-se o RELÓGIO, não as constantes de data. É a diferença que faz esta
 * correção não cair na armadilha que `segundaISO()` documenta: uma constante
 * escrita à mão viraria passado com o tempo, e os cenários de conflito ficariam
 * verdes pelo motivo errado, porque a regra só olha agendamento com
 * `date >= hoje`. Com o relógio parado, "hoje" também não anda, e a relação
 * entre as datas continua a mesma para sempre.
 *
 * Por que quarta: os deslocamentos do fixture (-6 a +7) não põem nenhum
 * agendamento VIVO no domingo, e as férias da Ana (+7) caem numa quarta, longe
 * da segunda que os cenários de janela usam (+5). Não é o que sustenta a
 * correção — `limparDia()` sustenta —, é só uma âncora que já nasce sem atrito.
 */
const HOJE_ANCORA = "2026-08-05";

const DateReal = Date;

/**
 * Fixa `Date` em `iso` e devolve o restaurador.
 *
 * Trocar o `Date` global alcança de uma vez os dois lados do problema: o
 * `isoDateOffset()` do fixture e o `nowInTenantTZ()` que as regras usam para o
 * recorte de 90 dias. Fixar só um dos dois criaria um mundo incoerente — dado
 * de teste numa data e regra medindo de outra —, que é pior que o defeito.
 */
function fixarRelogio(iso: string): () => void {
  // Restaura o relógio ANTERIOR, não o real: a varredura dos sete dias fixa uma
  // data por dia por dentro da âncora de `runHarness()`, e devolver o relógio
  // real ali soltaria a âncora no meio da execução.
  const anterior = globalThis.Date;
  const instante = new DateReal(`${iso}T12:00:00Z`).getTime();

  class DataFixa extends DateReal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      // Sem argumento é "agora" — o único caso que interessa fixar. Com
      // argumento, repassa para o Date real e se comporta como sempre.
      if (args.length === 0) super(instante);
      else super(...(args as [number]));
    }
    static now(): number {
      return instante;
    }
  }

  globalThis.Date = DataFixa as DateConstructor;
  return () => {
    globalThis.Date = anterior;
  };
}

/** Os sete dias, para a varredura que prova a independência de calendário. */
const SEMANA = [
  { nome: "domingo", iso: "2026-08-02" },
  { nome: "segunda", iso: "2026-08-03" },
  { nome: "terça", iso: "2026-08-04" },
  { nome: "quarta", iso: "2026-08-05" },
  { nome: "quinta", iso: "2026-08-06" },
  { nome: "sexta", iso: "2026-08-07" },
  { nome: "sábado", iso: "2026-08-08" },
] as const;

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

/**
 * Zera o cenário: sem envelope, sem turnos e SEM AGENDAMENTOS na segunda da
 * barbearia A.
 *
 * Os agendamentos entraram na limpeza junto com a 20260806140000: desde ela o
 * conflito de expediente é medido contra `appointments`, e o fixture já traz
 * segundas marcadas. Sem zerá-los, cada teste de expediente passaria a falhar
 * por um conflito que o cenário não pediu.
 */
function limparSegunda() {
  setTableRows("business_hours", []);
  limparDia(SEGUNDA);
}

/**
 * Devolve um dia da semana ao cenário: sem turno, sem agendamento e sem
 * bloqueio do fixture na barbearia A.
 *
 * O `schedule_blocks` entrou aqui junto com a correção de calendário. Ele é o
 * que faltava para o cenário ser dono da própria data: enquanto o fixture podia
 * ter as férias da Ana na mesma segunda que os cenários de janela escolhem,
 * `get_public_availability_windows` devolvia `[]` — e não por causa do
 * expediente, que é o que aqueles cenários medem.
 *
 * Note que isto NÃO é o que torna o harness determinístico; `HOJE_ANCORA` é.
 * Isto é o que o mantém correto sob QUALQUER âncora, e é o que a varredura dos
 * sete dias exercita. Os dois juntos: um evita a colisão, o outro prova que não
 * há colisão a evitar.
 */
function limparDia(dia: number) {
  setTableRows(
    "weekly_schedule",
    getTableRows("weekly_schedule").filter(
      (t) => !(t.barbershop_id === MOCK_BARBERSHOP_ID && Number(t.day_of_week) === dia),
    ),
  );
  setTableRows(
    "appointments",
    getTableRows("appointments").filter(
      (a) => !(a.barbershop_id === MOCK_BARBERSHOP_ID && diaDaSemanaDe(a.date) === dia),
    ),
  );
  setTableRows(
    "schedule_blocks",
    getTableRows("schedule_blocks").filter(
      (b) => !(b.barbershop_id === MOCK_BARBERSHOP_ID && diaDaSemanaDe(b.block_date) === dia),
    ),
  );
}

/** Dia da semana de um `YYYY-MM-DD`, sem envolver fuso. */
function diaDaSemanaDe(iso: unknown): number {
  const s = String(iso ?? "");
  return new Date(
    Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))),
  ).getUTCDay();
}

/** Marca um agendamento vivo na segunda indicada, para exercer o conflito novo. */
function agendarNaSegunda(campos: Record<string, unknown>) {
  setTableRows("appointments", [
    ...getTableRows("appointments"),
    {
      id: `ag-${String(campos.date)}-${String(campos.start_time)}`,
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      client_id: MOCK_USER_IDS.clienteCaio,
      service_id: "servico-teste",
      status: "scheduled",
      ...campos,
    },
  ]);
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

  // Terceiro turno da Ana, em horários que não colidem com o das 09:00 acima
  // (a UNIQUE é por barbeiro + dia + `start_time`). Antes estes turnos eram do
  // admin; desde 20260805200000 ele não cadastra grade nenhuma, então usá-lo
  // aqui testaria a recusa errada — a de papel, não a de expediente.
  const cedo = await cadastrarTurno({ start_time: "08:00", end_time: "12:00" });
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

  const tarde = await cadastrarTurno({ start_time: "14:00", end_time: "20:00" });
  check("fechar depois do expediente é recusado", tarde.error !== null, tarde.error?.message ?? "sem erro");

  const engloba = await cadastrarTurno({ start_time: "07:00", end_time: "23:00" });
  check("turno que engloba o expediente é recusado", engloba.error !== null, engloba.error?.message ?? "sem erro");

  group("turno inativo não é validado (é a saída do admin)");

  const inativo = await cadastrarTurno({
    start_time: "06:00",
    end_time: "23:00",
    is_active: false,
  });
  check(
    "turno fora do expediente é aceito quando inativo",
    inativo.error === null,
    inativo.error?.message ?? "",
  );

  // REESCRITA em 20260806140000. Antes, reativar era recusado — e isso deixava
  // o dono congelado assim que o expediente apertasse por cima de um turno
  // antigo. A regra nova é geométrica: aceita enquanto a janela não AMPLIAR.
  const reativar = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: true })
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("barber_id", MOCK_USER_IDS.barberAna)
    .eq("start_time", "06:00");
  check(
    "reativar o mesmo turno, sem mudar horário, é aceito",
    reativar.error === null,
    reativar.error?.message ?? "",
  );

  const amplia = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ end_time: "23:30" })
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("barber_id", MOCK_USER_IDS.barberAna)
    .eq("start_time", "06:00");
  check(
    "mas AMPLIAR para ainda mais fora é recusado",
    amplia.error !== null,
    amplia.error?.message ?? "sem erro",
  );

  const encurta = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ start_time: "09:00", end_time: "18:00" })
    .eq("barbershop_id", MOCK_BARBERSHOP_ID)
    .eq("barber_id", MOCK_USER_IDS.barberAna)
    .eq("start_time", "06:00");
  check(
    "e ENCURTAR para dentro do expediente é aceito",
    encurta.error === null,
    encurta.error?.message ?? "",
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

  group("apertar o expediente: a grade recorrente NÃO bloqueia mais");

  // REESCRITO em 20260806140000. Este grupo provava o oposto: que apertar o
  // expediente por cima de um turno largo era recusado. A regra mudou de
  // conceito — `weekly_schedule` é INTENÇÃO recorrente, não compromisso com
  // ninguém, e obrigar o admin a mexer na grade alheia para exercer uma decisão
  // que é dele era o custo que se aceitava por não haver filtro na leitura.
  // Desde 20260806130000 há, então o custo deixou de existir.
  const largo = await cadastrarTurno({ start_time: "08:00", end_time: "20:00" });
  check("turno 08:00–20:00 entra antes de existir expediente", largo.error === null, largo.error?.message ?? "");

  const aperta = await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  check(
    "apertar o expediente por cima do turno largo é ACEITO",
    aperta.error === null,
    aperta.error?.message ?? "",
  );
  check("e o expediente foi gravado", getTableRows("business_hours").length === 1);
  check(
    "o turno alheio segue ATIVO e intacto — nada é desativado",
    getTableRows("weekly_schedule").some(
      (t) =>
        t.barbershop_id === MOCK_BARBERSHOP_ID &&
        t.start_time === "08:00" &&
        t.end_time === "20:00" &&
        t.is_active !== false,
    ),
    "nunca apagar nem aparar dado alheio continua sendo o ponto",
  );

  group("apertar o expediente: e o turno que sobrou não vaza para o público");

  // É o fecho do raciocínio: a grade fora do envelope deixou de bloquear
  // PORQUE ela já não gera janela. Sem esta verificação, o passo 2 estaria
  // apoiado numa promessa do passo 1 em vez de na prova dela.
  await mockSupabaseClient.auth.signOut();
  const janelas =
    (
      await (mockSupabaseClient as any).rpc("get_public_availability_windows", {
        _barbershop_id: MOCK_BARBERSHOP_ID,
        _barber_id: MOCK_USER_IDS.barberAna,
        _date: segundaISO(),
      })
    ).data ?? [];
  const livre = janelas.filter((j: Record<string, unknown>) => j.status === "livre");
  check(
    "a janela pública sai recortada para 09:00–18:00",
    livre.length === 1 && livre[0]?.start_time === "09:00" && livre[0]?.end_time === "18:00",
    JSON.stringify(livre),
  );

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

  group("apply_business_hours: recusa quando há AGENDAMENTO em conflito");

  // REESCRITO em 20260806140000. O conflito que faz a RPC recusar deixou de ser
  // o turno recorrente e passou a ser o agendamento — e `_deactivate_conflicts`
  // não resolve este, de propósito: desativar grade não desmarca cliente. A
  // saída é remarcar ou cancelar, e isso é decisão de gente.
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  agendarNaSegunda({ date: segundaISO(), start_time: "08:00", end_time: "08:30" });

  const recusa = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: false,
  });
  check("recusa quando há agendamento fora do novo expediente", Boolean(recusa.error), JSON.stringify(recusa.error));
  check(
    "a mensagem nomeia o cliente e a hora",
    String(recusa.error?.message ?? "").includes("08:00") &&
      String(recusa.error?.message ?? "").includes("Caio"),
    String(recusa.error?.message),
  );
  check("e o expediente NÃO foi gravado", getTableRows("business_hours").length === 0);

  const aindaComDeactivate = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: true,
  });
  check(
    "_deactivate_conflicts NÃO contorna agendamento",
    Boolean(aindaComDeactivate.error),
    JSON.stringify(aindaComDeactivate.error),
  );

  group("apply_business_hours: sem agendamento em conflito, passa direto");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await cadastrarTurno({ start_time: "08:00", end_time: "20:00" });
  await login(MOCK_ADMIN_EMAIL);

  const resolve = await (mockSupabaseClient as any).rpc("apply_business_hours", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _day_of_week: SEGUNDA,
    _open_time: "09:00:00",
    _close_time: "18:00:00",
    _is_closed: false,
    _deactivate_conflicts: false,
  });
  check("turno largo não impede mais", !resolve.error, JSON.stringify(resolve.error));
  check("o expediente entrou", getTableRows("business_hours").length === 1);

  const turno = getTableRows("weekly_schedule").find((t) => t.start_time === "08:00");
  check("o turno NÃO foi apagado", Boolean(turno), "desativar nunca é apagar");
  check("nem desativado — não foi preciso", turno?.is_active !== false, String(turno?.is_active));

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

  group("aba Horários: seções nomeadas pelo que são");

  check("o título enganoso saiu do cabeçalho da aba", !/>Horários de Funcionamento</.test(dash));
  check("existe a seção do expediente da barbearia", dash.includes("Funcionamento da barbearia"));
  check("existe a seção pessoal", dash.includes("Minha agenda"));
  check("e ela diz que vale só para quem está logado", /Vale só para você|vale só para você/.test(dash));
  // Passaram a ser TRÊS: a "Agenda semanal" veio de /agenda na fase 1 da
  // consolidação. E a asserção do `isAdmin` deixou de casar o JSX inteiro —
  // pregar o formato quebrava a cada prop nova, sem proteger nada a mais.
  check("existe a seção da agenda já gerada", dash.includes("Agenda semanal"));
  check(
    "a aba passa isAdmin para a seção",
    /<ScheduleTab[\s\S]{0,160}?isAdmin=\{isAdmin\}/.test(dash),
  );
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

/* ══════════ 8b. exposição pública ══════════ */

async function testePublico() {
  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  // O domingo é fechado mais abaixo, e fechar dia com agendamento vivo é
  // recusado pelo banco — corretamente. Sem esta linha, o cenário só passava
  // nos dias da semana em que nenhuma âncora do fixture calhava de cair num
  // domingo, e essa era a origem de 5 das falhas.
  limparDia(DOMINGO);
  await mockSupabaseClient.auth.signOut();

  const publico = async (id: unknown) =>
    (mockSupabaseClient as any).rpc("get_public_business_hours", { _barbershop_id: id });

  group("expediente público: sem envelope, nada a mostrar");

  const vazio = await publico(MOCK_BARBERSHOP_ID);
  check("responde sem sessão", !vazio.error, JSON.stringify(vazio.error));
  check(
    "barbearia sem nenhum dia configurado devolve vazio",
    (vazio.data ?? []).length === 0,
    "é o comportamento de hoje: a página não passa a mostrar o que nunca teve",
  );

  group("expediente público: com envelope, devolve o que foi configurado");

  await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  await login(MOCK_ADMIN_EMAIL);
  await (mockSupabaseClient as any).from("business_hours").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    day_of_week: 0,
    is_closed: true,
  });
  await mockSupabaseClient.auth.signOut();

  const comDias = await publico(MOCK_BARBERSHOP_ID);
  const linhas2 = (comDias.data ?? []) as Array<Record<string, unknown>>;
  check("anônimo lê o expediente", linhas2.length === 2, `${linhas2.length}`);
  check("ordenado por dia", Number(linhas2[0]?.day_of_week) === 0 && Number(linhas2[1]?.day_of_week) === SEGUNDA);

  const domingo = linhas2.find((l) => Number(l.day_of_week) === 0);
  const segunda = linhas2.find((l) => Number(l.day_of_week) === SEGUNDA);
  check("dia fechado vem com is_closed", domingo?.is_closed === true);
  check("e sem horário", domingo?.open_time === null && domingo?.close_time === null, JSON.stringify(domingo));
  check("dia aberto traz a faixa", String(segunda?.open_time).startsWith("09:00") && String(segunda?.close_time).startsWith("18:00"), JSON.stringify(segunda));

  check(
    "só devolve os quatro campos, nada de id ou barbershop_id",
    linhas2.every((l) => Object.keys(l).sort().join(",") === "close_time,day_of_week,is_closed,open_time"),
    Object.keys(linhas2[0] ?? {}).join(", "),
  );
  check(
    "os dias NÃO configurados simplesmente não vêm",
    linhas2.length === 2,
    "ausência é 'sem restrição', e a tela não pode transformá-la em 'Fechado'",
  );

  group("expediente público: fronteira igual à das outras RPCs");

  check("id nulo devolve vazio", ((await publico(null)).data ?? []).length === 0);
  check("id inexistente devolve vazio", ((await publico("00000000-0000-4000-8000-000000000000")).data ?? []).length === 0);
  check("barbearia PENDENTE devolve vazio", ((await publico(MOCK_BARBERSHOP_E_ID)).data ?? []).length === 0);

  const base = getTableRows("barbershops");
  const rejeitada = { ...base[0], id: "e0e0e0e0-0000-4000-8000-000000000001", subdomain: "rejeitada-bh", status: "rejected" };
  const sentinela = { ...base[0], id: "e0e0e0e0-0000-4000-8000-000000000002", subdomain: "_system", status: "approved" };
  setTableRows("barbershops", [...base, rejeitada, sentinela]);
  setTableRows("business_hours", [
    ...getTableRows("business_hours"),
    { id: "bh-rej", barbershop_id: rejeitada.id, day_of_week: 1, open_time: "09:00", close_time: "18:00", is_closed: false },
    { id: "bh-sent", barbershop_id: sentinela.id, day_of_week: 1, open_time: "09:00", close_time: "18:00", is_closed: false },
  ]);

  check(
    "REJEITADA devolve vazio mesmo COM expediente cadastrado",
    ((await publico(rejeitada.id)).data ?? []).length === 0,
    "o vazio é do filtro, não da falta de dado",
  );
  check(
    "sentinela _system devolve vazio mesmo COM expediente cadastrado",
    ((await publico(sentinela.id)).data ?? []).length === 0,
  );
  setTableRows("barbershops", base);
}

/* ══════════ 8c. a tela pública ══════════ */

function testeTelaPublica() {
  const comp = lerArquivo("src/components/BusinessHoursPublic.tsx");
  const semComent = semComentarios(comp);
  const pagina = lerArquivo("src/routes/agendar.$slug.tsx");

  group("tela pública: onde e como aparece");

  check("a página de agendamento renderiza a seção", /<BusinessHoursPublic barbershopId=\{barbershop\.id\} \/>/.test(pagina));
  check(
    "antes do assistente, não depois",
    pagina.indexOf("<BusinessHoursPublic") < pagina.indexOf("<PublicBookingWizard"),
    "o expediente é contexto para escolher, não apêndice como avaliações",
  );
  check("lê pela RPC, nunca pela tabela", semComent.includes("get_public_business_hours"));
  check(
    "não consulta business_hours direto",
    !/from\(\s*["']business_hours["']\s*\)/.test(semComent),
    "anon não tem grant na tabela, e não deve ter",
  );

  group("tela pública: os três estados");

  check("sem dias configurados não renderiza nada", /dias\.length === 0\) return null/.test(semComent));
  check("dia ausente some da lista", /if \(!info\) return null/.test(semComent));
  check("dia fechado mostra 'Fechado'", comp.includes("Fechado"));
  check("dia aberto mostra a faixa", /hhmm\(info\.open_time\)/.test(semComent));
  check(
    "falha de consulta também não renderiza",
    /if \(error\)[\s\S]{0,200}setDias\(\[\]\)/.test(semComent),
    "horário errado numa página de agendamento é pior do que horário nenhum",
  );
  check("e a falha é registrada", /logTechnicalError\([^)]*BusinessHoursPublic/.test(semComent));

  group("tela pública: layout (§3)");

  check("grade responsiva por breakpoint literal", /grid-cols-2 sm:grid-cols-3/.test(semComent));
  check("nada com largura fixa em px", !/w-\[\d+px\]/.test(semComent));
  check("texto longo trunca em vez de estourar", /truncate/.test(semComent) && /min-w-0/.test(semComent));
  check(
    "sem classe de breakpoint montada por interpolação",
    !/\$\{[^}]*\}:(grid|flex|hidden|inline)/.test(semComent),
    "Tailwind não gera classe interpolada (§3.6)",
  );
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

/* ══════════ 9c. a migration da RPC pública ══════════ */

function testeMigrationPublica() {
  const sql = readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260805190000_public_business_hours.sql"),
    "utf8",
  );
  const codigo = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration pública: a RPC");

  check("cria get_public_business_hours", /CREATE OR REPLACE FUNCTION public\.get_public_business_hours\(_barbershop_id uuid\)/.test(codigo));
  check("é SECURITY DEFINER", /SECURITY DEFINER/.test(codigo));
  check("é STABLE", /\bSTABLE\b/.test(codigo));
  check("search_path fixo", /SET search_path TO 'public'/.test(codigo));
  check("filtra por barbershop_is_public", /public\.barbershop_is_public\(_barbershop_id\)/.test(codigo));
  check("recusa id nulo", /_barbershop_id IS NOT NULL/.test(codigo));
  check("ordena por dia", /ORDER BY bh\.day_of_week/.test(codigo));

  group("migration pública: o que sai e o que não sai");

  const retorno = /RETURNS TABLE \(([\s\S]*?)\)/.exec(codigo)?.[1] ?? "";
  check("devolve os quatro campos", /day_of_week smallint/.test(retorno) && /open_time\s+time/.test(retorno) && /close_time\s+time/.test(retorno) && /is_closed\s+boolean/.test(retorno));
  for (const coluna of ["id", "barbershop_id", "created_at", "updated_at"]) {
    check(`não devolve ${coluna}`, !new RegExp(`\\b${coluna}\\b`).test(retorno));
  }

  group("migration pública: grants");

  check("revoga de PUBLIC", /REVOKE ALL ON FUNCTION public\.get_public_business_hours\(uuid\) FROM PUBLIC/.test(codigo));
  check("concede EXECUTE a anon e authenticated", /GRANT EXECUTE ON FUNCTION public\.get_public_business_hours\(uuid\) TO anon, authenticated/.test(codigo));
  check(
    "NÃO concede acesso à tabela",
    !/GRANT[^;]*ON TABLE[^;]*business_hours/i.test(codigo),
    "a tabela segue sem grant para anon — é o ponto da RPC existir",
  );
  check("aditiva: nada de DROP nem ALTER", !/\bDROP\b|ALTER TABLE/i.test(codigo));
  check("documenta rollback", /ROLLBACK/.test(sql));
  check(
    "registra por que não é grant nem coluna na vitrine",
    /jsonb_agg/.test(sql) && /24 colunas/.test(sql),
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
  check(
    "mock mede o conflito contra agendamento vivo, não contra a grade",
    /getTableRows\("appointments"\)[\s\S]{0,400}!== "scheduled"/.test(regras),
  );
  check(
    "e só dentro da janela de 90 dias, no fuso do tenant",
    /nowInTenantTZ\(\)\.iso/.test(regras) && /addDaysISO\(hoje, 90\)/.test(regras),
  );
  check(
    "mock aceita UPDATE de turno legado enquanto não ampliar",
    /timeToMinutes\(inicio\) >= timeToMinutes\(inicioAntigo\)/.test(semComentarios(regras)) &&
      /timeToMinutes\(fim\) <= timeToMinutes\(fimAntigo\)/.test(semComentarios(regras)),
  );
  check("mock autoriza escrita só para administração", regras.includes("authorizeBusinessHours"));

  const builder = readFileSync(path.join(ROOT, "src", "mocks", "query-builder.ts"), "utf8");
  check("query-builder liga business_hours", /case "business_hours":/.test(builder));
  check("e passa a grade pela validação nova", /return validateWeeklySchedule\(row, existing\)/.test(builder));
}

/* ══════════ 15. janelas públicas recortadas pelo expediente ══════════ */

/** `YYYY-MM-DD` + n dias, sem passar por fuso nenhum. */
function somaDias(iso: string, dias: number): string {
  const d = new Date(
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))),
  );
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/**
 * A próxima segunda ESTRITAMENTE futura, derivada do "hoje" vigente.
 *
 * Data fixa apodreceria: desde 20260806140000 o conflito só olha agendamento
 * com `date >= hoje`, então uma constante escrita hoje viraria passado e os
 * cenários passariam a "provar" que não há conflito — verdes pelo motivo
 * errado, que é o pior estado possível para um harness.
 *
 * Continua derivada, e não fixa, mesmo com `HOJE_ANCORA`: é o que deixa a
 * varredura dos sete dias medir alguma coisa. Deixou de ser `const` de módulo
 * porque a constante era avaliada no import, antes de `runHarness()` fixar o
 * relógio — congelaria o dia real da máquina e a varredura seria decorativa.
 */
function segundaISO(): string {
  const hoje = nowInTenantTZ().iso;
  const dow = new Date(
    Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1, Number(hoje.slice(8, 10))),
  ).getUTCDay();
  return somaDias(hoje, ((SEGUNDA - dow + 7) % 7) || 7);
}

/**
 * O passo 1 da mudança de regra (migration 20260806130000).
 *
 * Até aqui `get_public_availability_windows` NUNCA olhou `business_hours`. A
 * coerência entre "a barbearia diz que fecha segunda" e "o assistente oferece
 * segunda" vinha de um INVARIANTE DE ESCRITA (turno ativo ⊆ envelope), mantido
 * pelos dois triggers — não de filtro nenhum na leitura. Enquanto o invariante
 * vale, recortar é no-op; o valor deste passo é sustentar a garantia sozinho,
 * antes de o passo 2 relaxar o trigger.
 *
 * Por isso vários cenários abaixo montam o estado por `setTableRows`: turno
 * fora do envelope AINDA não é alcançável pela API (o trigger da grade recusa),
 * e é exatamente esse o estado que o passo 2 torna possível. Forçá-lo aqui é o
 * que prova que a leitura aguenta antes de a escrita afrouxar.
 */
async function testeJanelasRecortadas() {
  const janelas = async () =>
    (mockSupabaseClient as any).rpc("get_public_availability_windows", {
      _barbershop_id: MOCK_BARBERSHOP_ID,
      _barber_id: MOCK_USER_IDS.barberAna,
      _date: segundaISO(),
    });

  /** Grava o turno direto, sem passar pelas regras de escrita. */
  const turnoLegado = (start: string, end: string) => {
    setTableRows("weekly_schedule", [
      ...getTableRows("weekly_schedule").filter(
        (t) => !(t.barbershop_id === MOCK_BARBERSHOP_ID && Number(t.day_of_week) === SEGUNDA),
      ),
      {
        id: `turno-legado-${start}`,
        barbershop_id: MOCK_BARBERSHOP_ID,
        barber_id: MOCK_USER_IDS.barberAna,
        day_of_week: SEGUNDA,
        start_time: start,
        end_time: end,
        is_active: true,
      },
    ]);
  };

  const envelope = (campos: Record<string, unknown> | null) => {
    setTableRows(
      "business_hours",
      campos === null
        ? []
        : [{ id: "env-segunda", barbershop_id: MOCK_BARBERSHOP_ID, day_of_week: SEGUNDA, ...campos }],
    );
  };

  group("janelas públicas: a data escolhida é mesmo uma segunda futura");

  check(
    `${segundaISO()} cai em segunda-feira`,
    diaDaSemanaDe(segundaISO()) === SEGUNDA,
    String(diaDaSemanaDe(segundaISO())),
  );
  check(
    "e é estritamente futura — senão os cenários de conflito ficariam verdes pelo motivo errado",
    segundaISO() > nowInTenantTZ().iso,
    `${segundaISO()} vs hoje ${nowInTenantTZ().iso}`,
  );

  group("janelas públicas: sem envelope, nada muda");

  resetMockDatabase();
  await mockSupabaseClient.auth.signOut();
  // Dia bloqueado não devolve janela nenhuma, e o fixture põe as férias da Ana
  // numa data que podia ser justamente esta segunda. O cenário mede recorte por
  // EXPEDIENTE; um bloqueio residual o zeraria por outro motivo.
  limparDia(SEGUNDA);
  turnoLegado("09:00", "18:00");
  envelope(null);

  // Só as JANELAS. O fixture já traz exceções `ocupado` nesta data, e contá-las
  // junto mediria outra coisa.
  const livres = (linhas: any[]) => linhas.filter((j) => j.status === "livre");
  const semEnv = livres((await janelas()).data ?? []);
  check("devolve o turno inteiro", semEnv.length === 1, JSON.stringify(semEnv));
  check(
    "sem recorte: 09:00–18:00",
    semEnv[0]?.start_time === "09:00" && semEnv[0]?.end_time === "18:00",
    JSON.stringify(semEnv[0]),
  );

  group("janelas públicas: dia fechado não oferece nada");

  envelope({ is_closed: true, open_time: null, close_time: null });
  const comFechado = livres((await janelas()).data ?? []);
  check("nenhuma janela", comFechado.length === 0, JSON.stringify(comFechado));

  group("janelas públicas: redução parcial recorta");

  envelope({ is_closed: false, open_time: "10:00", close_time: "16:00" });
  const recortada = livres((await janelas()).data ?? []);
  check("continua havendo janela", recortada.length === 1, JSON.stringify(recortada));
  check(
    "recorta para 10:00–16:00, não descarta o turno",
    recortada[0]?.start_time === "10:00" && recortada[0]?.end_time === "16:00",
    JSON.stringify(recortada[0]),
  );

  group("janelas públicas: turno inteiramente fora some");

  turnoLegado("06:00", "08:00");
  envelope({ is_closed: false, open_time: "10:00", close_time: "16:00" });
  const fora = (await janelas()).data ?? [];
  check(
    "não vira janela vazia nem invertida",
    livres(fora).length === 0,
    JSON.stringify(fora),
  );

  group("janelas públicas: exceções NÃO são recortadas");

  // Encurtar máscara desmascara horário — o efeito seria o oposto do
  // pretendido. A folga 06:00–08:00 fica fora do envelope 10:00–16:00 e ainda
  // assim tem de voltar inteira.
  turnoLegado("09:00", "18:00");
  envelope({ is_closed: false, open_time: "10:00", close_time: "16:00" });
  setTableRows("availability", [
    ...getTableRows("availability"),
    {
      id: "folga-fora-do-envelope",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      date: segundaISO(),
      start_time: "06:00",
      end_time: "08:00",
      status: "folga",
    },
  ]);

  const comFolga = (await janelas()).data ?? [];
  const folga = comFolga.find((j: Record<string, unknown>) => j.status === "folga");
  check("a exceção volta", Boolean(folga), JSON.stringify(comFolga));
  check(
    "e volta inteira, sem recorte",
    folga?.start_time === "06:00" && folga?.end_time === "08:00",
    JSON.stringify(folga),
  );

  resetMockDatabase();
}

/** O texto da 20260806130000. */
function testeMigracaoRecorte() {
  const sql = readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260806130000_public_windows_respect_business_hours.sql"),
    "utf8",
  );
  const corpo = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration 20260806130000: o recorte");

  check(
    "recria get_public_availability_windows",
    /CREATE OR REPLACE FUNCTION public\.get_public_availability_windows\(/.test(corpo),
  );
  check("junta business_hours", /LEFT JOIN public\.business_hours/.test(corpo));
  check(
    "o JOIN é LEFT — dia sem expediente segue sem restrição",
    !/\bJOIN public\.business_hours/.test(corpo.replace(/LEFT JOIN public\.business_hours/g, "")),
  );
  check("dia fechado não devolve janela", /NOT COALESCE\(bh\.is_closed, false\)/.test(corpo));
  check("recorta com GREATEST/LEAST", /GREATEST\(/.test(corpo) && /LEAST\s*\(/.test(corpo));
  check(
    "descarta janela que zera depois do recorte",
    /GREATEST\([\s\S]{0,120}<[\s\S]{0,120}LEAST/.test(corpo),
  );
  check(
    "não toca em generate_availability_from_schedule",
    !/FUNCTION public\.generate_availability_from_schedule/.test(corpo),
  );
  check(
    "não apaga, não migra e não altera tabela",
    !/\bDELETE\s+FROM\b/i.test(corpo) &&
      !/\bUPDATE\s+public\./i.test(corpo) &&
      !/\bALTER TABLE\b/i.test(corpo),
  );

  group("migration 20260806130000: cabeçalho");

  check("declara ser o passo 1 de 2", /PASSO 1 DE 2/.test(sql));
  check("explica por que é inócuo sozinho", /NO-OP|inócu/i.test(sql));
  check("aponta o passo 2 pelo número", /20260806140000/.test(sql));
  check("registra o rollback", /ROLLBACK/.test(sql));
  check(
    "explica por que a exceção não é recortada",
    /DESMASCARA|desmascara/.test(sql),
  );
}

/* ══════════ 16. conflito medido contra agendamento ══════════ */

/**
 * O passo 2 (migration 20260806140000). Os cenários são os do plano aprovado.
 *
 * O que amarra o desenho: fechar um dia é ACEITO quando só há grade recorrente
 * (intenção), e RECUSADO quando há agendamento (compromisso com cliente).
 */
async function testeConflitoPorAgendamento() {
  const fecharSegunda = async () => {
    await login(MOCK_ADMIN_EMAIL);
    return (mockSupabaseClient as any).from("business_hours").insert({
      barbershop_id: MOCK_BARBERSHOP_ID,
      day_of_week: SEGUNDA,
      is_closed: true,
    });
  };

  group("fechar um dia SEM agendamento");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await cadastrarTurno({ start_time: "09:00", end_time: "18:00" });

  const semAgenda = await fecharSegunda();
  check("aceito, mesmo com grade ativa no dia", semAgenda.error === null, semAgenda.error?.message ?? "");

  await mockSupabaseClient.auth.signOut();
  const depoisDeFechar =
    (
      await (mockSupabaseClient as any).rpc("get_public_availability_windows", {
        _barbershop_id: MOCK_BARBERSHOP_ID,
        _barber_id: MOCK_USER_IDS.barberAna,
        _date: segundaISO(),
      })
    ).data ?? [];
  check(
    "e o público para de mostrar horário nesse dia",
    depoisDeFechar.filter((j: Record<string, unknown>) => j.status === "livre").length === 0,
    JSON.stringify(depoisDeFechar),
  );

  group("fechar um dia COM agendamento vivo");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  agendarNaSegunda({ date: segundaISO(), start_time: "10:00", end_time: "10:30" });

  const comAgenda = await fecharSegunda();
  check("recusado", comAgenda.error !== null, comAgenda.error?.message ?? "sem erro");
  check(
    "a mensagem nomeia o cliente",
    (comAgenda.error?.message ?? "").includes("Caio"),
    comAgenda.error?.message ?? "",
  );
  check(
    "a mensagem traz data e hora",
    (comAgenda.error?.message ?? "").includes(ddmmDe(segundaISO())) &&
      (comAgenda.error?.message ?? "").includes("10:00"),
    comAgenda.error?.message ?? "",
  );
  check(
    "e não vaza detalhe técnico",
    !/SQLSTATE|constraint|policy|42501|undefined/i.test(comAgenda.error?.message ?? ""),
    comAgenda.error?.message ?? "",
  );
  check("nada foi gravado", getTableRows("business_hours").length === 0);

  group("o que NÃO bloqueia");

  for (const status of ["cancelled", "completed", "no_show"]) {
    resetMockDatabase();
    await login(MOCK_ADMIN_EMAIL);
    limparSegunda();
    agendarNaSegunda({ date: segundaISO(), start_time: "10:00", end_time: "10:30", status });
    const r = await fecharSegunda();
    check(`agendamento \`${status}\` não bloqueia`, r.error === null, r.error?.message ?? "");
  }

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  // 98 dias = 14 semanas: continua sendo segunda, e passa dos 90.
  agendarNaSegunda({ date: somaDias(segundaISO(), 98), start_time: "10:00", end_time: "10:30" });
  const longe = await fecharSegunda();
  check("agendamento além de 90 dias não bloqueia", longe.error === null, longe.error?.message ?? "");

  group("redução parcial: só o que fica de fora conta");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  agendarNaSegunda({ date: segundaISO(), start_time: "10:00", end_time: "10:30" });
  const dentro = await definirExpediente({ open_time: "09:00", close_time: "12:00" });
  check("agendamento DENTRO do novo expediente não bloqueia", dentro.error === null, dentro.error?.message ?? "");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  agendarNaSegunda({ date: segundaISO(), start_time: "16:00", end_time: "16:30" });
  const fora = await definirExpediente({ open_time: "09:00", close_time: "12:00" });
  check("agendamento FORA do novo expediente bloqueia", fora.error !== null, fora.error?.message ?? "sem erro");

  group("a orientação ao profissional continua de pé");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  limparSegunda();
  await definirExpediente({ open_time: "09:00", close_time: "18:00" });
  const turnoNovo = await cadastrarTurno({ start_time: "06:00", end_time: "08:00" });
  check(
    "turno NOVO fora do expediente segue recusado",
    turnoNovo.error !== null,
    turnoNovo.error?.message ?? "sem erro",
  );

  resetMockDatabase();
}

/** `YYYY-MM-DD` → `DD/MM`, como a mensagem monta. */
function ddmmDe(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** O texto da 20260806140000. */
function testeMigracaoConflito() {
  const sql = readFileSync(
    path.join(
      ROOT,
      "supabase",
      "migrations",
      "20260806140000_business_hours_conflict_uses_appointments.sql",
    ),
    "utf8",
  );
  const corpo = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration 20260806140000: o conflito");

  check(
    "recria as duas funções de trigger",
    /CREATE OR REPLACE FUNCTION public\.enforce_business_hours_fit_shifts\(/.test(corpo) &&
      /CREATE OR REPLACE FUNCTION public\.enforce_shift_within_business_hours\(/.test(corpo),
  );
  check("o conflito lê appointments", /FROM public\.appointments/.test(corpo));
  check(
    "e NÃO lê mais weekly_schedule",
    !/FROM public\.weekly_schedule/.test(corpo),
    (corpo.match(/.*weekly_schedule.*/) ?? [""])[0].trim(),
  );
  check("só status scheduled", /ap\.status = 'scheduled'/.test(corpo));
  check("janela de 90 dias", /_hoje \+ 90/.test(corpo));
  check(
    "hoje vem do fuso do tenant, não do servidor",
    /now\(\) AT TIME ZONE _tz/.test(corpo) && /b\.timezone/.test(corpo),
  );
  check(
    "não usa current_date, que erraria o dia toda noite",
    !/\bcurrent_date\b/i.test(corpo),
  );
  check("casa o dia da semana da data do agendamento", /EXTRACT\(DOW FROM ap\.date\)/.test(corpo));

  group("migration 20260806140000: a catraca do turno legado");

  check(
    "UPDATE contido na janela antiga é liberado",
    /NEW\.start_time\s*>=\s*OLD\.start_time/.test(corpo) &&
      /NEW\.end_time\s*<=\s*OLD\.end_time/.test(corpo),
  );
  check("só em UPDATE — INSERT segue estrito", /TG_OP = 'UPDATE'/.test(corpo));
  check(
    "e só no mesmo dia e barbearia",
    /NEW\.day_of_week\s*=\s*OLD\.day_of_week/.test(corpo) &&
      /NEW\.barbershop_id\s*=\s*OLD\.barbershop_id/.test(corpo),
  );

  group("migration 20260806140000: alcance e cabeçalho");

  check("declara ser o passo 2 de 2", /PASSO 2 DE 2/.test(sql));
  check("declara a pré-condição do passo 1", /20260806130000/.test(sql) && /PRÉ-CONDIÇÃO/.test(sql));
  check(
    "não apaga, não migra e não altera tabela",
    !/\bDELETE\s+FROM\b/i.test(corpo) &&
      !/\bUPDATE\s+public\./i.test(corpo) &&
      !/\bALTER TABLE\b/i.test(corpo),
  );
  check(
    "não reativa turno nenhum — isso é decisão de quem opera",
    /não apaga, não desativa e não reativa/.test(sql),
  );
  check("não altera apply_business_hours", !/FUNCTION public\.apply_business_hours/.test(corpo));
  check("registra o rollback", /ROLLBACK/.test(sql));
  check(
    "assume a consequência de `date >= hoje`",
    /CONSEQUÊNCIA ACEITA/.test(sql),
  );
}

/* ────────────────────────────── runner ────────────────────────────── */

/* ══════════ 12. independência de calendário ══════════ */

/**
 * Roda os cenários datados uma vez por dia da semana.
 *
 * É a verificação que teria pego o defeito antes de ele chegar à `main`. As
 * outras suítes rodam com o dia real da máquina, então um cenário que só
 * quebra às sextas fica invisível em quatro dias de sete — e quem rodar o
 * portão numa terça vê verde e conclui, de boa-fé, que está tudo certo.
 *
 * Aqui a âncora é varrida de propósito: cada dia reconstrói o fixture inteiro
 * (as datas nascem de `isoDateOffset`, que lê o relógio fixado) e reexecuta os
 * três cenários que escolhem data por conta própria. Se qualquer um deles
 * voltar a depender de dado residual de outro fixture, um dos sete cai.
 *
 * O detalhe de 3 cenários × 7 dias afogaria o relatório, então só o veredito
 * por dia entra — as falhas voltam ao texto apenas quando há o que investigar.
 */
async function testeCalendarioIndependente() {
  group("independência de calendário: os cenários datados nos 7 dias da semana");

  for (const dia of SEMANA) {
    const marcaLinhas = linhas.length;
    const marcaPassou = passou;
    const marcaFalhou = falhou;

    const restaurar = fixarRelogio(dia.iso);
    try {
      await testePublico();
      await testeJanelasRecortadas();
      await testeConflitoPorAgendamento();
    } finally {
      restaurar();
    }

    const falhasDoDia = falhou - marcaFalhou;
    const detalhe = linhas.slice(marcaLinhas).filter((l) => l.includes("✗"));

    linhas.length = marcaLinhas;
    passou = marcaPassou;
    falhou = marcaFalhou;

    check(
      `${dia.nome} (${dia.iso}): cenários datados sem colisão`,
      falhasDoDia === 0,
      detalhe.map((l) => l.trim()).join(" | "),
    );
  }
}

export async function runHarness() {
  // Âncora fixa para a execução inteira: o fixture e as regras passam a ler o
  // mesmo "hoje", que não anda. Ver `HOJE_ANCORA`.
  const restaurarRelogio = fixarRelogio(HOJE_ANCORA);
  try {
    await rodarCenarios();
  } finally {
    restaurarRelogio();
  }

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}

async function rodarCenarios() {
  resetMockDatabase();

  await testeSemEnvelope();
  await testeTurnoContraEnvelope();
  await testeDiaFechado();
  await testeApertarExpediente();
  await testeSuperAdmin();
  await testeRpcAplicar();
  await testeGradeAlheia();
  testeTela();
  await testePublico();
  testeTelaPublica();
  testeMigration();
  testeMigrationRpc();
  testeMigrationPublica();
  testeParidade();
  await testeJanelasRecortadas();
  testeMigracaoRecorte();
  await testeConflitoPorAgendamento();
  testeMigracaoConflito();
  await testeCalendarioIndependente();

  resetMockDatabase();
}
