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

  group("BarberDashboard: uma porta para Comandas por papel, nunca zero");

  // O link do cabeçalho e a aba iam para o MESMO destino, mas não eram
  // intercambiáveis: a nav de abas renderiza sob `isAdmin`, e o link não tinha
  // condição nenhuma. Para o admin era duplicata; para o barbeiro era a única
  // porta incondicional para `/comandas`, que a rota autoriza a ele
  // (`canManage={scope.isAdmin || scope.isBarber}`).
  check(
    "o link do cabeçalho é condicionado a `!isAdmin`",
    /\{!isAdmin && \([\s\S]{0,120}?<Link to="\/comandas"/.test(dashboard),
  );
  check(
    "e é o ÚNICO <Link to=\"/comandas\" no arquivo — a aba usa `tab.href`",
    (dashboard.match(/<Link to="\/comandas"/g) ?? []).length === 1,
    String((dashboard.match(/<Link to="\/comandas"/g) ?? []).length),
  );

  // As duas metades da garantia: quem perde uma porta tem de manter a outra.
  // REESCRITAS na fase 1 da consolidação de /agenda: a entrada ganhou `para`, e
  // a nav deixou de ser `{isAdmin && ...}` para ser filtrada por papel.
  check(
    "a aba Comandas continua no array de abas",
    /id:\s*"comandas"/.test(dashboard) && /href:\s*"\/comandas"/.test(dashboard),
  );
  check(
    "e a nav só renderiza quando há mais de uma aba a mostrar",
    /\{abasVisiveis\.length > 1 && \(/.test(dashboard),
  );

  // Aqui a condição NEGATIVA é a correta, ao contrário da aba Horários acima.
  // Aquela decide quem ATENDE; esta decide quem NÃO TEM A ABA, e a aba é
  // `isAdmin` — o complemento exato é `!isAdmin`. Com `isBarber`, um papel
  // futuro (recepção) ficaria sem aba E sem link.
  check(
    "a condição do link não foi trocada por `isBarber`",
    !/\{\s*isBarber && \([\s\S]{0,120}?<Link to="\/comandas"/.test(dashboard),
    "isBarber deixaria um papel futuro sem porta nenhuma",
  );
  check(
    "o ícone segue em uso nos dois lugares, sem import órfão",
    (dashboard.match(/ReceiptText/g) ?? []).length >= 2,
    String((dashboard.match(/ReceiptText/g) ?? []).length),
  );

  group("BarberDashboard: a nav de abas é filtrada por papel, não por `isAdmin`");

  // A marcação de quem vê o quê tem de viver em UM lugar. Se voltar a se
  // espalhar em condicionais pela nav, estas verificações caem.
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
  group("fase 1 é aditiva — nada foi removido");

  check("/agenda continua existindo", existsSync(path.join(ROOT, "src", "routes", "agenda.tsx")));
  check(
    "o link do cabeçalho para /agenda continua lá",
    /<Link to="\/agenda"/.test(dashboard),
  );
  check(
    "os deep-links de notificação continuam apontando para /agenda",
    /"\/agenda"/.test(lerArquivo("src/lib/notification-links.ts")),
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
  testeMigrationSuperAdmin();

  resetMockDatabase();
  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
