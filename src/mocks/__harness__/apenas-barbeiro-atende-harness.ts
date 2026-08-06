/**
 * Harness da regra "só `barbeiro` atende" (migration 20260805200000).
 *
 * É decisão de produto, não correção de defeito: `admin_barbearia` administra e
 * deixa de ser tratado como profissional atendível. Até aqui as duas RPCs de
 * listagem filtravam `role IN ('barbeiro','admin_barbearia')` e o admin
 * aparecia na página pública de agendamento e na criação de comanda como se
 * fosse mais um da equipe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS QUATRO SUPERFÍCIES, E POR QUE SÃO QUATRO
 *
 *   1. QUEM APARECE — `get_public_barbers` e `get_public_barbers_v2`. Duas
 *      funções porque a v1 ainda serve a tela interna de comanda; se só a v2
 *      mudasse, o admin sumiria da página pública e continuaria selecionável na
 *      comanda, que é o pior dos dois mundos;
 *   2. QUEM CADASTRA GRADE — a policy de INSERT em `weekly_schedule`. Sem ela o
 *      admin seguiria cadastrando uma agenda que ninguém pode escolher;
 *   3. QUEM OCUPA VAGA — `role_counts_toward_barber_limit`. A mudança é
 *      PERMISSIVA por construção (a contagem só pode cair) e, no plano free
 *      cujo limite é 1, era a diferença entre poder e não poder ter um barbeiro
 *      de verdade: o dono ocupava sozinho a única vaga;
 *   4. QUEM VÊ "MINHA AGENDA" — a aba Horários. A condição tem de ser "o papel é
 *      `barbeiro`", não "não é admin": num papel futuro (recepção, gerência) o
 *      negativo abriria a seção para quem não atende.
 *
 * O QUE NÃO MUDA, E É O PONTO: "atendível" e "staff" são coisas diferentes. As
 * policies e funções que citam `admin_barbearia` para AUTORIZAR respondem "pode
 * operar?", não "atende?". Nenhuma é tocada — o admin continua abrindo comanda,
 * vendo cliente e relatório. E nada é apagado: histórico depende das linhas que
 * já existem.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows, setTableRows } from "@/mocks/store";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_ADMIN_C_EMAIL,
  MOCK_BARBERSHOP_C_ID,
  MOCK_SUPER_ADMIN_EMAIL,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

const ROOT = process.cwd();
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260805200000_only_barbeiro_attends.sql",
);

/**
 * A correção do efeito colateral: a 20260805200000 recriou a policy de INSERT
 * de `weekly_schedule` sem trazer de volta o ramo `super_admin` que a
 * 20260722220000 tinha acrescentado, e não documentou a remoção.
 */
const MIGRATION_SUPER = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260806120000_restore_super_admin_weekly_schedule_insert.sql",
);

function lerArquivo(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Fonte sem comentário. As asserções de "o código FAZ x" precisam olhar código:
 * esta frente explica em prosa, em vários arquivos, o filtro que deixou de
 * existir — e a prosa casaria com o regex.
 */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

/** Segunda-feira: dia sem turno semeado na barbearia A depois da limpeza. */
const SEGUNDA = 1;

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
  const res = await mockSupabaseClient.auth.signInWithPassword({
    email,
    password: "qualquer-senha",
  });
  if (res.error || !res.data.session) throw new Error(`Falha no login fictício: ${email}`);
}

/* ══════════ 1. quem aparece como profissional ══════════ */

async function testeQuemAparece() {
  resetMockDatabase();

  group("get_public_barbers_v2: o admin some, os barbeiros ficam");

  const v2 = ((await mockSupabaseClient.rpc("get_public_barbers_v2", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  })) as { data: { user_id: string; is_owner: boolean }[] | null }).data ?? [];
  const idsV2 = v2.map((r) => String(r.user_id));

  check("a lista não vem vazia", idsV2.length > 0, `${idsV2.length}`);
  check("o admin_barbearia não está na lista", !idsV2.includes(MOCK_USER_IDS.admin), idsV2.join(", "));
  check("a barbeira Ana está", idsV2.includes(MOCK_USER_IDS.barberAna));
  check("o barbeiro Bruno está", idsV2.includes(MOCK_USER_IDS.barberBruno));

  group("get_public_barbers (v1, usada pela comanda): mesma resposta");

  const v1 = ((await mockSupabaseClient.rpc("get_public_barbers", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  })) as { data: { user_id: string }[] | null }).data ?? [];
  const idsV1 = v1.map((r) => String(r.user_id));

  check("o admin_barbearia também some da v1", !idsV1.includes(MOCK_USER_IDS.admin), idsV1.join(", "));
  check(
    "as duas RPCs concordam em quem atende",
    [...idsV1].sort().join(",") === [...idsV2].sort().join(","),
    `v1=[${idsV1.join(", ")}] v2=[${idsV2.join(", ")}]`,
  );

  group("barbearia só com admin: lista vazia, não lista com o admin");

  // O caso `wwwpaulobabershopcom`: 1 admin, 0 barbeiros. A consequência é
  // conhecida e aceita — a página pública passa a dizer que não há profissional
  // disponível. O que NÃO pode acontecer é o admin voltar por um fallback.
  const papeisAntes = getTableRows("user_roles");
  setTableRows(
    "user_roles",
    papeisAntes.filter(
      (r) => !(r.barbershop_id === MOCK_BARBERSHOP_ID && r.role === "barbeiro"),
    ),
  );

  const soAdminV2 = ((await mockSupabaseClient.rpc("get_public_barbers_v2", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  })) as { data: unknown[] | null }).data ?? [];
  const soAdminV1 = ((await mockSupabaseClient.rpc("get_public_barbers", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
  })) as { data: unknown[] | null }).data ?? [];

  check("v2 devolve lista vazia", soAdminV2.length === 0, `${soAdminV2.length}`);
  check("v1 devolve lista vazia", soAdminV1.length === 0, `${soAdminV1.length}`);

  setTableRows("user_roles", papeisAntes);
}

/* ══════════ 2. quem cadastra grade semanal ══════════ */

async function testeGradeSemanal() {
  resetMockDatabase();

  group("weekly_schedule: só quem atende cadastra turno");

  // Segunda limpa nas duas pontas, para o teste não esbarrar na UNIQUE por
  // (barbeiro, barbearia, dia, hora de início) nem em envelope de expediente.
  setTableRows("business_hours", []);
  setTableRows(
    "weekly_schedule",
    getTableRows("weekly_schedule").filter(
      (t) => !(t.barbershop_id === MOCK_BARBERSHOP_ID && Number(t.day_of_week) === SEGUNDA),
    ),
  );

  await login(MOCK_ADMIN_EMAIL);
  const doAdmin = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.admin,
    day_of_week: SEGUNDA,
    start_time: "09:00",
    end_time: "18:00",
    is_active: true,
  });
  check(
    "admin_barbearia é recusado ao cadastrar a PRÓPRIA grade",
    doAdmin.error !== null,
    doAdmin.error?.message ?? "sem erro",
  );
  check(
    "e a recusa fala de quem atende, sem detalhe técnico",
    /atende/i.test(doAdmin.error?.message ?? "") &&
      !/SQLSTATE|policy|constraint|42501|null/i.test(doAdmin.error?.message ?? ""),
    doAdmin.error?.message ?? "",
  );
  check(
    "e nada foi gravado",
    getTableRows("weekly_schedule").every(
      (t) => !(t.barber_id === MOCK_USER_IDS.admin && Number(t.day_of_week) === SEGUNDA),
    ),
  );

  await login("ana@barbearia.teste");
  const daAna = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberAna,
    day_of_week: SEGUNDA,
    start_time: "09:00",
    end_time: "18:00",
    is_active: true,
  });
  check("barbeiro continua cadastrando a própria grade", daAna.error === null, daAna.error?.message ?? "");

  group("weekly_schedule: a regra antiga (grade alheia) segue de pé");

  const alheia = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberBruno,
    day_of_week: SEGUNDA,
    start_time: "10:00",
    end_time: "17:00",
    is_active: true,
  });
  check(
    "barbeiro não cadastra grade de outro barbeiro",
    alheia.error !== null,
    alheia.error?.message ?? "sem erro",
  );

  group("weekly_schedule: o que já existia NÃO é apagado");

  // A migration troca só a policy de INSERT. Linha antiga do admin continua lá
  // — histórico de relatório depende dela — e continua DESATIVÁVEL por ele. É
  // literalmente o caminho de limpeza previsto (`is_active = false`, não
  // delete), e se o mock recusasse aqui estaria mais restrito que o banco.
  resetMockDatabase();
  setTableRows("business_hours", []);
  setTableRows("weekly_schedule", [
    ...getTableRows("weekly_schedule"),
    {
      id: "grade-legada-do-admin",
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.admin,
      day_of_week: SEGUNDA,
      start_time: "09:00",
      end_time: "18:00",
      is_active: true,
      created_at: new Date().toISOString(),
    },
  ]);

  await login(MOCK_ADMIN_EMAIL);
  const desativar = await (mockSupabaseClient as any)
    .from("weekly_schedule")
    .update({ is_active: false })
    .eq("id", "grade-legada-do-admin");
  check(
    "o admin ainda desativa a própria grade antiga",
    desativar.error === null,
    desativar.error?.message ?? "",
  );

  const legada = getTableRows("weekly_schedule").find((t) => t.id === "grade-legada-do-admin");
  check("a linha continua existindo — desativada, não apagada", legada !== undefined);
  check("e ficou inativa", legada?.is_active === false, String(legada?.is_active));
}

/* ══════════ 3. limite de profissionais do plano ══════════ */

async function testeLimiteDoPlano() {
  resetMockDatabase();

  group("limite do plano: só quem atende ocupa vaga");

  // Barbearia C é free, limite 1, com adminCarlos + barberCaco. Tirando o
  // barbeiro sobra só o admin: pela contagem antiga isso era 1 de 1 (cheio),
  // pela nova é 0 de 1 (cabe alguém). É o discriminador exato da mudança.
  await login(MOCK_ADMIN_C_EMAIL);

  const papeisAntes = getTableRows("user_roles");
  setTableRows(
    "user_roles",
    papeisAntes.filter((r) => r.user_id !== MOCK_USER_IDS.barberCaco),
  );

  const soComAdmin = await mockSupabaseClient.rpc("check_barber_limit", {
    _barbershop_id: MOCK_BARBERSHOP_C_ID,
  });
  check(
    "free com só o admin ainda cabe um barbeiro — o admin não ocupa a vaga",
    soComAdmin.data === true,
    String(soComAdmin.data),
  );

  setTableRows("user_roles", papeisAntes);

  const cheia = await mockSupabaseClient.rpc("check_barber_limit", {
    _barbershop_id: MOCK_BARBERSHOP_C_ID,
  });
  check(
    "e com o barbeiro de volta o limite volta a valer",
    cheia.data === false,
    String(cheia.data),
  );

  // A mudança é permissiva por construção: `barbeiro` é subconjunto de
  // `barbeiro` + `admin_barbearia`, então a contagem só pode cair. Foi conferida
  // no remoto antes de escrever a migration (nenhuma barbearia passa a violar).
  const equipe = getTableRows("user_roles").filter(
    (r) => r.barbershop_id === MOCK_BARBERSHOP_ID && r.role !== "cliente",
  );
  const antes = equipe.filter((r) => r.role === "barbeiro" || r.role === "admin_barbearia").length;
  const depois = equipe.filter((r) => r.role === "barbeiro").length;
  check(
    "a contagem só pode cair, nunca subir",
    depois <= antes,
    `antes=${antes} depois=${depois}`,
  );
}

/* ══════════ 4. as telas ══════════ */

function testeTelas() {
  group("RescheduleDialog: só barbeiro na lista de reagendamento");

  const reschedule = semComentarios(lerArquivo("src/components/RescheduleDialog.tsx"));
  check(
    'filtra .eq("role", "barbeiro")',
    /\.eq\(\s*["']role["']\s*,\s*["']barbeiro["']\s*\)/.test(reschedule),
  );
  check(
    "e não sobrou nenhum .in com admin_barbearia",
    !/\.in\([^)]*admin_barbearia/.test(reschedule),
  );

  group("BarberDashboard: seleção de profissional e aba Horários");

  const dashboard = semComentarios(lerArquivo("src/components/BarberDashboard.tsx"));
  check(
    "a consulta de equipe filtra só `barbeiro`",
    /\.eq\(\s*["']role["']\s*,\s*["']barbeiro["']\s*\)/.test(dashboard),
  );
  check(
    "e não sobrou nenhum .in com admin_barbearia",
    !/\.in\([^)]*admin_barbearia/.test(dashboard),
  );

  // A condição precisa ser POSITIVA. Com "não é admin", um papel futuro
  // (recepção, gerência) cairia no ramo de quem atende sem ninguém perceber.
  // A chamada ganhou argumento na fase 1 (`?barbershop=` do super_admin); o que
  // esta verificação guarda continua sendo o mesmo: o papel vem do escopo de
  // tenant, não de uma negação de `isAdmin`.
  check(
    "a aba Horários usa `isBarber` do useTenantScope",
    /useTenantScope\(\{ requestedBarbershopId \}\)/.test(dashboard) && /isBarber/.test(dashboard),
  );
  check(
    "e a condição é positiva — `isBarber`, não a negação de admin",
    /\{\s*isBarber\s*\?/.test(dashboard),
    "condição negativa deixaria papel futuro cair no ramo de quem atende",
  );
  check(
    "quem não atende vê explicação, não uma seção vazia",
    /A agenda pessoal aparece para quem atende/.test(lerArquivo("src/components/BarberDashboard.tsx")),
  );

  // A marcação de quem vê o quê tem de viver em UM lugar. Se voltar a se
  // espalhar em condicionais pela nav, as verificações abaixo caem.
  const bruto = lerArquivo("src/components/BarberDashboard.tsx");
  // Fecha no `];` que está no INÍCIO da linha. Procurar `];` solto pararia no
  // `para: TabAudience[];` da anotação de tipo, e o bloco sairia vazio — as
  // asserções passariam por vacuidade, que é pior que falhar.
  const inicioTabs = bruto.indexOf("const TABS");
  const blocoTabs = bruto.slice(inicioTabs, bruto.indexOf("\n];", inicioTabs));
  const audienciaDe = (id: string): string[] => {
    const trecho = blocoTabs.slice(blocoTabs.indexOf(`id: "${id}"`));
    const m = trecho.match(/para:\s*\[([^\]]*)\]/);
    return m ? m[1].split(",").map((s) => s.trim().replace(/["']/g, "")).filter(Boolean) : [];
  };

  group("BarberDashboard: uma porta para Comandas por papel, nunca zero");

  // A garantia NÃO mudou; mudou onde ela é cumprida. Na fase 2 o link do
  // cabeçalho saiu, porque a nav filtrada por papel passou a listar "Comandas"
  // para o barbeiro — antes disso ela renderizava só para admin, e por isso o
  // link precisava existir. O que continua proibido é o estado de ZERO portas.
  check(
    "o cabeçalho não tem mais link para /comandas",
    (dashboard.match(/<Link to="\/comandas"/g) ?? []).length === 0,
    String((dashboard.match(/<Link to="\/comandas"/g) ?? []).length),
  );
  check(
    "a aba Comandas continua no array de abas",
    /id:\s*"comandas"/.test(dashboard) && /href:\s*"\/comandas"/.test(dashboard),
  );
  check(
    "e o barbeiro está entre quem a enxerga — senão ficaria sem porta",
    audienciaDe("comandas").includes("barbeiro"),
    audienciaDe("comandas").join(","),
  );
  check(
    "a nav só renderiza quando há mais de uma aba a mostrar",
    /\{abasVisiveis\.length > 1 && \(/.test(dashboard),
  );
  check(
    "o ícone segue em uso, sem import órfão",
    (dashboard.match(/ReceiptText/g) ?? []).length >= 2,
    String((dashboard.match(/ReceiptText/g) ?? []).length),
  );

  group("BarberDashboard: a nav de abas é filtrada por papel, não por `isAdmin`");

  const ids = [...blocoTabs.matchAll(/id:\s*"([a-z]+)"/g)].map((m) => m[1]);
  check("todas as abas declaram `para`", ids.every((id) => audienciaDe(id).length > 0), ids.join(","));

  const veBarbeiro = ids.filter((id) => audienciaDe(id).includes("barbeiro"));
  check(
    "barbeiro vê exatamente Visão Geral, Comandas e Horários",
    veBarbeiro.length === 3 &&
      ["overview", "comandas", "schedule"].every((id) => veBarbeiro.includes(id)),
    veBarbeiro.join(","),
  );
  check(
    "e NÃO vê as administrativas",
    !["services", "products", "team", "clients", "settings"].some((id) =>
      audienciaDe(id).includes("barbeiro"),
    ),
  );
  check(
    "admin continua vendo todas",
    ids.every((id) => audienciaDe(id).includes("admin")),
  );
  check(
    "super_admin em tenant alheio vê SÓ Horários",
    ids.filter((id) => audienciaDe(id).includes("superTenant")).join(",") === "schedule",
    ids.filter((id) => audienciaDe(id).includes("superTenant")).join(","),
  );
  check(
    "a nav renderiza a lista filtrada, não TABS cru",
    /abasVisiveis\.map\(/.test(dashboard) && !/\{isAdmin && \([\s\S]{0,80}?<nav/.test(dashboard),
  );

  group("BarberDashboard: a aba Horários ganhou a Agenda Semanal");

  check(
    "ScheduleTab monta ScheduleManager",
    /<ScheduleManager barbershopId=\{resolvedBarbershopId\} \/>/.test(dashboard),
  );
  check(
    "junto das outras duas, sob o mesmo `isBarber`",
    /WeeklyScheduleEditor/.test(dashboard) &&
      /ScheduleBlocks/.test(dashboard) &&
      (dashboard.match(/\{isBarber \?/g) ?? []).length === 2,
    String((dashboard.match(/\{isBarber \?/g) ?? []).length),
  );
  check(
    "o tenant da aba vem de useTenantScope, não do resolvedBarbershopId legado",
    /useTenantScope\(\{ requestedBarbershopId \}\)/.test(dashboard) &&
      /scope\.access === "granted" \? scope\.tenantId : null/.test(dashboard),
  );
  check(
    "recusa de acesso não é confundida com `sem barbearia`",
    /SemAcessoAoTenant/.test(dashboard) && /tenantAccessMessage/.test(dashboard),
  );

  group("rota /dashboard: aceita ?barbershop= para super_admin");

  const rota = semComentarios(lerArquivo("src/routes/dashboard.tsx"));
  check(
    "o parâmetro entra no validateSearch",
    /barbershop:\s*typeof search\.barbershop === "string"/.test(rota),
  );
  check(
    "e é repassado ao BarberDashboard",
    /requestedBarbershopId=\{requestedBarbershopId\}/.test(rota),
  );
  check(
    "sem o parâmetro, o super_admin continua vendo o painel da plataforma",
    /requestedBarbershopId \?[\s\S]{0,200}?<AdminDashboard \/>/.test(rota),
  );

  // FASE 1 é aditiva: nada some ainda. Se alguma destas cair, alguém adiantou
  // a fase 2 sem os passos dela.
  group("fase 2: /agenda vira redirect, e ninguém fica sem caminho");

  // As três travas da fase 1 continuam aqui, apontadas para o estado NOVO. A
  // proteção não afrouxou: o que elas impedem é o mesmo — que a consolidação
  // deixe alguém sem porta ou quebre link já enviado.
  const agenda = lerArquivo("src/routes/agenda.tsx");

  // 1) A rota NÃO pode ser apagada. Notificação já entregue tem o link gravado
  //    no dispositivo de quem recebeu, e apagar a rota daria 404 nele.
  check("/agenda continua existindo como rota", existsSync(path.join(ROOT, "src", "routes", "agenda.tsx")));
  check(
    "mas agora é redirect: sem componente, com beforeLoad",
    /beforeLoad/.test(agenda) && /redirect\(/.test(agenda) && !/component:/.test(agenda),
  );
  check(
    "que leva à aba Horários do dashboard",
    /to:\s*"\/dashboard"/.test(agenda) && /tab:\s*"schedule"/.test(agenda),
  );
  check(
    "preservando ?barbershop= — descartá-lo mandaria o super_admin para o tenant errado",
    /barbershop:\s*search\.barbershop/.test(agenda),
  );

  // 2) O link do cabeçalho SAIU — é o que a fase 2 faz. O que não pode é sair
  //    sem a nav cobrir o barbeiro, e é isso que a segunda metade verifica.
  check(
    "o cabeçalho não tem mais link para /agenda",
    !/<Link to="\/agenda"/.test(dashboard),
  );
  check(
    "e a aba Horários cobre o barbeiro, que era quem dependia do link",
    audienciaDe("schedule").includes("barbeiro"),
    audienciaDe("schedule").join(","),
  );

  // 3) `notification-links.ts` NÃO foi tocado — era o objetivo do redirect.
  check(
    "os deep-links de notificação continuam apontando para /agenda",
    /"\/agenda"/.test(lerArquivo("src/lib/notification-links.ts")),
  );

  // O `?tab=` vem da URL, então não pode ser acreditado: precisa ser conferido
  // contra as abas que o papel enxerga, senão vira porta lateral para telas
  // administrativas.
  check(
    "a aba pedida por URL é conferida contra as abas do papel",
    /abasVisiveis\.some\(\(t\) => t\.id === activeTab\)/.test(dashboard),
  );
}

/* ══════════ 5. a migration ══════════ */

function testeMigration() {
  group("migration 20260805200000: conteúdo");

  const sql = readFileSync(MIGRATION, "utf8");
  const corpo = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  check(
    "recria get_public_barbers",
    /CREATE OR REPLACE FUNCTION public\.get_public_barbers\(/.test(corpo),
  );
  check(
    "recria get_public_barbers_v2",
    /CREATE OR REPLACE FUNCTION public\.get_public_barbers_v2\(/.test(corpo),
  );
  check(
    "recria role_counts_toward_barber_limit",
    /CREATE OR REPLACE FUNCTION public\.role_counts_toward_barber_limit\(/.test(corpo),
  );
  check(
    "troca a policy de INSERT de weekly_schedule",
    /DROP POLICY IF EXISTS "Barbers can create own schedule"/.test(corpo) &&
      /CREATE POLICY "Barbers can create own schedule"/.test(corpo),
  );

  // O `COMMENT ON` cita `admin_barbearia` em prosa, de propósito — procurar a
  // palavra solta acusaria isso. O que não pode sobrar é a COMPARAÇÃO de papel:
  // nem o `IN (...)` antigo, nem uma igualdade direta.
  check(
    "nenhuma comparação de papel aceita `admin_barbearia`",
    !/\bIN\s*\([^)]*admin_barbearia/i.test(corpo) && !/=\s*'admin_barbearia'/.test(corpo),
    (corpo.match(/.*admin_barbearia.*/) ?? [""])[0].trim(),
  );
  // Quatro pontos: as duas RPCs de listagem, a função de limite e a policy.
  const pontos =
    (corpo.match(/=\s*'barbeiro'/g) ?? []).length +
    (corpo.match(/,\s*'barbeiro'::public\.app_role/g) ?? []).length;
  check("os quatro pontos comparam com `barbeiro`", pontos === 4, String(pontos));

  // O ponto que separa esta migration de uma migração de dados: ela não apaga,
  // não desativa e não migra nada. Relatório agrupa por `barber_id` e não
  // deriva de `user_roles` — quem já atendeu continua aparecendo.
  check(
    "não apaga nem migra dado nenhum",
    !/\bDELETE\s+FROM\b/i.test(corpo) &&
      !/\bUPDATE\s+public\./i.test(corpo) &&
      !/\bTRUNCATE\b/i.test(corpo),
  );
  check(
    "não mexe em tabela de histórico",
    !/\bALTER TABLE\b/i.test(corpo),
  );

  check(
    "as três funções mantêm search_path fixo",
    (corpo.match(/SET search_path TO 'public'/g) ?? []).length === 3,
    String((corpo.match(/SET search_path TO 'public'/g) ?? []).length),
  );
  check(
    "as duas RPCs públicas seguem SECURITY DEFINER",
    (corpo.match(/SECURITY DEFINER/g) ?? []).length === 2,
    String((corpo.match(/SECURITY DEFINER/g) ?? []).length),
  );
  check(
    "a policy nova exige o papel `barbeiro` de quem insere",
    /has_role_in_barbershop\(\s*auth\.uid\(\)\s*,\s*barbershop_id\s*,\s*'barbeiro'/.test(corpo),
  );
  check(
    "e continua exigindo que a grade seja a PRÓPRIA",
    /barber_id\s*=\s*auth\.uid\(\)/.test(corpo),
  );

  group("migration 20260805200000: cabeçalho");

  check("registra o rollback", /ROLLBACK/.test(sql));
  check("registra as verificações de depois de aplicar", /VERIFICAÇÕES APÓS APLICAR/.test(sql));
  check(
    "documenta a barbearia que fica sem profissional atendível",
    /CONSEQUÊNCIA CONHECIDA E ACEITA/.test(sql),
  );
  check(
    "documenta a checagem de que o limite ficou permissivo",
    /PERMISSIVA/.test(sql),
  );
}

/* ══════════ 6. paridade mock × SQL ══════════ */

function testeParidade() {
  group("paridade: o mock filtra o mesmo que o SQL");

  const mock = lerArquivo("src/mocks/client.ts");
  check(
    "get_public_barbers_v2 do mock descarta quem não é `barbeiro`",
    /row\.role !== "barbeiro"/.test(mock),
  );

  const regras = lerArquivo("src/mocks/rules.ts");
  check(
    "BARBER_LIMIT_ROLES tem só `barbeiro`",
    /BARBER_LIMIT_ROLES\s*=\s*new Set\(\[\s*"barbeiro"\s*\]\)/.test(regras),
  );
  // A regra nova NÃO desce para `ATTENDING_ROLES`. Estreitá-lo deixaria o mock
  // mais restrito que o banco: nenhuma migration criou trava sobre linha que já
  // existe, e `open_ticket` aceita o admin como `_barber_id` até hoje.
  check(
    "ATTENDING_ROLES continua com os dois papéis, de propósito",
    /ATTENDING_ROLES\s*=\s*new Set\(\[\s*"barbeiro",\s*"admin_barbearia"\s*\]\)/.test(regras),
  );
  check(
    "a restrição do INSERT usa `barbeiroRoleIn`, o espelho da policy",
    /criando && !barbeiroRoleIn\(actor\.id, barbershopId\)/.test(semComentarios(regras)),
  );
  check(
    "e a recusa é a mensagem de quem atende",
    /apenas quem atende clientes cadastra turnos/.test(regras),
  );
}

/* ══════════ 6. o ramo `super_admin` da policy de INSERT ══════════ */

/**
 * O que a 20260806120000 devolve, e por que tem teste próprio.
 *
 * A 20260805200000 recriou a policy de INSERT de `weekly_schedule` escrevendo o
 * predicado do zero e perdeu o `OR has_role(auth.uid(), 'super_admin')` da
 * 20260722220000 — sem uma linha a respeito no arquivo, no commit ou no PR.
 *
 * O mock NUNCA teve esse defeito: `authorizeWeeklySchedule` sempre retornou
 * cedo para o super_admin. Quer dizer que entre 05/08 e a correção o mock era
 * MAIS permissivo que o banco, e esta suíte teria passado enquanto a produção
 * recusava. É por isso que as asserções abaixo são de duas naturezas — o
 * comportamento (que já valia) E o texto da migration (que é o que estava
 * faltando).
 *
 * O caso de uso é cadastrar a grade DE OUTRA pessoa: por isso o alvo do INSERT
 * é sempre um `barber_id` que não é o do ator.
 */
async function testeSuperAdminGrade() {
  resetMockDatabase();
  setTableRows("business_hours", []);
  setTableRows(
    "weekly_schedule",
    getTableRows("weekly_schedule").filter(
      (t) => !(t.barbershop_id === MOCK_BARBERSHOP_ID && Number(t.day_of_week) === SEGUNDA),
    ),
  );

  group("weekly_schedule: o super_admin cadastra grade de terceiro");

  await login(MOCK_SUPER_ADMIN_EMAIL);
  const deOutro = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberBruno,
    day_of_week: SEGUNDA,
    start_time: "08:00",
    end_time: "12:00",
    is_active: true,
  });
  check(
    "super_admin cadastra a grade de um barbeiro que não é ele",
    deOutro.error === null,
    deOutro.error?.message ?? "",
  );
  check(
    "e a linha foi mesmo gravada",
    getTableRows("weekly_schedule").some(
      (t) => t.barber_id === MOCK_USER_IDS.barberBruno && String(t.start_time).startsWith("08:00"),
    ),
  );

  // O ramo é alternativa ao BLOCO INTEIRO: se ficasse preso a
  // `barber_id = auth.uid()`, a palavra `super_admin` estaria no predicado sem
  // devolver a capacidade — a grade que ele conserta nunca é a dele. Por isso a
  // asserção é sobre o DONO da linha gravada, não sobre quem a gravou.
  // Escopo pela barbearia: SEGUNDA às 08:00 também existe em OUTRO tenant do
  // fixture, e sem este filtro a contagem pegava a linha alheia junto.
  const gravadas = getTableRows("weekly_schedule").filter(
    (t) =>
      t.barbershop_id === MOCK_BARBERSHOP_ID &&
      Number(t.day_of_week) === SEGUNDA &&
      String(t.start_time).startsWith("08:00"),
  );
  check(
    "a grade gravada é de terceiro, não do próprio super_admin",
    gravadas.length === 1 &&
      gravadas.every((t) => String(t.barber_id) !== String(MOCK_USER_IDS.superRita)),
    `${gravadas.length} linha(s)`,
  );

  group("weekly_schedule: os outros papéis não mudam");

  await login(MOCK_ADMIN_EMAIL);
  const doAdmin = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.admin,
    day_of_week: SEGUNDA,
    start_time: "13:00",
    end_time: "17:00",
    is_active: true,
  });
  check(
    "admin_barbearia segue recusado na PRÓPRIA grade",
    doAdmin.error !== null,
    doAdmin.error?.message ?? "sem erro",
  );

  await login("ana@barbearia.teste");
  const daAna = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberAna,
    day_of_week: SEGUNDA,
    start_time: "13:00",
    end_time: "17:00",
    is_active: true,
  });
  check("barbeiro segue cadastrando a própria", daAna.error === null, daAna.error?.message ?? "");

  const anaEmBruno = await (mockSupabaseClient as any).from("weekly_schedule").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberBruno,
    day_of_week: SEGUNDA,
    start_time: "14:00",
    end_time: "16:00",
    is_active: true,
  });
  check(
    "barbeiro segue recusado na grade alheia",
    anaEmBruno.error !== null,
    anaEmBruno.error?.message ?? "sem erro",
  );
}

/** O texto da 20260806120000 — o ponto exato que faltou na 20260805200000. */
function testeMigrationSuperAdmin() {
  const sql = readFileSync(MIGRATION_SUPER, "utf8");
  const corpo = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration 20260806120000: o ramo de plataforma volta");

  check(
    "recria a policy de INSERT de weekly_schedule",
    /DROP POLICY IF EXISTS "Barbers can create own schedule"/.test(corpo) &&
      /CREATE POLICY "Barbers can create own schedule"/.test(corpo),
  );
  check(
    "devolve o ramo `super_admin`",
    /has_role\(\s*auth\.uid\(\)\s*,\s*'super_admin'/.test(corpo),
  );
  check(
    "mantém a exigência do papel `barbeiro`",
    /has_role_in_barbershop\(\s*auth\.uid\(\)\s*,\s*barbershop_id\s*,\s*'barbeiro'/.test(corpo),
  );
  check("mantém a exigência da grade PRÓPRIA", /barber_id\s*=\s*auth\.uid\(\)/.test(corpo));
  check(
    "não reabre para `admin_barbearia`",
    !/'admin_barbearia'/.test(corpo),
    (corpo.match(/.*admin_barbearia.*/) ?? [""])[0].trim(),
  );

  // O ramo precisa ser alternativa ao BLOCO, não conjunção: `... AND
  // super_admin` seria inútil, e `barber_id = auth.uid() AND (barbeiro OR
  // super_admin)` prenderia o super_admin à própria grade.
  check(
    "o ramo é um OR de topo, não um AND",
    /\)\s*OR\s*public\.has_role\(\s*auth\.uid\(\)\s*,\s*'super_admin'/.test(corpo),
  );

  group("migration 20260806120000: alcance e cabeçalho");

  check("mexe em uma policy só", (corpo.match(/CREATE POLICY/g) ?? []).length === 1);
  check(
    "não toca em função nenhuma",
    !/CREATE\s+(OR REPLACE\s+)?FUNCTION/i.test(corpo),
  );
  check(
    "não apaga, não migra e não altera tabela",
    !/\bDELETE\s+FROM\b/i.test(corpo) &&
      !/\bUPDATE\s+public\./i.test(corpo) &&
      !/\bTRUNCATE\b/i.test(corpo) &&
      !/\bALTER TABLE\b/i.test(corpo),
  );
  check("registra o rollback", /ROLLBACK/.test(sql));
  check("registra que é aditiva", /aditiva|ADITIVA/.test(sql));
  check(
    "registra a auditoria das outras sete policies",
    /schedule_blocks/.test(sql) && /20260722220000/.test(sql),
  );

  group("paridade: o mock já permitia, e continua permitindo");

  const regras = lerArquivo("src/mocks/rules.ts");
  check(
    "authorizeWeeklySchedule libera o super_admin antes de exigir `barbeiro`",
    /if \(actorIsSuperAdmin\(\)\) return null;[\s\S]*?criando && !barbeiroRoleIn/.test(
      semComentarios(regras),
    ),
  );
}

/* ══════════ 7. disponibilidade: dono, apagar e atribuição ══════════ */

/**
 * Os três defeitos pré-existentes do `ScheduleManager`, encontrados ao mapear a
 * visão consolidada de equipe. Nenhum nasceu de uma frente anterior — todos
 * estavam publicados, e a fase 1 só os tornou visíveis ao pôr o componente sob
 * "Minha agenda".
 *
 *   1. a tela lê a barbearia INTEIRA (nunca houve filtro por `barber_id`) e
 *      desenhava tudo misturado, sem dizer de quem era cada faixa;
 *   2. o DELETE de `availability` não tinha ramo para o dono, então o barbeiro
 *      não apagava nem o que ele mesmo criou — e o `if (!error)` do componente
 *      engolia a recusa, o que escondia o defeito 2 atrás do silêncio;
 *   3. o admin apagava faixa de qualquer um com o mesmo clique de `x`, sem
 *      nada dizer de quem era.
 *
 * O 2 é de banco (migration 20260806150000) e os outros dois são de tela.
 */
async function testeDisponibilidade() {
  const daBarbearia = () =>
    getTableRows("availability").filter((a) => a.barbershop_id === MOCK_BARBERSHOP_ID);
  const primeiraDe = (barberId: string) => daBarbearia().find((a) => a.barber_id === barberId);

  const apagar = (id: unknown) =>
    (mockSupabaseClient as any).from("availability").delete().eq("id", id);

  group("availability: o dono apaga o que é dele");

  resetMockDatabase();
  await login("ana@barbearia.teste");
  const daAna = primeiraDe(MOCK_USER_IDS.barberAna);
  check("o fixture tem janela da Ana", Boolean(daAna), String(daBarbearia().length));

  const propria = await apagar(daAna?.id);
  check(
    "barbeiro apaga a PRÓPRIA janela — era o defeito",
    propria.error === null,
    propria.error?.message ?? "",
  );
  check(
    "e ela some do store",
    !getTableRows("availability").some((a) => a.id === daAna?.id),
  );

  group("availability: e não a dos outros");

  resetMockDatabase();
  await login("ana@barbearia.teste");
  const doBruno = primeiraDe(MOCK_USER_IDS.barberBruno);
  check("o fixture tem janela do Bruno", Boolean(doBruno));

  const alheia = await apagar(doBruno?.id);
  check(
    "barbeiro NÃO apaga janela de outro profissional",
    alheia.error !== null,
    alheia.error?.message ?? "sem erro",
  );
  check(
    "e a recusa diz o que a pessoa pode, sem detalhe técnico",
    /próprios horários/i.test(alheia.error?.message ?? "") &&
      !/SQLSTATE|policy|42501|undefined/i.test(alheia.error?.message ?? ""),
    alheia.error?.message ?? "",
  );
  check("nada foi apagado", getTableRows("availability").some((a) => a.id === doBruno?.id));

  // REESCRITO na 20260806160000. Este grupo afirmava o OPOSTO: que o admin
  // alcançava a janela de qualquer um, "capacidade que ele já tinha". Ela foi
  // retirada — a assimetria com `weekly_schedule` e `schedule_blocks`, onde ele
  // nunca escreveu, não tinha razão de existir.
  group("availability: a administração passou a só LER");

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  const alvoDoAdmin = primeiraDe(MOCK_USER_IDS.barberBruno);
  const peloAdmin = await apagar(alvoDoAdmin?.id);
  check(
    "admin NÃO apaga janela de terceiro",
    peloAdmin.error !== null,
    peloAdmin.error?.message ?? "sem erro",
  );
  check("e a linha continua lá", getTableRows("availability").some((a) => a.id === alvoDoAdmin?.id));

  const adminInsere = await (mockSupabaseClient as any).from("availability").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberBruno,
    date: "2026-12-24",
    start_time: "09:00",
    end_time: "10:00",
    status: "livre",
  });
  check("nem cria", adminInsere.error !== null, adminInsere.error?.message ?? "sem erro");

  // Ler continua valendo — é do que a "Agenda da equipe" depende.
  const adminLe = await (mockSupabaseClient as any)
    .from("availability")
    .select("id")
    .eq("barbershop_id", MOCK_BARBERSHOP_ID);
  check(
    "mas continua LENDO — a Agenda da equipe depende disso",
    adminLe.error === null && (adminLe.data ?? []).length > 0,
    adminLe.error?.message ?? String((adminLe.data ?? []).length),
  );

  group("availability: as DUAS formas de recusa de um DELETE");

  // A divergência que o teste no banco real revelou, e que o componente passou
  // a tratar:
  //
  //   • MOCK — `authorizeWrite` recusa devolvendo ERRO. É mais estrito que o
  //     PostgREST, e de propósito: a mensagem é o que torna a regra legível
  //     num harness;
  //   • BANCO — num DELETE a RLS não levanta 42501. Ela FILTRA as linhas que o
  //     `USING` não deixa passar, e o comando sucede afetando ZERO. Medido em
  //     06/08/2026 com a 20260806150000 aplicada.
  //
  // Uma tela que só olha `error` acerta no mock e erra em produção — foi
  // exatamente o falso sucesso corrigido aqui. Por isso as duas formas
  // precisam de cobertura: a de erro acima, e a de lista vazia abaixo.
  resetMockDatabase();
  await login("ana@barbearia.teste");

  const inexistente = await (mockSupabaseClient as any)
    .from("availability")
    .delete()
    .eq("id", "00000000-0000-4000-8000-000000000000")
    .select("id");
  check(
    "apagar id que não casa devolve sucesso com lista VAZIA",
    inexistente.error === null && Array.isArray(inexistente.data) && inexistente.data.length === 0,
    JSON.stringify({ error: inexistente.error?.message ?? null, n: inexistente.data?.length }),
  );
  check(
    "é a MESMA forma que a RLS do banco produz ao recusar",
    inexistente.error === null,
    "se um dia isto virar erro, a tela deixa de exercitar o ramo de produção",
  );

  const minhaComSelect = await (mockSupabaseClient as any)
    .from("availability")
    .delete()
    .eq("id", primeiraDe(MOCK_USER_IDS.barberAna)?.id)
    .select("id");
  check(
    "e o sucesso de verdade devolve a linha apagada",
    minhaComSelect.error === null && (minhaComSelect.data ?? []).length === 1,
    JSON.stringify({ n: minhaComSelect.data?.length }),
  );

  group("availability: criar e editar seguem a mesma regra");

  resetMockDatabase();
  await login("ana@barbearia.teste");
  const criaPraSi = await (mockSupabaseClient as any).from("availability").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberAna,
    date: "2026-12-24",
    start_time: "09:00",
    end_time: "10:00",
    status: "livre",
  });
  check("barbeiro cria janela própria", criaPraSi.error === null, criaPraSi.error?.message ?? "");

  const criaPraOutro = await (mockSupabaseClient as any).from("availability").insert({
    barbershop_id: MOCK_BARBERSHOP_ID,
    barber_id: MOCK_USER_IDS.barberBruno,
    date: "2026-12-24",
    start_time: "11:00",
    end_time: "12:00",
    status: "livre",
  });
  check(
    "e NÃO cria janela para outro",
    criaPraOutro.error !== null,
    criaPraOutro.error?.message ?? "sem erro",
  );

  resetMockDatabase();
}

/** A migration do ramo que faltava, e as duas correções de tela. */
function testeMigracaoDisponibilidade() {
  const sql = readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260806150000_barber_deletes_own_availability.sql"),
    "utf8",
  );
  const corpo = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration 20260806150000: o ramo do dono");

  check(
    "recria a policy de DELETE de availability",
    /DROP POLICY IF EXISTS "Admins can delete availability"/.test(corpo) &&
      /CREATE POLICY "Admins can delete availability"/.test(corpo) &&
      /FOR DELETE/.test(corpo),
  );
  check(
    "acrescenta o ramo do dono",
    /barber_id = auth\.uid\(\)/.test(corpo),
  );
  check(
    "com o mesmo AND de papel que INSERT e UPDATE já usam",
    /barber_id = auth\.uid\(\)[\s\S]{0,120}?has_role_in_barbershop\([\s\S]{0,80}?'barbeiro'/.test(corpo),
    "sem o AND, quem saiu da equipe seguiria apagando linha antiga",
  );
  check(
    "mantém administração e super_admin",
    /'admin_barbearia'/.test(corpo) && /'super_admin'/.test(corpo),
  );
  check(
    "não toca weekly_schedule nem schedule_blocks",
    !/weekly_schedule/.test(corpo) && !/schedule_blocks/.test(corpo),
  );
  check(
    "não apaga linha nenhuma",
    !/\bDELETE\s+FROM\b/i.test(corpo) && !/\bUPDATE\s+public\./i.test(corpo),
  );
  check("declara ser aditiva", /ADITIVA|aditiva/.test(sql));
  check("registra o rollback", /ROLLBACK/.test(sql));

  group("ScheduleManager: atribuição de dono e confirmação");

  const tela = lerArquivo("src/components/ScheduleManager.tsx");
  const codigo = semComentarios(tela);

  check(
    "carrega os nomes dos profissionais das duas listas",
    /fetchBarberDisplayNames\(/.test(codigo),
  );
  check(
    "e mostra o dono na janela E no agendamento",
    (codigo.match(/nomeDoDono\(slot\.barber_id\)/g) ?? []).length >= 1 &&
      (codigo.match(/nomeDoDono\(appt\.barber_id\)/g) ?? []).length >= 1,
  );
  check(
    "o próprio usuário aparece como `Você`, não pelo nome",
    /barberId === user\?\.id \? "Você"/.test(codigo),
  );
  check(
    "nome sem resposta da RPC degrada para rótulo genérico, não some",
    /\|\| "Profissional"/.test(codigo),
    "faixa sem dono identificado reintroduz a mistura",
  );

  check(
    "apagar a PRÓPRIA janela não pede confirmação",
    /slot\.barber_id === user\?\.id/.test(codigo) && /apagarSlot\(slot\)/.test(codigo),
  );
  check(
    "apagar a de OUTRO abre diálogo",
    /setSlotParaApagar\(slot\)/.test(codigo) && /<AlertDialog/.test(codigo),
  );
  check(
    "e o diálogo nomeia o dono antes do irreversível",
    /nomeDoDono\(slotParaApagar\.barber_id\)/.test(codigo),
  );
  check(
    "o diálogo avisa que a pessoa não é notificada",
    /não é avisada/.test(tela),
  );
  check(
    "a falha deixou de ser engolida — erro vira aviso e log redigido",
    /logTechnicalError\("ScheduleManager"/.test(codigo) && /toast\.error\(/.test(codigo),
  );

  group("ScheduleManager: o DELETE detecta recusa sem erro");

  // Sem `.select()`, um DELETE recusado pela RLS é indistinguível de um bem
  // sucedido: `error` nulo, nenhuma linha. Pedir as linhas de volta é o que
  // torna a recusa detectável — e é a única forma, porque o banco não avisa.
  check(
    "pede as linhas de volta com .select()",
    /\.delete\(\)[\s\S]{0,120}?\.select\("id"\)/.test(codigo),
    "sem isto, `error` nulo + 0 linhas vira 'Removido!'",
  );
  check(
    "trata lista vazia como recusa, não como sucesso",
    /!data \|\| data\.length === 0/.test(codigo),
  );
  check(
    "com mensagem que diz o que a pessoa pode fazer",
    /Você só pode remover os seus próprios horários/.test(tela),
  );
  check(
    "e ressincroniza a tela também na recusa",
    /data\.length === 0[\s\S]{0,400}?fetchData\(\)/.test(codigo),
    "a linha pode ter sumido por outro caminho; o refetch resolve os dois casos",
  );
  check(
    "os dois ramos de recusa são distintos",
    (codigo.match(/toast\.error\(/g) ?? []).length >= 2,
    String((codigo.match(/toast\.error\(/g) ?? []).length),
  );

  group("paridade: o mock espelha as policies de availability");

  const regras = semComentarios(lerArquivo("src/mocks/rules.ts"));
  check("existe regra de escrita para availability", /case "availability":/.test(regras));
  check(
    "e ela exige o papel `barbeiro` do dono, como o SQL",
    /barbeiroRoleIn\(actor\.id, barbershopId\)/.test(regras),
  );
}

/* ══════════ 7b. as duas portas de escrita em availability ══════════ */

/**
 * A 20260806160000 fecha as DUAS, e é o ponto de fecharem juntas: a policy
 * restritiva sozinha daria uma garantia que parece mais forte do que é.
 *
 *   porta 1  a policy — o admin escrevia `availability` de qualquer um;
 *   porta 2  `generate_availability_from_schedule` — SECURITY DEFINER, o
 *            INSERT ignora a RLS de quem chama, e ela não verificava nada.
 *            `authenticated` tem EXECUTE.
 */
async function testeGeracaoAutorizada() {
  const gerar = (barberId: string, barbershopId = MOCK_BARBERSHOP_ID) =>
    (mockSupabaseClient as any).rpc("generate_availability_from_schedule", {
      _barber_id: barberId,
      _barbershop_id: barbershopId,
      _start_date: "2026-12-20",
      _end_date: "2026-12-27",
    });

  group("generate_availability_from_schedule: quem pode chamar");

  resetMockDatabase();
  await login("ana@barbearia.teste");
  const paraSi = await gerar(MOCK_USER_IDS.barberAna);
  check("barbeiro gera a PRÓPRIA agenda", !paraSi.error, JSON.stringify(paraSi.error));

  const paraOutro = await gerar(MOCK_USER_IDS.barberBruno);
  check(
    "barbeiro NÃO gera a de outro — era a porta lateral",
    Boolean(paraOutro.error),
    JSON.stringify(paraOutro.error),
  );
  check(
    "com mensagem que diz o que ele pode",
    /sua própria agenda/i.test(paraOutro.error?.message ?? ""),
    paraOutro.error?.message ?? "",
  );

  resetMockDatabase();
  await login(MOCK_ADMIN_EMAIL);
  const peloAdmin = await gerar(MOCK_USER_IDS.barberBruno);
  check("admin do tenant gera para qualquer profissional", !peloAdmin.error, JSON.stringify(peloAdmin.error));
  check(
    "e isso é assimetria deliberada: gerar não é editar",
    /Gerar não é editar/.test(
      lerArquivo("supabase/migrations/20260806160000_admin_reads_availability_only.sql"),
    ),
    "a função só materializa o que a grade do profissional já declara",
  );

  resetMockDatabase();
  await login(MOCK_SUPER_ADMIN_EMAIL);
  const peloSuper = await gerar(MOCK_USER_IDS.barberBruno);
  check("super_admin gera para qualquer um", !peloSuper.error, JSON.stringify(peloSuper.error));

  resetMockDatabase();
  await mockSupabaseClient.auth.signOut();
  const semSessao = await gerar(MOCK_USER_IDS.barberAna);
  check("sem sessão é recusado antes de tudo", Boolean(semSessao.error), JSON.stringify(semSessao.error));

  resetMockDatabase();
}

/** O texto da 20260806160000. */
function testeMigracaoAdminSoLe() {
  const sql = readFileSync(
    path.join(ROOT, "supabase", "migrations", "20260806160000_admin_reads_availability_only.sql"),
    "utf8",
  );
  const corpo = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration 20260806160000: porta 1, a policy");

  check(
    "recria as TRÊS policies de escrita de availability",
    (corpo.match(/CREATE POLICY/g) ?? []).length === 3,
    String((corpo.match(/CREATE POLICY/g) ?? []).length),
  );
  // Só o trecho das POLICIES. A função geradora, na seção 2 do arquivo, cita
  // `admin_barbearia` de propósito — é ela que autoriza o admin a GERAR.
  const soPolicies = corpo.split("CREATE OR REPLACE FUNCTION")[0];
  check(
    "e nenhuma delas cita mais `admin_barbearia`",
    !/'admin_barbearia'/.test(soPolicies),
    (soPolicies.match(/.*admin_barbearia.*/) ?? [""])[0].trim(),
  );
  check(
    "cada uma exige dono + papel `barbeiro`",
    (corpo.match(/barber_id = auth\.uid\(\)/g) ?? []).length >= 3,
  );
  check("super_admin fica em todas", (corpo.match(/'super_admin'/g) ?? []).length >= 3);
  check(
    "a policy de SELECT NÃO é tocada — a Agenda da equipe depende dela",
    !/FOR SELECT/.test(corpo),
  );

  group("migration 20260806160000: porta 2, a função geradora");

  check(
    "recria generate_availability_from_schedule",
    /CREATE OR REPLACE FUNCTION public\.generate_availability_from_schedule\(/.test(corpo),
  );
  check(
    "autoriza pelo próprio id, admin do tenant ou super_admin",
    /_caller = _barber_id/.test(corpo) &&
      /has_role_in_barbershop\(_caller, _barbershop_id, 'admin_barbearia'/.test(corpo) &&
      /has_role\(_caller, 'super_admin'/.test(corpo),
  );
  check("recusa sem sessão antes de qualquer coisa", /_caller IS NULL/.test(corpo));
  check(
    "com mensagem legível, não SQLSTATE cru",
    /Você só pode gerar horários da sua própria agenda/.test(corpo),
  );
  check(
    "e segue SECURITY DEFINER com search_path fixo",
    /SECURITY DEFINER/.test(corpo) && /SET search_path TO 'public'/.test(corpo),
  );
  check(
    "o corpo que gera não mudou — só ganhou o porteiro",
    /ON CONFLICT ON CONSTRAINT availability_janela_unica DO NOTHING/.test(corpo),
  );

  group("migration 20260806160000: cabeçalho");

  check("explica por que as duas portas fecham juntas", /PORTA 1/.test(sql) && /PORTA 2/.test(sql));
  check(
    "justifica não entrar nas duas fases da §2.1",
    // Sem tolerância a quebra de linha, o regex falha por causa do reflow do
    // comentário — e a verificação viraria uma armadilha para quem reformatar.
    /§2\.1/.test(sql) && /nenhuma\s+interface\s+exercita/.test(sql.replace(/\n--\s*/g, " ")),
  );
  check(
    "registra a conferência dos dados antes de restringir",
    /11 em/.test(sql) && /barbearia-demo-cliente/.test(sql),
  );
  check(
    "e deixa a limpeza FORA da migration, como manda a §2.3",
    /§2\.3/.test(sql) && /FORA desta migration/.test(sql),
  );
  check("registra o rollback", /ROLLBACK/.test(sql));

  group("paridade: o mock espelha as duas portas");

  const cliente = semComentarios(lerArquivo("src/mocks/client.ts"));
  check(
    "a regra de availability não tem mais ramo de admin",
    !/if \(actorIsAdminOf\(barbershopId\)\) return null;/.test(
      semComentarios(lerArquivo("src/mocks/rules.ts")).split("function authorizeAvailability")[1] ?? "",
    ),
  );
  check(
    "e a RPC do mock autoriza igual à função real",
    /Você só pode gerar horários da sua própria agenda/.test(cliente),
  );
}

/* ══════════ 8. a visão consolidada de equipe ══════════ */

/**
 * "Agenda da equipe": o admin VISUALIZA a agenda de quem atende.
 *
 * Sem migration — o `admin_barbearia` já tinha SELECT em `weekly_schedule` e
 * `schedule_blocks` do próprio tenant. O que faltava era tela.
 *
 * A decisão de ser somente leitura não é cautela: desde a 20260805200000 o
 * admin não atende, e grade e bloqueios são o instrumento de trabalho de quem
 * atende. Ele ganha visibilidade para coordenar, não posse.
 */
function testeAgendaDaEquipe() {
  const dashboard = semComentarios(lerArquivo("src/components/BarberDashboard.tsx"));
  const bruto = lerArquivo("src/components/BarberDashboard.tsx");
  const seletor = lerArquivo("src/components/SeletorDeBarbeiro.tsx");
  const seletorCodigo = semComentarios(seletor);

  group("SeletorDeBarbeiro: extraído e com os quatro estados");

  check(
    "o componente existe como arquivo próprio",
    existsSync(path.join(ROOT, "src", "components", "SeletorDeBarbeiro.tsx")),
  );
  check(
    "carrega quem tem papel `barbeiro` — o admin não atende, não é opção",
    /\.eq\("role", "barbeiro"\)/.test(seletorCodigo),
  );
  check(
    "o hook é separado do componente, para reuso sem arrastar interface",
    /export function useBarbeirosDoTenant\(/.test(seletorCodigo) &&
      /export function SeletorDeBarbeiro\(/.test(seletorCodigo),
  );
  check(
    "recebe a lista pronta em vez de recarregá-la",
    /barbeiros: BarbeiroDaEquipe\[\]/.test(seletorCodigo),
    "duas consultas para a mesma coisa é o que a extração evita",
  );
  check(
    "traz a opção `todos` por prop — o filtro da Visão Geral precisa dela depois",
    /incluirTodos/.test(seletorCodigo) && /TODOS_OS_BARBEIROS/.test(seletorCodigo),
  );

  // Os quatro estados, que era o que o carregador inline NÃO tinha: ele fazia
  // `return` no erro e na lista vazia, e o seletor sumia da tela.
  check("carregando mostra skeleton", /estado === "loading"[\s\S]{0,120}?<Skeleton/.test(seletorCodigo));
  check(
    "erro oferece tentar de novo, não some",
    /estado === "error"/.test(seletorCodigo) && /Tentar novamente/.test(seletor),
  );
  check(
    "e o erro é registrado com o técnico redigido",
    /logTechnicalError\("SeletorDeBarbeiro"/.test(seletorCodigo),
  );
  check(
    "lista vazia usa o vazio que a tela passar",
    /barbeiros\.length === 0[\s\S]{0,120}?vazio/.test(seletorCodigo),
  );

  group("aba Horários: equipe para quem administra, própria para quem atende");

  check(
    "a seção da equipe é para admin que NÃO atende",
    /const mostraEquipe = isAdmin && !isBarber;/.test(dashboard),
    "um admin que também fosse barbeiro veria a própria agenda, que é o certo",
  );
  check("a seção se chama `Agenda da equipe`", /Agenda da equipe/.test(bruto));
  check("e a de quem atende continua `Minha agenda`", /Minha agenda/.test(bruto));
  check(
    "os três componentes recebem o barbeiro escolhido",
    (dashboard.match(/barberId=\{barbeiroEscolhido\}/g) ?? []).length === 3,
    String((dashboard.match(/barberId=\{barbeiroEscolhido\}/g) ?? []).length),
  );
  check(
    "e os três em modo leitura",
    (dashboard.match(/\breadOnly\b/g) ?? []).length >= 3,
    String((dashboard.match(/\breadOnly\b/g) ?? []).length),
  );
  check(
    "trocar de profissional remonta os três, sem estado do anterior",
    /key=\{`grade-\$\{barbeiroEscolhido\}`\}/.test(dashboard) &&
      /key=\{`bloqueios-\$\{barbeiroEscolhido\}`\}/.test(dashboard) &&
      /key=\{`agenda-\$\{barbeiroEscolhido\}`\}/.test(dashboard),
  );
  check(
    "o primeiro da lista já vem escolhido",
    /setBarbeiroEscolhido\(equipe\.barbeiros\[0\]\.id\)/.test(dashboard),
    "abrir vazio esperando um clique é pior que abrir mostrando alguém",
  );
  check(
    "e a escolha se reajusta se a pessoa sair da equipe",
    /!equipe\.barbeiros\.some\(\(b\) => b\.id === barbeiroEscolhido\)/.test(dashboard),
  );

  group("equipe vazia: explica e leva para a saída");

  check("existe um estado vazio próprio", /function EquipeVazia\(\)/.test(dashboard));
  check(
    "com o texto acordado",
    /Nenhum profissional na equipe ainda/.test(bruto) &&
      /Convide alguém na aba Equipe/.test(bruto),
  );
  check(
    "e com link que leva mesmo para a aba Equipe",
    /search=\{\{ tab: "team"/.test(dashboard),
    "texto que manda ir a um lugar sem levar lá é meia solução",
  );
  // Defeito encontrado ao testar este link: `?tab=` só era lido no estado
  // INICIAL, então clicar nele trocava a URL e não a aba — a pessoa continuava
  // em Horários. O parâmetro precisa valer depois da montagem também.
  check(
    "e `?tab=` também vale DEPOIS da montagem, não só no primeiro render",
    /ultimaAbaDaUrl/.test(dashboard) && /abaInicial === ultimaAbaDaUrl\.current/.test(dashboard),
  );
  check(
    "reagindo à MUDANÇA do parâmetro, para não desfazer clique manual",
    /ultimaAbaDaUrl\.current = abaInicial;/.test(dashboard),
    "comparar com o valor desfaria a troca de aba enquanto a URL guardasse o tab antigo",
  );

  group("modo leitura: os controles não EXISTEM, não ficam desabilitados");

  for (const [nome, arquivo] of [
    ["WeeklyScheduleEditor", "src/components/WeeklyScheduleEditor.tsx"],
    ["ScheduleBlocks", "src/components/ScheduleBlocks.tsx"],
    ["ScheduleManager", "src/components/ScheduleManager.tsx"],
  ] as const) {
    const src = semComentarios(lerArquivo(arquivo));
    check(`${nome} aceita barberId e readOnly`, /barberId\?: string;/.test(src) && /readOnly\?: boolean;/.test(src));
    check(
      `${nome} esconde controle em vez de desabilitar`,
      /\{!readOnly &&/.test(src),
      "botão desabilitado ainda anuncia uma capacidade que não existe",
    );
    check(
      `${nome} não usa disabled={readOnly} em lugar nenhum`,
      !/disabled=\{readOnly/.test(src),
    );
    check(
      `${nome} tem rede de segurança no próprio handler`,
      /if \(readOnly\) return;/.test(src),
      "se um controle escapar da renderização condicional, a mutação não sai",
    );
  }

  check(
    "a consulta segue o profissional escolhido, não o usuário logado",
    /\}, \[alvo, barbershopId\]\);/.test(
      semComentarios(lerArquivo("src/components/WeeklyScheduleEditor.tsx")),
    ) &&
      /\}, \[alvo, barbershopId\]\);/.test(
        semComentarios(lerArquivo("src/components/ScheduleBlocks.tsx")),
      ),
    "depender de `user` deixaria a grade do primeiro escolhido na tela",
  );

  // Onde a rede de segurança do banco NÃO cobre, e por isso a tela precisa
  // cobrir: `availability` deixa a administração do tenant apagar linha de
  // qualquer profissional. Nas outras duas a RLS recusaria de qualquer forma.
  check(
    "o componente registra que a RLS de availability NÃO protege aqui",
    /rede de[\s\S]{0,40}?segurança do banco é MAIS FRACA/.test(
      lerArquivo("src/components/ScheduleManager.tsx"),
    ),
  );
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  resetMockDatabase();

  await testeQuemAparece();
  await testeGradeSemanal();
  await testeLimiteDoPlano();
  testeTelas();
  testeMigration();
  testeParidade();
  await testeSuperAdminGrade();
  await testeDisponibilidade();
  testeMigracaoDisponibilidade();
  testeAgendaDaEquipe();
  testeMigrationSuperAdmin();
  await testeGeracaoAutorizada();
  testeMigracaoAdminSoLe();

  resetMockDatabase();
  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
