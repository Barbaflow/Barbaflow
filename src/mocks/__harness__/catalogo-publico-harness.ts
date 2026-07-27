/**
 * Harness do catálogo público de produtos.
 *
 * Prova a separação entre o que o público vê e o que é estoque interno, em três
 * frentes complementares:
 *
 *   1. comportamento — a RPC do mock, que espelha `get_public_products`;
 *   2. código — nenhuma tela pública consulta `products` direto;
 *   3. SQL — a migration revoga o acesso do anônimo e define a função com as
 *      proteções esperadas (SECURITY DEFINER com search_path, colunas
 *      explícitas, grants restritos).
 *
 * A frente 3 é análise estática do arquivo `.sql`. Não substitui aplicar a
 * migration num banco: é o que dá para garantir sem banco, e é o que impede a
 * migration de regredir silenciosamente.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows } from "@/mocks/store";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_B_ID,
  MOCK_BARBERSHOP_E_ID,
  MOCK_PRODUCT_IDS,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

/**
 * O modo mock aplica as mesmas permissões do banco: comandas e relatórios
 * exigem sessão de staff. O catálogo público, não — e essa diferença é
 * justamente parte do que este harness verifica.
 */
async function login(email: string) {
  const res = await mockSupabaseClient.auth.signInWithPassword({
    email,
    password: "qualquer-senha",
  });
  if (res.error || !res.data.session) {
    throw new Error(`Falha no login fictício: ${email} — ${res.error?.message ?? "sem sessão"}`);
  }
}

async function logout() {
  await mockSupabaseClient.auth.signOut();
}

const ROOT = process.cwd();
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260727120000_public_product_catalog.sql",
);

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

type PublicRow = Record<string, unknown>;

async function catalogo(barbershopId: unknown): Promise<PublicRow[]> {
  const { data, error } = await mockSupabaseClient.rpc("get_public_products", {
    _barbershop_id: barbershopId,
  });
  if (error) throw new Error(`RPC falhou: ${JSON.stringify(error)}`);
  return (data ?? []) as PublicRow[];
}

/* ══════════════ 1. o que o catálogo devolve ══════════════ */

async function testeConteudo() {
  group("catálogo público: acessível sem sessão");

  // Sem login: é exatamente o caso do visitante da página /agendar/$slug.
  await logout();
  const { data: anon } = await mockSupabaseClient.auth.getSession();
  check("nenhuma sessão ativa", !anon?.session);

  const rows = await catalogo(MOCK_BARBERSHOP_ID);
  check("anônimo consegue ler o catálogo público", rows.length > 0);

  group("catálogo público: conteúdo");
  const nomes = rows.map((r) => String(r.name));
  const ids = rows.map((r) => String(r.id));

  check("devolve produtos da barbearia pedida", rows.length > 0);
  check(
    "todos pertencem à barbearia pedida",
    rows.every((r) => r.barbershop_id === MOCK_BARBERSHOP_ID),
  );

  check(
    "produto INATIVO não aparece",
    !ids.includes(MOCK_PRODUCT_IDS.cremeAInativo),
    nomes.join(", "),
  );
  check("produto ativo com estoque aparece", ids.includes(MOCK_PRODUCT_IDS.pomadaA));
  check("produto ativo SEM estoque aparece (esgotado, não oculto)", ids.includes(MOCK_PRODUCT_IDS.shampooA));

  group("catálogo público: in_stock");

  const pomada = rows.find((r) => r.id === MOCK_PRODUCT_IDS.pomadaA);
  const shampoo = rows.find((r) => r.id === MOCK_PRODUCT_IDS.shampooA);

  check("in_stock = true com estoque positivo", pomada?.in_stock === true);
  check("in_stock = false com estoque zero", shampoo?.in_stock === false);
  check("in_stock é booleano, não número", rows.every((r) => typeof r.in_stock === "boolean"));

  group("catálogo público: colunas");

  const chaves = new Set(rows.flatMap((r) => Object.keys(r)));
  check("NÃO devolve stock_quantity", !chaves.has("stock_quantity"), [...chaves].join(", "));
  check("NÃO devolve active", !chaves.has("active"));
  check("NÃO devolve created_at/updated_at", !chaves.has("created_at") && !chaves.has("updated_at"));
  check(
    "devolve exatamente o conjunto público esperado",
    [...chaves].sort().join(",") === "barbershop_id,description,id,image_url,in_stock,name,price",
    [...chaves].sort().join(","),
  );

  group("catálogo público: ordenação");
  const ordenado = [...nomes].sort((a, b) => a.localeCompare(b));
  check("ordem estável por nome", nomes.join("|") === ordenado.join("|"), nomes.join(", "));
}

/* ══════════════ 2. isolamento entre tenants e aprovação ══════════════ */

async function testeIsolamento() {
  group("isolamento entre barbearias");

  const a = await catalogo(MOCK_BARBERSHOP_ID);
  const b = await catalogo(MOCK_BARBERSHOP_B_ID);

  check(
    "produto do tenant B não aparece no catálogo de A",
    !a.some((r) => r.id === MOCK_PRODUCT_IDS.pomadaB),
  );
  check(
    "produto do tenant A não aparece no catálogo de B",
    !b.some((r) => r.id === MOCK_PRODUCT_IDS.pomadaA),
  );
  check("catálogo de B traz o produto de B", b.some((r) => r.id === MOCK_PRODUCT_IDS.pomadaB));
  check(
    "inativo de B também é filtrado",
    !b.some((r) => r.id === MOCK_PRODUCT_IDS.oleoBInativo),
  );

  group("barbearia não aprovada");

  // A barbearia E está `pending` e tem um produto ATIVO com estoque.
  const pendente = getTableRows("products").find((p) => p.id === MOCK_PRODUCT_IDS.ceraEPendente);
  check("fixture: produto da barbearia pendente é ativo e com estoque", pendente?.active === true && Number(pendente?.stock_quantity) > 0);

  const e = await catalogo(MOCK_BARBERSHOP_E_ID);
  check("barbearia PENDENTE devolve catálogo vazio", e.length === 0, `${e.length} linhas`);
  check(
    "produto de barbearia pendente não vaza em outro catálogo",
    !a.some((r) => r.id === MOCK_PRODUCT_IDS.ceraEPendente),
  );
}

/* ══════════════ 3. parâmetros inválidos ══════════════ */

async function testeParametros() {
  group("parâmetros inválidos não ampliam acesso");

  for (const [rotulo, valor] of [
    ["id inexistente", "00000000-0000-4000-8000-999999999999"],
    ["string vazia", ""],
    ["null", null],
    ["undefined", undefined],
  ] as const) {
    const rows = await catalogo(valor);
    check(`${rotulo}: devolve lista vazia`, rows.length === 0, `${rows.length} linhas`);
  }

  // O ponto central: nenhuma entrada devolve "tudo".
  const total = getTableRows("products").length;
  const vazio = await catalogo(null);
  check("nenhum parâmetro devolve a tabela inteira", vazio.length < total);
}

/* ══════════════ 4. o frontend público não toca a tabela ══════════════ */

function testeFrontendPublico() {
  group("frontend público não consulta products");

  const showcase = lerArquivo("src/components/ProductsShowcase.tsx");
  check('ProductsShowcase não chama from("products")', !/from\(\s*["']products["']\s*\)/.test(showcase));
  check("ProductsShowcase não menciona stock_quantity", !showcase.includes("stock_quantity"));
  check("ProductsShowcase usa fetchPublicProducts", showcase.includes("fetchPublicProducts"));
  check("ProductsShowcase usa in_stock", showcase.includes("in_stock"));
  check("ProductsShowcase mantém estado de erro", showcase.includes("loadError"));
  check("ProductsShowcase mantém estado de carregamento", showcase.includes("loading"));

  const rota = lerArquivo("src/routes/agendar.$slug.tsx");
  check('rota /agendar/$slug não chama from("products")', !/from\(\s*["']products["']\s*\)/.test(rota));

  const lib = lerArquivo("src/lib/public-catalog.ts");
  // Só o corpo da interface — os comentários do módulo citam stock_quantity de
  // propósito, para explicar por que ele NÃO está aqui.
  const corpoInterface = lib.match(/export interface PublicProduct \{([\s\S]*?)\n\}/)?.[1] ?? "";
  check("interface PublicProduct existe", corpoInterface.length > 0);
  check("PublicProduct não declara stock_quantity", !corpoInterface.includes("stock_quantity"), corpoInterface);
  check("PublicProduct declara in_stock", /in_stock:\s*boolean/.test(corpoInterface));
  check("public-catalog chama a RPC pública", lib.includes("get_public_products"));
}

/* ══════════════ 5. telas internas preservadas ══════════════ */

function testeFrontendInterno() {
  group("telas internas continuam com o estoque exato");

  const internas: Array<[string, string]> = [
    ["BarberDashboard (produtos)", "src/components/BarberDashboard.tsx"],
    ["CloseTicketDialog", "src/components/CloseTicketDialog.tsx"],
    ["ComandaDetailDialog", "src/components/ComandaDetailDialog.tsx"],
    ["OperationalDashboard", "src/components/OperationalDashboard.tsx"],
  ];

  for (const [nome, arquivo] of internas) {
    const src = lerArquivo(arquivo);
    check(`${nome} ainda lê stock_quantity`, src.includes("stock_quantity"));
    check(`${nome} escopa por barbershop_id`, src.includes("barbershop_id"));
    check(
      `${nome} NÃO usa o catálogo público`,
      !src.includes("get_public_products") && !src.includes("fetchPublicProducts"),
    );
  }
}

/* ══════════════ 6. comandas: estoque continua funcionando ══════════════ */

async function testeComandas() {
  group("fechamento de comanda continua baixando estoque");

  // Comandas exigem sessão de staff — o catálogo público, não.
  await login(MOCK_ADMIN_EMAIL);

  const antes = Number(
    getTableRows("products").find((p) => p.id === MOCK_PRODUCT_IDS.pomadaA)?.stock_quantity ?? 0,
  );

  // open_ticket devolve o id da comanda (string), não um objeto.
  const { data: ticket, error: erroAbrir } = await mockSupabaseClient.rpc("open_ticket", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _barber_id: MOCK_USER_IDS.barberAna,
  });
  check("open_ticket funciona", !erroAbrir && Boolean(ticket), JSON.stringify(erroAbrir));

  const ticketId = String(ticket ?? "");
  const { error: erroItem } = await mockSupabaseClient
    .from("ticket_items")
    .insert({
      ticket_id: ticketId,
      item_type: "product",
      product_id: MOCK_PRODUCT_IDS.pomadaA,
      quantity: 2,
    });
  check("lança produto na comanda", !erroItem, JSON.stringify(erroItem));

  const { error: erroFechar } = await mockSupabaseClient.rpc("close_ticket", {
    _ticket_id: ticketId,
  });
  check("close_ticket funciona", !erroFechar, JSON.stringify(erroFechar));

  const depois = Number(
    getTableRows("products").find((p) => p.id === MOCK_PRODUCT_IDS.pomadaA)?.stock_quantity ?? 0,
  );
  check("estoque baixou exatamente a quantidade vendida", depois === antes - 2, `${antes} → ${depois}`);

  // O catálogo público reflete a baixa sem revelar o número.
  const rows = await catalogo(MOCK_BARBERSHOP_ID);
  const pomada = rows.find((r) => r.id === MOCK_PRODUCT_IDS.pomadaA);
  check("catálogo público segue sem expor a quantidade", pomada !== undefined && !("stock_quantity" in pomada));

  group("estoque insuficiente continua bloqueando");

  const { data: t2 } = await mockSupabaseClient.rpc("open_ticket", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _barber_id: MOCK_USER_IDS.barberBruno,
  });
  const t2Id = String(t2 ?? "");
  await mockSupabaseClient.from("ticket_items").insert({
    ticket_id: t2Id,
    item_type: "product",
    product_id: MOCK_PRODUCT_IDS.shampooA, // estoque 0
    quantity: 1,
  });
  const { error: erroSemEstoque } = await mockSupabaseClient.rpc("close_ticket", { _ticket_id: t2Id });
  check(
    "fechar com estoque zero devolve estoque_insuficiente",
    Boolean(erroSemEstoque) && JSON.stringify(erroSemEstoque).includes("estoque_insuficiente"),
    JSON.stringify(erroSemEstoque),
  );
}

/* ══════════════ 7. relatórios preservados ══════════════ */

async function testeRelatorios() {
  group("relatório de produtos continua funcionando");

  await login(MOCK_ADMIN_EMAIL);

  const { data, error } = await mockSupabaseClient.rpc("report_products", {
    _barbershop_id: MOCK_BARBERSHOP_ID,
    _start: new Date(Date.now() - 90 * 864e5).toISOString(),
    _end: new Date(Date.now() + 864e5).toISOString(),
    _barber_id: null,
  });

  check("report_products responde sem erro", !error, JSON.stringify(error));
  const rows = (data ?? []) as PublicRow[];
  check("report_products devolve linhas", Array.isArray(rows));
  check(
    "relatório interno CONTINUA trazendo stock_quantity",
    rows.length === 0 || "stock_quantity" in rows[0],
    rows.length > 0 ? Object.keys(rows[0]).join(", ") : "sem linhas no período",
  );
}

/* ══════════════ 8. a migration em si ══════════════ */

function testeMigration() {
  group("migration: função pública");

  const sql = readFileSync(MIGRATION, "utf8");
  // Comentários explicam o SQL — e o bloco da FASE 2 cita, de propósito,
  // comandos que esta migration NÃO executa. As asserções sobre o que o SQL FAZ
  // precisam olhar só o código executável: fora os comentários `--` e os blocos
  // `/* */`. Sem isso, o texto da fase 2 seria lido como se fosse código.
  const codigo = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  check("cria get_public_products", /CREATE OR REPLACE FUNCTION public\.get_public_products/.test(sql));
  check("é SECURITY DEFINER", /SECURITY DEFINER/.test(sql));
  check("fixa search_path", /SET search_path TO 'public'/.test(sql));
  check("é STABLE (não escreve)", /\bSTABLE\b/.test(sql));
  check("não contém SELECT * no código executável", !/SELECT\s+\*/i.test(codigo));
  check("filtra produto ativo", /p\.active\s*=\s*true/.test(sql));
  check("filtra barbearia aprovada", /b\.status\s*=\s*'approved'/.test(sql));
  check("exclui a barbearia sentinela", /barbershop_is_system_sentinel/.test(sql));
  check("calcula in_stock a partir de stock_quantity", /\(p\.stock_quantity\s*>\s*0\)\s*AS in_stock/.test(sql));
  check("não devolve stock_quantity como coluna", !/^\s*stock_quantity\s+integer/m.test(sql));
  check("ordena de forma estável", /ORDER BY p\.name ASC, p\.id ASC/.test(sql));

  group("migration: grants e RLS");

  check("revoga EXECUTE de PUBLIC", /REVOKE ALL ON FUNCTION public\.get_public_products\(uuid\) FROM PUBLIC/.test(codigo));
  check("concede EXECUTE a anon e authenticated", /GRANT EXECUTE ON FUNCTION public\.get_public_products\(uuid\) TO anon, authenticated/.test(codigo));
  check("cria policy de leitura para staff", /CREATE POLICY "Staff can view products of their barbershop"/.test(codigo));
  check("policy de staff é só para authenticated", /ON public\.products FOR SELECT\s*\nTO authenticated/.test(codigo));
  check("policy de staff cobre admin e barbeiro", /'admin_barbearia'/.test(codigo) && /'barbeiro'/.test(codigo));
  check("policy de staff escopa pelo barbershop_id da linha", /has_role_in_barbershop\(auth\.uid\(\), barbershop_id,/.test(codigo));
  check("não concede escrita pública", !/GRANT (INSERT|UPDATE|DELETE)[^;]*TO anon/i.test(codigo));
  check("não concede SELECT extra em products ao anon", !/GRANT SELECT[^;]*public\.products[^;]*TO anon/i.test(codigo));
  check("documenta rollback conceitual", /ROLLBACK CONCEITUAL/.test(sql));

  /* ─── o ponto desta branch: a fase 1 é aditiva ─── */

  group("migration: FASE 1 é retrocompatível");

  check(
    "NÃO remove a policy pública antiga",
    !/DROP POLICY/i.test(codigo),
    "a remoção pertence à fase 2 — antes disso, o frontend publicado quebra",
  );
  check(
    "NÃO revoga o SELECT de anon na tabela",
    !/REVOKE[^;]*\bproducts\b/i.test(codigo),
    "revogar aqui derruba a vitrine pública ainda em produção",
  );
  check(
    "nenhum REVOKE/DROP incide sobre a tabela products",
    !/(REVOKE|DROP)[^;]*public\.products/i.test(codigo),
  );
  // O corpo `$$ ... $$` da função tem `;` internos — some com ele antes de
  // separar os comandos, senão o SELECT interno vira um "statement" solto.
  const comandos = codigo
    .replace(/\$\$[\s\S]*?\$\$/g, "CORPO_DA_FUNCAO")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  check(
    "só executa comandos aditivos (CREATE/GRANT/COMMENT + REVOKE da função)",
    comandos.every((s) => /^(CREATE|GRANT|COMMENT|REVOKE ALL ON FUNCTION)/i.test(s)),
    comandos.filter((s) => !/^(CREATE|GRANT|COMMENT|REVOKE ALL ON FUNCTION)/i.test(s)).join(" | "),
  );
  check("a migration executa exatamente 5 comandos", comandos.length === 5, `${comandos.length}: ${comandos.map((c) => c.split(/\s+/).slice(0, 3).join(" ")).join(" | ")}`);

  group("migration: FASE 2 documentada mas não versionada");

  check("documenta explicitamente a fase 2", /FASE 2/.test(sql));
  check("fase 2 documenta o DROP da policy pública", /DROP POLICY IF EXISTS "Anyone can view products of approved barbershops"/.test(sql));
  check("fase 2 documenta o REVOKE do anon", /REVOKE SELECT ON TABLE public\.products FROM anon/.test(sql));
  check("fase 2 explica por que não é versionada agora", /db push/.test(sql) && /janela de indisponibilidade/.test(sql));
  check("fase 2 lista as verificações pós-aplicação", /Verificações obrigatórias após aplicar a fase 2/.test(sql));

  // Se alguém versionar a fase 2 antes da hora, um único `db push` aplicaria as
  // duas — reintroduzindo a janela que esta separação existe para evitar.
  const migrations = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
  const comFase2 = migrations.filter((f) => {
    if (f === "20260727120000_public_product_catalog.sql") return false;
    const conteudo = readFileSync(path.join(ROOT, "supabase", "migrations", f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    return (
      /REVOKE[^;]*SELECT[^;]*public\.products[^;]*anon/i.test(conteudo) ||
      /DROP POLICY[^;]*"Anyone can view products of approved barbershops"/i.test(conteudo)
    );
  });
  check("não existe migration da fase 2 no diretório", comFase2.length === 0, comFase2.join(", "));

  group("migration: não altera o histórico");

  const antiga = lerArquivo("supabase/migrations/20260416141800_9a03d2de-09aa-4713-b0a5-b74b0b961c48.sql");
  check(
    "migration original de products segue intacta",
    antiga.includes('CREATE POLICY "Anyone can view products of approved barbershops"'),
  );
  check(
    "policy pública antiga continua sendo a última palavra até a fase 2",
    antiga.includes('CREATE POLICY "Anyone can view products of approved barbershops"') && !/DROP POLICY/i.test(codigo),
  );
}

/* ══════════════ 9. paridade mock ↔ SQL ══════════════ */

function testeParidade() {
  group("paridade entre mock e migration");

  const mock = lerArquivo("src/mocks/client.ts");
  check("mock implementa get_public_products", mock.includes("get_public_products"));
  check("mock cita a migration correspondente", mock.includes("20260727120000"));
  check(
    "mock filtra approved e active",
    /status !== "approved"/.test(mock) && /p\.active === true/.test(mock),
  );
  check("mock calcula in_stock por quantidade > 0", /stock_quantity \?\? 0\) > 0/.test(mock));
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  resetMockDatabase();

  await testeConteudo();
  await testeIsolamento();
  await testeParametros();
  testeFrontendPublico();
  testeFrontendInterno();
  await testeComandas();
  await testeRelatorios();
  testeMigration();
  testeParidade();

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
