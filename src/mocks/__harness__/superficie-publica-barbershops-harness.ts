/**
 * Harness da superfície pública de `barbershops`.
 *
 * A tabela tem 36 colunas e a vitrine pública precisa de 24. Até a migration
 * 20260804120000 existia uma view estreita e correta (`barbearias_publicas`) ao
 * lado de uma tabela larga aberta ao `anon` — ou seja, a view era convenção, e
 * bastava trocar o endpoint para receber `owner_id`, `plan_id`,
 * `appointments_this_month` e os campos de recibo.
 *
 * Prova a separação em seis frentes:
 *
 *   1. comportamento — a view do mock devolve as 24 colunas e NENHUMA das
 *      internas; `branding_enabled` reflete o plano;
 *   2. comportamento — `get_public_barbers_v2` devolve `is_owner` sem expor o
 *      `owner_id`, e recusa barbearia não aprovada, sentinela e id nulo;
 *   3. código — nenhuma tela do caminho anônimo consulta a tabela larga, e as
 *      telas internas continuam consultando;
 *   4. código — varredura da árvore INTEIRA de `src`: todo arquivo que consulta
 *      `barbershops` está numa lista conhecida e justificada. Foi essa
 *      varredura que achou os dois pontos anônimos que a revisão por
 *      componente de rota tinha deixado passar, os dois em hook;
 *   5. comportamento — a fase 2 APLICADA: o mock carrega o mapa real de
 *      privilégios (`src/mocks/grants.ts`), então o acesso direto do anônimo já
 *      dá 42501 por padrão, e o que se simula pelo `GRANT` é o estado ANTERIOR
 *      — que é também o rollback documentado. Vitrine, RPC e os dois caminhos
 *      de resolução do tenant continuam de pé;
 *   6. SQL — análise estática das migrations das duas fases.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE O TESTE DE `pending`/`rejected`/`_system` É OBRIGATÓRIO AQUI
 *
 * A fase 1 troca `security_invoker = true` por `false` na view — sem isso o
 * `REVOKE` da fase 2 derrubaria a vitrine junto com a exposição. O efeito
 * colateral é que a view passa a ler com os privilégios do dono (`postgres`,
 * BYPASSRLS): **a RLS deixa de ser a segunda barreira, e o `WHERE` da view
 * passa a ser a fronteira inteira.**
 *
 * Enquanto a RLS cobria a retaguarda, um erro no `WHERE` seria contido pela
 * policy. Agora não é. Por isso o filtro de status e o da sentinela deixaram de
 * ser detalhe de apresentação e viraram invariante de segurança testada.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows, setTableRows } from "@/mocks/store";
import { grantAnonSelect, resetAnonGrants } from "@/mocks/grants";
import { DEFAULT_BARBERSHOP_ID } from "@/lib/constants";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_C_ID,
  MOCK_BARBERSHOP_D_ID,
  MOCK_BARBERSHOP_E_ID,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

const ROOT = process.cwd();
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260804120000_public_barbershop_surface_phase1.sql",
);
const FASE2_ARQUIVO = "20260805130000_public_barbershop_surface_phase2.sql";
const FASE2_CAMINHO = path.join(ROOT, "supabase", "migrations", FASE2_ARQUIVO);

/**
 * Remove de um `.sql` os blocos `/* … *\/` e as linhas `--`.
 *
 * As migrations desta frente citam de propósito, em comentário, comandos que
 * NÃO executam (o rodapé da fase 1 traz o REVOKE inteiro, a fase 2a traz o
 * rollback das policies). Toda asserção sobre o que o SQL FAZ olha só o código
 * executável; as asserções sobre o que ele DOCUMENTA olham o arquivo cru.
 */
function semLinhasDeComentario(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
}

/** As 24 colunas que a view PODE devolver. */
const COLUNAS_PUBLICAS = [
  "id",
  "name",
  "subdomain",
  "logo_url",
  "primary_color",
  "secondary_color",
  "rating_avg",
  "rating_count",
  "created_at",
  "cep",
  "state",
  "city",
  "neighborhood",
  "street",
  "number",
  "complement",
  "status",
  "reschedule_min_hours",
  "cancel_min_hours",
  "noshow_policy_enabled",
  "noshow_max_count",
  "noshow_block_days",
  "timezone",
  "branding_enabled",
];

/** As 13 que ela NÃO pode devolver — é este o ganho da migration. */
const COLUNAS_INTERNAS = [
  "owner_id",
  "plan_id",
  "appointments_this_month",
  "updated_at",
  "whatsapp_message",
  "pdf_template",
  "pdf_slogan",
  "qr_size",
  "receipt_title",
  "receipt_subtitle",
  "receipt_footer",
  "receipt_thank_you_message",
  "receipt_whatsapp_intro",
];

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

function lerArquivo(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/**
 * Remove comentários de um fonte TS/TSX. As asserções de "não consulta X"
 * precisam olhar o código, não a explicação — vários destes arquivos citam de
 * propósito o que deixaram de fazer.
 */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

type Row = Record<string, unknown>;

async function vitrine(): Promise<Row[]> {
  const { data, error } = await (mockSupabaseClient as any)
    .from("barbearias_publicas")
    .select("*");
  if (error) throw new Error(`view falhou: ${JSON.stringify(error)}`);
  return (data ?? []) as Row[];
}

async function barbeiros(barbershopId: unknown): Promise<Row[]> {
  const { data, error } = await mockSupabaseClient.rpc("get_public_barbers_v2", {
    _barbershop_id: barbershopId,
  });
  if (error) throw new Error(`RPC falhou: ${JSON.stringify(error)}`);
  return (data ?? []) as Row[];
}

/* ══════════════ 1. o que a vitrine devolve ══════════════ */

async function testeColunas() {
  group("vitrine pública: acessível sem sessão");

  await mockSupabaseClient.auth.signOut();
  const { data: sessao } = await mockSupabaseClient.auth.getSession();
  check("nenhuma sessão ativa", !sessao?.session);

  const rows = await vitrine();
  check("anônimo consegue ler a vitrine", rows.length > 0);

  group("vitrine pública: colunas expostas");

  const amostra = rows[0] ?? {};
  for (const coluna of COLUNAS_PUBLICAS) {
    check(`devolve ${coluna}`, coluna in amostra, Object.keys(amostra).join(", "));
  }
  check(
    "devolve exatamente 24 colunas",
    Object.keys(amostra).length === 24,
    `${Object.keys(amostra).length}: ${Object.keys(amostra).join(", ")}`,
  );

  group("vitrine pública: colunas internas NÃO expostas");

  for (const coluna of COLUNAS_INTERNAS) {
    check(
      `${coluna} não vaza`,
      rows.every((r) => !(coluna in r)),
      "presente em ao menos uma linha da vitrine",
    );
  }
}

/* ══════════════ 2. o WHERE da view é a fronteira ══════════════ */

async function testeFronteira() {
  group("vitrine pública: só barbearia aprovada");

  const rows = await vitrine();
  const ids = rows.map((r) => String(r.id));

  check("barbearia aprovada aparece", ids.includes(MOCK_BARBERSHOP_ID));
  check(
    "barbearia PENDENTE não aparece",
    !ids.includes(MOCK_BARBERSHOP_E_ID),
    ids.join(", "),
  );
  check(
    "todas as linhas devolvidas estão aprovadas",
    rows.every((r) => r.status === "approved"),
    rows.map((r) => String(r.status)).join(", "),
  );

  // `rejected` não existe nas fixtures: criamos uma para o teste. Sem isso o
  // terceiro estado do enum nunca seria exercitado.
  group("vitrine pública: barbearia REJEITADA não aparece");

  const antes = getTableRows("barbershops");
  const rejeitada = { ...antes[0], id: "f0f0f0f0-0000-4000-8000-000000000001", subdomain: "rejeitada-teste", status: "rejected" };
  setTableRows("barbershops", [...antes, rejeitada]);

  const comRejeitada = await vitrine();
  check(
    "barbearia rejeitada não aparece na vitrine",
    !comRejeitada.some((r) => r.id === rejeitada.id),
    comRejeitada.map((r) => String(r.subdomain)).join(", "),
  );

  group("vitrine pública: sentinela _system não aparece");

  // A sentinela nasce `approved` (o DEFAULT da coluna), então o filtro de
  // status sozinho NÃO a esconde — é o `subdomain <> '_system'` que faz isso.
  // As fixtures não têm sentinela; ela é criada aqui justamente para provar
  // que o segundo predicado existe e funciona.
  const sentinela = { ...antes[0], id: "f0f0f0f0-0000-4000-8000-000000000002", subdomain: "_system", name: "_system", status: "approved" };
  setTableRows("barbershops", [...antes, rejeitada, sentinela]);

  const comSentinela = await vitrine();
  check(
    "sentinela _system não aparece na vitrine",
    !comSentinela.some((r) => r.subdomain === "_system"),
    comSentinela.map((r) => String(r.subdomain)).join(", "),
  );
  check(
    "sentinela seria aprovada — quem a esconde é o filtro de subdomínio",
    sentinela.status === "approved",
  );

  setTableRows("barbershops", antes);
}

/* ══════════════ 3. branding_enabled ══════════════ */

async function testeBranding() {
  group("branding_enabled: derivado do plano, sem expor plan_id");

  const rows = await vitrine();
  const porId = new Map(rows.map((r) => [String(r.id), r]));

  const a = porId.get(MOCK_BARBERSHOP_ID);
  const c = porId.get(MOCK_BARBERSHOP_C_ID);
  const d = porId.get(MOCK_BARBERSHOP_D_ID);

  check("barbearia do plano pro tem branding_enabled = true", a?.branding_enabled === true);
  check("barbearia do plano free tem branding_enabled = false", c?.branding_enabled === false);
  check("barbearia do plano enterprise tem branding_enabled = true", d?.branding_enabled === true);
  check(
    "branding_enabled é sempre booleano, nunca nulo",
    rows.every((r) => typeof r.branding_enabled === "boolean"),
  );
  check("plan_id continua fora da vitrine", rows.every((r) => !("plan_id" in r)));
}

/* ══════════════ 4. get_public_barbers_v2 ══════════════ */

async function testeBarbeiros() {
  group("get_public_barbers_v2: is_owner no lugar de owner_id");

  const lista = await barbeiros(MOCK_BARBERSHOP_ID);
  check("devolve profissionais da barbearia aprovada", lista.length > 0);
  check(
    "nenhuma linha carrega owner_id",
    lista.every((r) => !("owner_id" in r)),
    Object.keys(lista[0] ?? {}).join(", "),
  );
  check(
    "toda linha tem is_owner booleano",
    lista.every((r) => typeof r.is_owner === "boolean"),
  );

  // O dono da barbearia A administra e não atende. Desde 20260805200000 ele não
  // entra na lista, logo NINGUÉM aqui é proprietário — e isso não é lacuna do
  // teste: é o arranjo comum (quem administra não corta cabelo). O selo de
  // proprietário só faz sentido quando o dono também tem o papel `barbeiro`, e
  // esse caso é exercitado logo abaixo, montado de propósito.
  check(
    "dono que só administra não aparece — nenhum is_owner na lista",
    lista.every((r) => r.is_owner === false),
    lista.map((r) => `${r.user_id}:${r.is_owner}`).join(", "),
  );

  group("get_public_barbers_v2: quem entra na lista");

  const ids = lista.map((r) => String(r.user_id));
  check("não repete ninguém", new Set(ids).size === ids.length, ids.join(", "));
  check(
    "o admin_barbearia fica FORA — administra, não atende",
    !ids.includes(MOCK_USER_IDS.admin),
    ids.join(", "),
  );
  check("inclui os barbeiros comuns", ids.includes(MOCK_USER_IDS.barberAna));
  check("inclui todos os barbeiros, não só um", ids.includes(MOCK_USER_IDS.barberBruno));

  group("get_public_barbers_v2: is_owner quando o dono também atende");

  // Dono COM o papel `barbeiro`: é o único arranjo em que o selo aparece.
  const barbeariasAntes = getTableRows("barbershops");
  setTableRows(
    "barbershops",
    barbeariasAntes.map((b: Record<string, unknown>) =>
      b.id === MOCK_BARBERSHOP_ID ? { ...b, owner_id: MOCK_USER_IDS.barberBruno } : b,
    ),
  );

  const comDonoBarbeiro = await barbeiros(MOCK_BARBERSHOP_ID);
  const dono = comDonoBarbeiro.filter((r) => r.is_owner === true);
  check("exatamente um proprietário", dono.length === 1, `${dono.length}`);
  check(
    "o proprietário é o owner_id da barbearia",
    dono[0]?.user_id === MOCK_USER_IDS.barberBruno,
    String(dono[0]?.user_id),
  );
  // Bruno tem uuid MAIOR que o da Ana: sem o `is_owner DESC` do ORDER BY ele
  // viria depois. O teste só prova a ordenação por causa disso.
  check("o proprietário vem primeiro", comDonoBarbeiro[0]?.is_owner === true);

  setTableRows("barbershops", barbeariasAntes);

  group("get_public_barbers_v2: DISTINCT contra linha legada");

  // Desde 20260805160000 ninguém ACUMULA papel de equipe na mesma barbearia — o
  // índice parcial impede. Mas o DISTINCT do SQL continua sendo a defesa para
  // linha legada (nenhuma das migrations apaga nada), e é isso que se exercita
  // aqui: o cenário é construído de propósito, em vez de vir semeado, porque
  // semeá-lo faria as fixtures modelarem um estado que o banco real recusa.
  const papeisAntes = getTableRows("user_roles");
  setTableRows("user_roles", [
    ...papeisAntes,
    {
      id: "legado-barbeiro-duplicado",
      user_id: MOCK_USER_IDS.barberAna,
      barbershop_id: MOCK_BARBERSHOP_ID,
      role: "barbeiro",
      created_at: new Date().toISOString(),
    },
  ]);

  const comLegado = await barbeiros(MOCK_BARBERSHOP_ID);
  const idsLegado = comLegado.map((r) => String(r.user_id));
  check(
    "linha `barbeiro` duplicada não duplica a pessoa",
    idsLegado.filter((id) => id === MOCK_USER_IDS.barberAna).length === 1,
    idsLegado.join(", "),
  );
  check("e a lista não cresce", idsLegado.length === ids.length, `${idsLegado.length} vs ${ids.length}`);

  // O filtro é por PAPEL, não por pessoa: um acumulador legado que ainda tenha a
  // linha `barbeiro` continua atendível, e é assim que tem de ser — quem carrega
  // o papel de quem atende aparece. O conserto de um caso desses é remover a
  // linha de papel, não abrir exceção na RPC.
  setTableRows("user_roles", [
    ...papeisAntes,
    {
      id: "legado-dois-papeis",
      user_id: MOCK_USER_IDS.admin,
      barbershop_id: MOCK_BARBERSHOP_ID,
      role: "barbeiro",
      created_at: new Date().toISOString(),
    },
  ]);

  const comAcumulador = (await barbeiros(MOCK_BARBERSHOP_ID)).map((r) => String(r.user_id));
  check(
    "acumulador legado com papel `barbeiro` entra pela linha de barbeiro",
    comAcumulador.includes(MOCK_USER_IDS.admin) && comAcumulador.length === ids.length + 1,
    comAcumulador.join(", "),
  );
  check(
    "e entra uma vez só, apesar dos dois papéis",
    comAcumulador.filter((id) => id === MOCK_USER_IDS.admin).length === 1,
    comAcumulador.join(", "),
  );

  setTableRows("user_roles", papeisAntes);

  group("get_public_barbers_v2: recusas");

  check("barbearia PENDENTE devolve vazio", (await barbeiros(MOCK_BARBERSHOP_E_ID)).length === 0);
  check("id inexistente devolve vazio", (await barbeiros("00000000-0000-4000-8000-000000000000")).length === 0);
  check("id nulo devolve vazio", (await barbeiros(null)).length === 0);
  check("id indefinido devolve vazio", (await barbeiros(undefined)).length === 0);
}

/* ══════════════ 5. o frontend público não toca a tabela larga ══════════════ */

function testeFrontendPublico() {
  group("caminho anônimo não consulta a tabela barbershops");

  const publicos: Array<[string, string]> = [
    ["/barbearias", "src/routes/barbearias.tsx"],
    ["PublicBookingWizard", "src/components/booking/PublicBookingWizard.tsx"],
    ["/agendar/$slug", "src/routes/agendar.$slug.tsx"],
    ["manifest.json", "src/routes/manifest[.]json.tsx"],
    ["use-barbershop (resolução por subdomínio)", "src/hooks/use-barbershop.tsx"],
  ];

  for (const [nome, arquivo] of publicos) {
    const src = lerArquivo(arquivo);
    check(`${nome} consulta barbearias_publicas`, src.includes("barbearias_publicas"));
  }

  // Quatro dos cinco não podem citar a tabela de jeito nenhum. `use-barbershop`
  // é a exceção legítima: os caminhos por papel e por propriedade continuam
  // lendo a linha inteira, e são caminhos de sessão autenticada.
  for (const [nome, arquivo] of publicos.filter(([n]) => !n.startsWith("use-barbershop"))) {
    const src = lerArquivo(arquivo);
    check(
      `${nome} NÃO consulta a tabela barbershops`,
      !/from\(\s*["']barbershops["']\s*\)/.test(src),
    );
  }

  group("caminho anônimo não lê colunas internas");

  const wizard = lerArquivo("src/components/booking/PublicBookingWizard.tsx");
  check("PublicBookingWizard não seleciona owner_id", !/select\([^)]*owner_id/.test(wizard));
  check("PublicBookingWizard usa get_public_barbers_v2", wizard.includes("get_public_barbers_v2"));
  check("PublicBookingWizard decide o dono por is_owner", /\.is_owner/.test(wizard));

  const slug = semComentarios(lerArquivo("src/routes/agendar.$slug.tsx"));
  check("/agendar/$slug não faz select(\"*\")", !/select\(\s*["']\*["']\s*\)/.test(slug));
  check("/agendar/$slug usa branding_enabled", slug.includes("branding_enabled"));
  check(
    "/agendar/$slug não consulta mais a tabela plans",
    !/from\(\s*["']plans["']\s*\)/.test(slug),
  );

  const tema = lerArquivo("src/components/TenantThemeProvider.tsx");
  check("TenantThemeProvider prefere branding_enabled", tema.includes("branding_enabled"));

  const lista = lerArquivo("src/routes/barbearias.tsx");
  check("/barbearias traz as políticas na própria vitrine", lista.includes("noshow_block_days"));
}

/* ══════════════ 6. telas internas preservadas ══════════════ */

function testeFrontendInterno() {
  group("telas internas continuam lendo a tabela completa");

  // O super admin é quem mais depende da tabela larga: ele modera barbearias em
  // TODOS os status, e a vitrine só devolve aprovadas.
  const admin = lerArquivo("src/components/AdminDashboard.tsx");
  check("AdminDashboard lê a tabela barbershops", /from\(\s*["']barbershops["']\s*\)/.test(admin));
  check(
    "AdminDashboard NÃO passou a usar a vitrine pública",
    !admin.includes("barbearias_publicas"),
    "a vitrine só devolve aprovadas — a moderação perderia pending/rejected",
  );
  check("AdminDashboard continua alterando status", /\.update\(\{\s*status/.test(admin));

  const internas: Array<[string, string]> = [
    ["BarbershopSettings", "src/components/BarbershopSettings.tsx"],
    ["/configuracoes", "src/routes/configuracoes.tsx"],
    ["/comandas", "src/routes/comandas.tsx"],
    ["/agenda", "src/routes/agenda.tsx"],
  ];

  for (const [nome, arquivo] of internas) {
    const src = lerArquivo(arquivo);
    check(`${nome} continua lendo a tabela barbershops`, /from\(\s*["']barbershops["']\s*\)/.test(src));
  }

  // A RPC antiga não pode desaparecer: `NewComandaDialog` ainda a chama, e é
  // por isso que a fase 1 criou a v2 ao lado em vez de recriar a original.
  const comanda = lerArquivo("src/components/NewComandaDialog.tsx");
  check("NewComandaDialog ainda usa get_public_barbers (a antiga)", comanda.includes("get_public_barbers"));
}

/* ══════════════ 7. a migration em si ══════════════ */

function testeMigration() {
  const sql = readFileSync(MIGRATION, "utf8");
  const codigo = semLinhasDeComentario(sql);

  group("migration: vitrine ampliada");

  check("recria a view", /CREATE OR REPLACE VIEW public\.barbearias_publicas/.test(codigo));
  check("filtra status aprovado", /b\.status\s*=\s*'approved'::approval_status/.test(codigo));
  check("exclui a sentinela _system", /b\.subdomain\s*<>\s*'_system'::text/.test(codigo));
  check("mantém as 16 colunas originais na ordem", /b\.id,\s*\n\s*b\.name,\s*\n\s*b\.subdomain,/.test(codigo));
  check("acrescenta timezone", /b\.timezone,/.test(codigo));
  check("acrescenta as políticas de falta", /b\.noshow_block_days,/.test(codigo));
  check("deriva branding_enabled de plans", /AS branding_enabled/.test(codigo) && /p\.name IN \('pro', 'enterprise'\)/.test(codigo));

  // A checagem olha só a LISTA DE PROJEÇÃO da view. `b.plan_id` aparece
  // legitimamente dentro do EXISTS que deriva `branding_enabled`, e
  // `b.owner_id` dentro da função — o que não pode é serem devolvidos como
  // coluna. Cada coluna projetada ocupa uma linha própria no formato `  b.x,`.
  const blocoView =
    codigo.match(/CREATE OR REPLACE VIEW public\.barbearias_publicas AS([\s\S]*?);/)?.[1] ?? "";
  check("bloco da view localizado", blocoView.length > 0);

  for (const coluna of COLUNAS_INTERNAS) {
    check(
      `view não projeta ${coluna}`,
      !new RegExp(`^\\s*b\\.${coluna},?\\s*$`, "m").test(blocoView),
    );
  }

  group("migration: a view deixa de ser security_invoker");

  check(
    "vira security_invoker = false",
    /ALTER VIEW public\.barbearias_publicas SET \(security_invoker = false\)/.test(codigo),
    "sem isto o REVOKE da fase 2 derruba a vitrine junto com a exposição",
  );
  check("não deixa security_invoker = true no código", !/security_invoker = true/.test(codigo));
  check("explica a consequência para a fronteira de segurança", /fronteira de segurança/.test(sql));
  check("avisa sobre o linter do Supabase", /db:lint:remote/.test(sql));

  group("migration: get_public_barbers_v2");

  check("cria a v2", /CREATE OR REPLACE FUNCTION public\.get_public_barbers_v2/.test(codigo));
  check("é SECURITY DEFINER", /SECURITY DEFINER/.test(codigo));
  check("fixa search_path", /SET search_path TO 'public'/.test(codigo));
  check("é STABLE (não escreve)", /\bSTABLE\b/.test(codigo));
  check("devolve is_owner", /is_owner boolean/.test(codigo));
  check("calcula is_owner por comparação com owner_id", /\(ur\.user_id = b\.owner_id\) AS is_owner/.test(codigo));
  check("não devolve owner_id como coluna", !/^\s*owner_id\s+uuid/m.test(codigo));
  check("deduplica com DISTINCT", /SELECT DISTINCT/.test(codigo));
  check("exige barbearia aprovada", /b\.status\s*=\s*'approved'/.test(codigo));
  check("exclui a sentinela", /b\.subdomain\s*<>\s*'_system'/.test(codigo));
  check("recusa id nulo", /_barbershop_id IS NOT NULL/.test(codigo));
  check("ordena o proprietário primeiro", /ORDER BY is_owner DESC/.test(codigo));
  check("não usa SELECT * no código executável", !/SELECT\s+\*/i.test(codigo));

  group("migration: grants");

  check("revoga EXECUTE de PUBLIC", /REVOKE ALL ON FUNCTION public\.get_public_barbers_v2\(uuid\) FROM PUBLIC/.test(codigo));
  check("concede EXECUTE a anon e authenticated", /GRANT EXECUTE ON FUNCTION public\.get_public_barbers_v2\(uuid\) TO anon, authenticated/.test(codigo));
  check("mantém SELECT na view para anon", /GRANT SELECT ON TABLE public\.barbearias_publicas TO anon, authenticated/.test(codigo));
  check("não concede escrita pública", !/GRANT (INSERT|UPDATE|DELETE)[^;]*TO anon/i.test(codigo));
  check("não concede SELECT extra na tabela larga", !/GRANT SELECT[^;]*public\.barbershops[^;]*TO anon/i.test(codigo));

  group("migration: FASE 1 é aditiva");

  check(
    "NÃO revoga o SELECT de anon na tabela",
    !/REVOKE\s+SELECT[^;]*public\.barbershops/i.test(codigo),
    "revogar aqui derruba o frontend ainda publicado",
  );
  check("nenhum DROP no código executável", !/\bDROP\b/i.test(codigo));
  check(
    "não altera a policy de barbershops",
    !/(CREATE|ALTER|DROP)\s+POLICY/i.test(codigo),
    "a policy continua sendo a via de leitura de authenticated",
  );
  check("não recria get_public_barbers (a antiga)", !/FUNCTION public\.get_public_barbers\(/.test(codigo));
  check("documenta rollback conceitual", /ROLLBACK CONCEITUAL/.test(sql));

  const comandos = codigo
    .replace(/\$\$[\s\S]*?\$\$/g, "CORPO_DA_FUNCAO")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  check(
    "só executa comandos aditivos (CREATE/ALTER VIEW/GRANT/COMMENT + REVOKE da função)",
    comandos.every((s) => /^(CREATE|ALTER VIEW|GRANT|COMMENT|REVOKE ALL ON FUNCTION)/i.test(s)),
    comandos.filter((s) => !/^(CREATE|ALTER VIEW|GRANT|COMMENT|REVOKE ALL ON FUNCTION)/i.test(s)).join(" | "),
  );
  check(
    "a migration executa exatamente 8 comandos",
    comandos.length === 8,
    `${comandos.length}: ${comandos.map((c) => c.split(/\s+/).slice(0, 3).join(" ")).join(" | ")}`,
  );

  group("migration: FASE 2 documentada no rodapé da fase 1");

  check("documenta explicitamente a fase 2", /FASE 2/.test(sql));
  check("fase 2 documenta o REVOKE do anon", /REVOKE SELECT ON TABLE public\.barbershops FROM anon/.test(sql));
  check("fase 2 avisa para NÃO remover a policy", /NÃO deve ser removida/.test(sql));
  check("fase 2 lista as verificações pós-aplicação", /Verificações obrigatórias após aplicar a fase 2/.test(sql));
  check("fase 2 exige testar pending pela view", /pending/.test(sql) && /única barreira/.test(sql));
  check("fase 2 documenta o rollback", /GRANT SELECT ON TABLE public\.barbershops TO anon/.test(sql));

  group("migration: FASE 2a — a dependência de policy que o rodapé não previu");

  // Expressão de policy roda com os privilégios de quem consulta — o próprio
  // 20260721140000 registra isso, e foi por isso que `anon` recebeu EXECUTE em
  // `has_role`. A mesma regra vale para TABELA: enquanto as policies públicas
  // de services/availability/reviews trouxerem `SELECT … FROM barbershops` no
  // corpo, o REVOKE derruba a leitura das TRÊS com 42501.
  const FASE2A_ARQUIVO = "20260805120000_public_barbershop_surface_phase2a_policy_deps.sql";
  const fase2aCaminho = path.join(ROOT, "supabase", "migrations", FASE2A_ARQUIVO);
  const fase2aExiste = existsSync(fase2aCaminho);
  check("a preparação das policies está versionada", fase2aExiste, FASE2A_ARQUIVO);

  if (fase2aExiste) {
    const fase2aSql = readFileSync(fase2aCaminho, "utf8");
    const fase2aCodigo = semLinhasDeComentario(fase2aSql);

    check(
      "cria barbershop_is_public",
      /CREATE OR REPLACE FUNCTION public\.barbershop_is_public\(_barbershop_id uuid\)/.test(fase2aCodigo),
    );
    check("a função é SECURITY DEFINER", /SECURITY DEFINER/.test(fase2aCodigo));
    check("fixa search_path", /SET search_path TO 'public'/.test(fase2aCodigo));
    check("é STABLE (não escreve)", /\bSTABLE\b/.test(fase2aCodigo));
    check("exige barbearia aprovada", /b\.status\s*=\s*'approved'::approval_status/.test(fase2aCodigo));
    check(
      "exclui a sentinela — a RLS deixa de fazer isso dentro da função",
      /b\.subdomain\s*<>\s*'_system'::text/.test(fase2aCodigo),
      "sem este predicado a fase 2a AMPLIA o acesso em vez de preparar o fechamento",
    );
    check(
      "concede EXECUTE a anon (a policy é avaliada como o visitante)",
      /GRANT EXECUTE ON FUNCTION public\.barbershop_is_public\(uuid\) TO anon, authenticated/.test(fase2aCodigo),
    );
    check(
      "revoga EXECUTE de PUBLIC",
      /REVOKE ALL ON FUNCTION public\.barbershop_is_public\(uuid\) FROM PUBLIC/.test(fase2aCodigo),
    );

    for (const [tabela, policy] of [
      ["services", "Anyone can view services of approved barbershops"],
      ["availability", "Anyone can view availability of approved barbershops"],
      ["reviews", "Anyone can view reviews of approved barbershops"],
    ] as const) {
      check(
        `${tabela}: a policy pública passa a chamar barbershop_is_public`,
        new RegExp(
          `ALTER POLICY "${policy}"\\s*\\n\\s*ON public\\.${tabela}\\s*\\n\\s*USING \\([\\s\\S]{0,320}?barbershop_is_public\\(barbershop_id\\)`,
        ).test(fase2aCodigo),
      );
    }

    check(
      "usa ALTER POLICY, não DROP + CREATE",
      !/DROP POLICY/i.test(fase2aCodigo),
      "DROP + CREATE abre um intervalo sem via pública de leitura",
    );
    check(
      "nenhuma policy da fase 2a mantém subconsulta em barbershops",
      !/FROM public\.barbershops/i.test(fase2aCodigo.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/, "")),
    );
    check("é aditiva: não revoga acesso de tabela", !/REVOKE SELECT/i.test(fase2aCodigo));
    check("documenta o rollback das três policies", /ROLLBACK/.test(fase2aSql));
    check(
      "avisa que a ordem é 2a antes do REVOKE",
      /20260805120000 PRIMEIRO/.test(readFileSync(FASE2_CAMINHO, "utf8")),
    );
  }

  group("migration: FASE 2 versionada");

  // Este guard já foi o oposto: enquanto a fase 2 era só um plano em comentário,
  // ele exigia que NENHUMA migration a versionasse, porque um `db push` teria
  // aplicado as duas de uma vez e derrubado o frontend ainda publicado. A fase 1
  // está em produção e o frontend novo também, então o risco inverteu — o que
  // quebra agora é o arquivo divergir do que a fase 1 prometeu, ou ir sozinho.
  const fase2Existe = existsSync(FASE2_CAMINHO);
  check("a migration da fase 2 está versionada", fase2Existe, FASE2_ARQUIVO);

  if (fase2Existe) {
    const fase2Sql = readFileSync(FASE2_CAMINHO, "utf8");
    const fase2Codigo = semLinhasDeComentario(fase2Sql);
    const fase2Comandos = fase2Codigo.split(";").map((s) => s.trim()).filter(Boolean);

    check(
      "revoga o SELECT de anon na tabela",
      /REVOKE SELECT ON TABLE public\.barbershops FROM anon/.test(fase2Codigo),
    );
    check(
      "executa exatamente 1 comando",
      fase2Comandos.length === 1,
      `${fase2Comandos.length}: ${fase2Comandos.map((c) => c.split(/\s+/).slice(0, 3).join(" ")).join(" | ")}`,
    );
    check(
      "só executa REVOKE SELECT",
      fase2Comandos.every((s) => /^REVOKE SELECT/i.test(s)),
      fase2Comandos.filter((s) => !/^REVOKE SELECT/i.test(s)).join(" | "),
    );
    // O ponto da fase 2 é FECHAR acesso. Qualquer GRANT aqui desfaria o efeito.
    check("não reabre acesso ao anônimo", !/GRANT[^;]*TO anon/i.test(fase2Codigo));
    check(
      "NÃO remove a policy — ela é a via de leitura de authenticated",
      !/DROP POLICY/i.test(fase2Codigo),
    );
    check("incide somente sobre public.barbershops", fase2Comandos.every((s) => /public\.barbershops/i.test(s)));
    check("preserva o rollback documentado", /GRANT SELECT ON TABLE public\.barbershops TO anon/.test(fase2Sql));
    check(
      "registra por que a espera foi dispensada",
      /não tem tráfego real/.test(fase2Sql),
      "a decisão de pular a soaking precisa ficar no arquivo, não só no PR",
    );
    check(
      "documenta a consequência aceita no Realtime",
      /postgres_changes/.test(fase2Sql),
    );

    /* ─── paridade: o versionado é o que a fase 1 prometeu ─── */

    // Em vez de repetir aqui o SQL esperado (que só provaria que este arquivo
    // concorda consigo mesmo), extrai o comando do bloco "Conteúdo conceitual"
    // da fase 1 e exige que o arquivo versionado o contenha.
    const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();
    const blocoConceitual = /Conteúdo conceitual:([\s\S]*?)NOTA:/.exec(sql)?.[1] ?? "";
    const prometidos = blocoConceitual
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .split(";")
      .map(normalizar)
      .filter(Boolean);

    check("a fase 1 documenta 1 comando para a fase 2", prometidos.length === 1, `${prometidos.length}: ${prometidos.join(" | ")}`);
    const versionado = normalizar(fase2Codigo);
    check(
      "o comando prometido pela fase 1 está no arquivo versionado",
      prometidos.length > 0 && prometidos.every((p) => versionado.includes(p)),
      prometidos.filter((p) => !versionado.includes(p)).join(" | "),
    );
  }

  // Duplicar o REVOKE em outro arquivo faria o histórico divergir do banco sem
  // ninguém perceber.
  const dir = path.join(ROOT, "supabase", "migrations");
  const duplicatas = readdirSync(dir).filter((arquivo) => {
    if (!arquivo.endsWith(".sql") || arquivo === FASE2_ARQUIVO) return false;
    return /REVOKE[^;]*SELECT[^;]*public\.barbershops[^;]*anon/i.test(
      semLinhasDeComentario(readFileSync(path.join(dir, arquivo), "utf8")),
    );
  });
  check("o REVOKE não está duplicado em outra migration", duplicatas.length === 0, duplicatas.join(", "));

  // Depois da fase 2a, uma policy nova que volte a consultar `barbershops` no
  // corpo reintroduz o defeito — e desta vez com o REVOKE já aplicado, ou seja,
  // quebrando a leitura pública na hora. O guard vale para o futuro, não só
  // para o que existe hoje.
  const posFase2a = readdirSync(dir).filter((arquivo) => {
    if (!arquivo.endsWith(".sql") || arquivo <= FASE2A_ARQUIVO) return false;
    const conteudo = semLinhasDeComentario(readFileSync(path.join(dir, arquivo), "utf8"));
    return (
      /(CREATE|ALTER) POLICY/i.test(conteudo) && /FROM\s+(public\.)?barbershops\b/i.test(conteudo)
    );
  });
  check(
    "nenhuma migration posterior reintroduz subconsulta em barbershops dentro de policy",
    posFase2a.length === 0,
    `${posFase2a.join(", ")} — use barbershop_is_public()`,
  );

  group("migration: não altera o histórico");

  const original = lerArquivo(
    "supabase/migrations/20260722130000_hide_system_and_default_free_plan.sql",
  );
  check(
    "a migration que criou a view segue intacta",
    original.includes("CREATE OR REPLACE VIEW public.barbearias_publicas"),
  );
  check(
    "a definição antiga continua com security_invoker = true",
    /ALTER VIEW public\.barbearias_publicas SET \(security_invoker = true\)/.test(original),
    "o histórico registra o estado anterior; quem muda é a fase 1",
  );
}

/* ══════════════ 8. varredura global: quem lê a tabela larga ══════════════ */

/**
 * Arquivos de aplicação (fora de `src/mocks`) que consultam `barbershops`.
 *
 * A primeira varredura desta frente olhou os componentes de rota óbvios e
 * concluiu que eram cinco os pontos anônimos. Faltavam DOIS, os dois em hook —
 * o fallback por `DEFAULT_BARBERSHOP_ID` de `use-barbershop` (que roda em toda
 * visita ao domínio principal, depois do bloco `if (user)`) e o SELECT de
 * `use-plan`, alcançável por `/upgrade`, que não declara guarda. Ambos foram
 * corrigidos; esta lista existe para que o próximo não dependa de alguém
 * lembrar de olhar.
 *
 * A lista NÃO afirma que cada arquivo é seguro — ela congela o conjunto
 * conhecido. Arquivo novo aqui derruba o harness e obriga a decidir, na hora,
 * se aquele caminho é autenticado.
 */
const LEITORES_CONHECIDOS: Record<string, string> = {
  // Papel, propriedade e o fallback COM sessão. O caminho por subdomínio e o
  // fallback SEM sessão leem a vitrine — ver as asserções logo abaixo.
  "src/hooks/use-barbershop.tsx": "papel/propriedade/fallback autenticado",
  // Super_admin operando outra barbearia. Guardado por sessão desde esta fase.
  "src/hooks/use-plan.tsx": "tenant explícito do super_admin, com sessão",
  // /meus-agendamentos — cliente logado. `authenticated` segue pela policy.
  "src/components/AppointmentHistory.tsx": "histórico do cliente logado",
  "src/components/AdminDashboard.tsx": "moderação do super_admin (todos os status)",
  "src/components/BarberReports.tsx": "relatórios, tela de staff",
  "src/components/BarbershopSettings.tsx": "configurações, tela de admin",
  "src/components/CloseTicketDialog.tsx": "comandas, tela de staff",
  "src/components/ManualAppointmentDialog.tsx": "agenda, tela de staff",
  "src/components/OnboardingWizard.tsx": "onboarding, exige sessão",
  "src/routes/agenda.tsx": "rota com guarda de staff",
  "src/routes/comandas.tsx": "rota com guarda de staff",
  "src/routes/configuracoes.tsx": "rota com guarda de admin",
  "src/routes/dashboard.tsx": "rota com guarda",
  "src/routes/onboarding.tsx": "rota com guarda",
  "src/routes/servicos.tsx": "rota com guarda de staff",
  // Embed `barbershop:barbershops(name)` a partir de appointments; só é chamado
  // por AppointmentHistory, no cancelamento feito pelo cliente logado.
  "src/lib/notifications.ts": "dados de notificação, a partir de tela autenticada",
  // Rota de servidor: roda com service_role, que o REVOKE do anon não alcança.
  "src/routes/hooks/reset-monthly-appointments.ts": "cron, service_role",
};

/** Todos os `.ts`/`.tsx` de `src`, menos o próprio mock e os harnesses. */
function fontesDaAplicacao(dir: string, acc: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === "mocks" || entrada.name === "node_modules") continue;
      fontesDaAplicacao(completo, acc);
    } else if (/\.tsx?$/.test(entrada.name)) {
      acc.push(path.relative(ROOT, completo).split(path.sep).join("/"));
    }
  }
  return acc;
}

function testeVarreduraGlobal() {
  group("varredura global: nenhum leitor novo da tabela larga");

  const fontes = fontesDaAplicacao(path.join(ROOT, "src"));
  check("a varredura enxerga a árvore inteira de src", fontes.length > 100, `${fontes.length}`);

  // `from("barbershops")` e o embed `barbershops(...)` — as duas formas de
  // exigir SELECT na tabela. `select("*")` sozinho não basta como pista: o que
  // importa é a TABELA consultada, não o formato da projeção.
  const leitores = fontes.filter((rel) => {
    const codigo = semComentarios(readFileSync(path.join(ROOT, rel), "utf8"));
    return (
      /from\(\s*["'`]barbershops["'`]\s*\)/.test(codigo) ||
      /:\s*barbershops\s*\(/.test(codigo)
    );
  });

  const novos = leitores.filter((rel) => !(rel in LEITORES_CONHECIDOS));
  check(
    "nenhum arquivo fora da lista conhecida consulta barbershops",
    novos.length === 0,
    `novo(s): ${novos.join(", ")} — se o caminho for anônimo, migre para barbearias_publicas antes da fase 2`,
  );

  const sumiram = Object.keys(LEITORES_CONHECIDOS).filter((rel) => !leitores.includes(rel));
  check(
    "a lista não guarda entrada morta",
    sumiram.length === 0,
    `já não lê a tabela: ${sumiram.join(", ")}`,
  );

  group("varredura global: os dois pontos anônimos que faltavam");

  const hook = semComentarios(lerArquivo("src/hooks/use-barbershop.tsx"));
  check(
    "use-barbershop resolve o subdomínio pela vitrine",
    /from\(\s*["']barbearias_publicas["']\s*\)[\s\S]{0,200}eq\(\s*["']subdomain["']/.test(hook),
  );
  check(
    "use-barbershop lê a vitrine no fallback sem sessão",
    /:\s*await[\s\S]{0,80}from\(\s*["']barbearias_publicas["']\s*\)[\s\S]{0,260}DEFAULT_BARBERSHOP_ID/.test(hook),
    "sem isto, toda visita anônima ao domínio principal ainda toca a tabela larga",
  );
  check(
    "o fallback pela tabela é o ramo COM sessão",
    /const fallback = user\s*\n?\s*\?\s*await/.test(hook),
  );

  const plano = semComentarios(lerArquivo("src/hooks/use-plan.tsx"));
  check(
    "use-plan exige sessão antes de consultar barbershops",
    /getSession\(\)[\s\S]{0,200}if \(!session\)[\s\S]{0,220}from\(\s*["']barbershops["']\s*\)/.test(plano),
    "/upgrade não tem guarda: sem a checagem, o visitante anônimo cai neste SELECT",
  );
  check(
    "sem sessão o plano vira no-tenant, não erro",
    /if \(!session\) \{[\s\S]{0,160}status: "no-tenant"/.test(plano),
  );
}

/* ══════════════ 9. fase 2 simulada: o REVOKE, sem banco ══════════════ */

/**
 * O teste negativo desta frente, no mesmo espírito do que o PR #41 fez para a
 * autorização do cron: não basta mostrar que o caminho novo funciona — é
 * preciso mostrar que ele funciona QUANDO O ANTIGO É NEGADO, e que o antigo é
 * mesmo negado.
 *
 * Sem isto, "a vitrine responde" e "a vitrine responde porque o anon ainda tem
 * SELECT na tabela por baixo" são indistinguíveis. E é justamente essa a
 * diferença que o `security_invoker = false` da fase 1 existe para produzir.
 *
 * Vale o limite honesto: aqui se simula o GRANT, não se aplica. Isto não
 * substitui as verificações contra o banco listadas no rodapé da migration —
 * é o que dá para provar sem banco, e o que impede a fase 2 de regredir.
 */
async function testeFase2Simulada() {
  resetMockDatabase();
  await mockSupabaseClient.auth.signOut();

  // O REVOKE deixou de ser hipótese: foi aplicado no remoto em 05/08/2026, e
  // `src/mocks/grants.ts` passou a carregar o mapa real de privilégios. Por
  // isso o que se simula aqui agora é o ESTADO ANTERIOR — pelo `GRANT` do
  // rollback documentado no rodapé da migration. A ordem inverteu; o que cada
  // asserção prova, não.
  group("fase 2: o estado ANTERIOR, reconstruído pelo GRANT do rollback");

  grantAnonSelect("barbershops");
  const antes = await (mockSupabaseClient as any).from("barbershops").select("*");
  check("com o GRANT de volta, o anônimo leria a tabela larga", (antes.data ?? []).length > 0);
  check(
    "e receberia as colunas internas",
    Boolean(antes.data?.[0] && "owner_id" in antes.data[0] && "plan_id" in antes.data[0]),
    "é exatamente esta exposição que a fase 2 fechou",
  );
  check(
    "ou seja: o rollback documentado devolve mesmo o acesso",
    (antes.data ?? []).length > 0,
    "GRANT SELECT ON TABLE public.barbershops TO anon",
  );

  resetAnonGrants();

  group("fase 2 aplicada: o acesso direto é NEGADO");

  const negado = await (mockSupabaseClient as any).from("barbershops").select("*");
  check("SELECT direto devolve erro", Boolean(negado.error), JSON.stringify(negado.error));
  check("o erro é 42501 (privilégio ausente)", negado.error?.code === "42501", String(negado.error?.code));
  check(
    "não devolve linha nenhuma",
    (negado.data ?? []).length === 0,
    "privilégio ausente é erro, não lista vazia",
  );

  // O fallback ANTIGO de use-barbershop, reproduzido: é a consulta que a fase 2
  // teria quebrado em silêncio em toda visita anônima ao domínio principal.
  const fallbackAntigo = await (mockSupabaseClient as any)
    .from("barbershops")
    .select("*")
    .eq("id", DEFAULT_BARBERSHOP_ID)
    .maybeSingle();
  check(
    "o fallback por DEFAULT_BARBERSHOP_ID na tabela seria negado",
    fallbackAntigo.error?.code === "42501",
    "motivo de o fallback sem sessão ter passado a ler a vitrine",
  );

  group("fase 2 aplicada: o que DEVE continuar funcionando");

  const rows = await vitrine();
  check("a vitrine continua respondendo sem sessão", rows.length > 0);
  check(
    "a vitrine continua com as 24 colunas",
    Object.keys(rows[0] ?? {}).length === 24,
    `${Object.keys(rows[0] ?? {}).length}`,
  );
  for (const coluna of COLUNAS_INTERNAS) {
    check(`${coluna} continua fora da vitrine`, rows.every((r) => !(coluna in r)));
  }

  // O fallback NOVO: mesma pergunta, pelo objeto que sobrevive ao REVOKE.
  const fallbackNovo = await (mockSupabaseClient as any)
    .from("barbearias_publicas")
    .select("*")
    .eq("id", DEFAULT_BARBERSHOP_ID)
    .maybeSingle();
  check(
    "o fallback sem sessão resolve pela vitrine",
    !fallbackNovo.error && Boolean(fallbackNovo.data),
    JSON.stringify(fallbackNovo.error),
  );

  // Resolução por subdomínio — o caminho do visitante que chega pelo tenant.
  const porSubdominio = await (mockSupabaseClient as any)
    .from("barbearias_publicas")
    .select("*")
    .eq("subdomain", getTableRows("barbershops")[0]?.subdomain)
    .eq("status", "approved")
    .maybeSingle();
  check(
    "resolução por subdomínio continua funcionando",
    !porSubdominio.error && Boolean(porSubdominio.data),
    JSON.stringify(porSubdominio.error),
  );

  const lista = await barbeiros(MOCK_BARBERSHOP_ID);
  check("get_public_barbers_v2 continua respondendo (SECURITY DEFINER)", lista.length > 0);
  check("e continua sem expor owner_id", lista.every((r) => !("owner_id" in r)));

  group("fase 2 aplicada: a fronteira da view segue de pé sem a RLS");

  // Com `security_invoker = false` o WHERE da view é a barreira inteira. Se ele
  // falhasse, o REVOKE teria trocado uma exposição por outra.
  const base = getTableRows("barbershops");
  const rejeitada = { ...base[0], id: "f0f0f0f0-0000-4000-8000-000000000011", subdomain: "rejeitada-fase2", status: "rejected" };
  const pendente = { ...base[0], id: "f0f0f0f0-0000-4000-8000-000000000012", subdomain: "pendente-fase2", status: "pending" };
  const sentinela = { ...base[0], id: "f0f0f0f0-0000-4000-8000-000000000013", subdomain: "_system", status: "approved" };
  setTableRows("barbershops", [...base, rejeitada, pendente, sentinela]);

  const comIntrusos = await vitrine();
  const subdominios = comIntrusos.map((r) => String(r.subdomain));
  check("rejeitada continua fora com o REVOKE ligado", !subdominios.includes("rejeitada-fase2"), subdominios.join(", "));
  check("pendente continua fora com o REVOKE ligado", !subdominios.includes("pendente-fase2"), subdominios.join(", "));
  check("_system continua fora com o REVOKE ligado", !subdominios.includes("_system"), subdominios.join(", "));
  check(
    "e nenhuma das intrusas responde pela RPC",
    (await barbeiros(pendente.id)).length === 0 && (await barbeiros(sentinela.id)).length === 0,
  );

  setTableRows("barbershops", base);

  group("fase 2 aplicada: o REVOKE atinge só o anônimo");

  const login = await mockSupabaseClient.auth.signInWithPassword({
    email: MOCK_ADMIN_EMAIL,
    password: "qualquer-senha",
  });
  check("sessão de admin estabelecida", Boolean(login.data?.session), login.error?.message ?? "");

  const comSessao = await (mockSupabaseClient as any).from("barbershops").select("*");
  check(
    "com sessão a tabela continua legível",
    !comSessao.error && (comSessao.data ?? []).length > 0,
    JSON.stringify(comSessao.error),
  );
  check(
    "e continua entregando as colunas internas às telas de staff",
    Boolean(comSessao.data?.[0] && "owner_id" in comSessao.data[0]),
  );

  await mockSupabaseClient.auth.signOut();

  // O rollback (`GRANT SELECT ON TABLE public.barbershops TO anon`) já foi
  // exercitado no primeiro grupo desta seção, que reconstrói o estado anterior
  // justamente por ele. Repetir aqui só duplicaria a asserção.

  resetAnonGrants();
  resetMockDatabase();
}

/* ══════════════ 10. paridade mock ↔ SQL ══════════════ */

function testeParidade() {
  group("paridade entre mock e migration");

  const builder = lerArquivo("src/mocks/query-builder.ts");
  check("mock projeta o recorte público da view", builder.includes("projectPublicBarbershop"));
  check("mock cita a migration correspondente", builder.includes("20260804120000"));
  check(
    "mock filtra approved e _system",
    /status === "approved" && row\.subdomain !== "_system"/.test(builder),
  );
  check("mock deriva branding_enabled de plans", /plano\?\.name === "pro"/.test(builder));

  const client = lerArquivo("src/mocks/client.ts");
  check("mock implementa get_public_barbers_v2", client.includes("get_public_barbers_v2"));
  check("mock da v2 cita a migration", client.includes("20260804120000"));
  check("mock da v2 exige barbearia aprovada", /status !== "approved"/.test(client));
  check("mock da v2 mantém a RPC antiga", /get_public_barbers: \(args\)/.test(client));

  // A lista de colunas aparece em quatro lugares (SQL, mock, use-barbershop e
  // este harness). Divergir é o modo de falha mais provável desta frente.
  const sql = readFileSync(MIGRATION, "utf8");
  const hook = lerArquivo("src/hooks/use-barbershop.tsx");
  for (const coluna of COLUNAS_PUBLICAS) {
    check(`coluna ${coluna} está no SQL e no mock`, sql.includes(coluna) && builder.includes(coluna));
  }
  check(
    "use-barbershop lista as mesmas colunas públicas",
    COLUNAS_PUBLICAS.every((c) => hook.includes(c)),
  );
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  resetMockDatabase();

  await testeColunas();
  await testeFronteira();
  await testeBranding();
  await testeBarbeiros();
  testeFrontendPublico();
  testeFrontendInterno();
  testeVarreduraGlobal();
  await testeFase2Simulada();
  testeMigration();
  testeParidade();

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
