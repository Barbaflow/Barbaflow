/**
 * Harness da superfície pública de `barbershops`.
 *
 * A tabela tem 36 colunas e a vitrine pública precisa de 24. Até a migration
 * 20260804120000 existia uma view estreita e correta (`barbearias_publicas`) ao
 * lado de uma tabela larga aberta ao `anon` — ou seja, a view era convenção, e
 * bastava trocar o endpoint para receber `owner_id`, `plan_id`,
 * `appointments_this_month` e os campos de recibo.
 *
 * Prova a separação em quatro frentes:
 *
 *   1. comportamento — a view do mock devolve as 24 colunas e NENHUMA das
 *      internas; `branding_enabled` reflete o plano;
 *   2. comportamento — `get_public_barbers_v2` devolve `is_owner` sem expor o
 *      `owner_id`, e recusa barbearia não aprovada, sentinela e id nulo;
 *   3. código — nenhuma tela do caminho anônimo consulta a tabela larga, e as
 *      telas internas continuam consultando;
 *   4. SQL — análise estática da migration.
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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows, setTableRows } from "@/mocks/store";
import {
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

  const dono = lista.filter((r) => r.is_owner === true);
  check("exatamente um proprietário", dono.length === 1, `${dono.length}`);
  check(
    "o proprietário é o owner_id da barbearia",
    dono[0]?.user_id === MOCK_USER_IDS.admin,
    String(dono[0]?.user_id),
  );
  check("o proprietário vem primeiro", lista[0]?.is_owner === true);

  group("get_public_barbers_v2: sem duplicatas");

  // O admin da barbearia A tem DOIS papéis (admin_barbearia + barbeiro): o SQL
  // usa DISTINCT, e o mock precisa deduplicar igual.
  const ids = lista.map((r) => String(r.user_id));
  check("não repete quem tem dois papéis", new Set(ids).size === ids.length, ids.join(", "));
  check("inclui o admin que também atende", ids.includes(MOCK_USER_IDS.admin));
  check("inclui os barbeiros comuns", ids.includes(MOCK_USER_IDS.barberAna));

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
  // O bloco da FASE 2 cita, de propósito, comandos que esta migration NÃO
  // executa. As asserções sobre o que o SQL FAZ olham só o código executável.
  const codigo = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

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

  group("migration: FASE 2 documentada e NÃO versionada");

  check("documenta explicitamente a fase 2", /FASE 2/.test(sql));
  check("fase 2 documenta o REVOKE do anon", /REVOKE SELECT ON TABLE public\.barbershops FROM anon/.test(sql));
  check("fase 2 avisa para NÃO remover a policy", /NÃO deve ser removida/.test(sql));
  check("fase 2 lista as verificações pós-aplicação", /Verificações obrigatórias após aplicar a fase 2/.test(sql));
  check("fase 2 exige testar pending pela view", /pending/.test(sql) && /única barreira/.test(sql));
  check("fase 2 documenta o rollback", /GRANT SELECT ON TABLE public\.barbershops TO anon/.test(sql));

  // Enquanto a fase 1 não estiver publicada e observada, NENHUMA migration pode
  // conter o REVOKE — um único `db push` aplicaria as duas juntas e derrubaria
  // o frontend ainda em produção. Este guard é o mesmo do catálogo público, e
  // deve ser INVERTIDO quando a fase 2 for legitimamente versionada.
  const dir = path.join(ROOT, "supabase", "migrations");
  const comFase2 = readdirSync(dir).filter((arquivo) => {
    if (!arquivo.endsWith(".sql")) return false;
    const conteudo = readFileSync(path.join(dir, arquivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    return /REVOKE[^;]*SELECT[^;]*public\.barbershops[^;]*anon/i.test(conteudo);
  });
  check(
    "nenhuma migration versiona o REVOKE da fase 2 ainda",
    comFase2.length === 0,
    comFase2.join(", "),
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

/* ══════════════ 8. paridade mock ↔ SQL ══════════════ */

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
  testeMigration();
  testeParidade();

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
