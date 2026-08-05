/**
 * Harness da nota pública por profissional.
 *
 * `reviews` não tem `barber_id`: o vínculo com o profissional passa por
 * `appointments`. `PublicBookingWizard` fazia esse join NO NAVEGADOR, com
 * `reviews.select("rating, appointments!inner(barber_id)")`, e a consulta era
 * impossível contra o Supabase real:
 *
 *   • para `anon`, 42501 — o papel nunca teve SELECT em `appointments`;
 *   • para o cliente logado, a policy de `appointments` só libera os
 *     agendamentos DELE, então o `!inner` descartava o resto e a "média
 *     pública" era calculada apenas com as avaliações do próprio visitante;
 *   • para staff e super_admin, o número saía certo — ou seja, o defeito era
 *     invisível justamente para quem testa.
 *
 * A migration 20260805140000 move o cálculo para uma RPC SECURITY DEFINER que
 * devolve só o agregado. Este harness prova as duas metades:
 *
 *   1. a RPC responde certo, para qualquer chamador, e recusa barbearia não
 *      pública;
 *   2. o caminho anônimo não pode voltar a fazer o join no navegador — nem por
 *      embed, nem lendo tabela que o `anon` não pode ler.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE O GUARD DE REGRESSÃO É O CORAÇÃO DESTE ARQUIVO
 *
 * O defeito sobreviveu à revisão inteira da superfície pública porque o MOCK
 * era permissivo: `src/mocks/relations.ts` declara a relação
 * `reviews → appointments` e o mock resolvia o embed lendo o store, sem checar
 * privilégio. A consulta passava offline e só falhava em produção.
 *
 * Agora `src/mocks/grants.ts` carrega a lista real do que `anon` lê, e o
 * query-builder aplica a checagem também às tabelas alcançadas por EMBED. As
 * asserções abaixo travam esse comportamento: se alguém afrouxar o mock, este
 * harness cai junto.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows, setTableRows } from "@/mocks/store";
import { resetAnonGrants, tabelasLegiveisPorAnon } from "@/mocks/grants";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_BARBERSHOP_ID,
  MOCK_BARBERSHOP_E_ID,
  MOCK_USER_IDS,
} from "@/mocks/fixtures";

const ROOT = process.cwd();
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260805140000_public_barber_ratings.sql",
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

/** Fonte sem comentário: asserções de "não faz X" olham código, não explicação. */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

type Row = Record<string, unknown>;

async function notas(barbershopId: unknown): Promise<Row[]> {
  const { data, error } = await mockSupabaseClient.rpc("get_public_barber_ratings", {
    _barbershop_id: barbershopId,
  });
  if (error) throw new Error(`RPC falhou: ${JSON.stringify(error)}`);
  return (data ?? []) as Row[];
}

async function login(email: string) {
  const res = await mockSupabaseClient.auth.signInWithPassword({
    email,
    password: "qualquer-senha",
  });
  if (res.error || !res.data.session) {
    throw new Error(`Falha no login fictício: ${email}`);
  }
}

/**
 * Cria avaliações de CLIENTES DIFERENTES para dois profissionais da barbearia
 * principal, cada uma amarrada a um agendamento existente daquele profissional.
 *
 * O ponto de ter mais de um cliente é provar que o agregado não é "a nota de
 * quem está logado" — que é exatamente o que a consulta antiga devolvia.
 */
function semearAvaliacoes() {
  const agendamentos = getTableRows("appointments").filter(
    (a) => a.barbershop_id === MOCK_BARBERSHOP_ID && a.barber_id,
  );

  const porBarbeiro = new Map<string, Row[]>();
  for (const a of agendamentos) {
    const lista = porBarbeiro.get(String(a.barber_id)) ?? [];
    lista.push(a);
    porBarbeiro.set(String(a.barber_id), lista);
  }

  const [barbeiroA, barbeiroB] = [...porBarbeiro.keys()];

  // As fixtures já trazem avaliações para esta barbearia. Elas são removidas
  // aqui para que a média esperada seja aritmética conhecida, e não o que
  // sobrar do seed — um número que mudaria a cada ajuste nas fixtures.
  setTableRows(
    "reviews",
    getTableRows("reviews").filter((r) => r.barbershop_id !== MOCK_BARBERSHOP_ID),
  );

  const novas: Row[] = [];
  const clientes = [MOCK_USER_IDS.clienteCarla, MOCK_USER_IDS.clienteCaio, MOCK_USER_IDS.clienteDiego]
    .filter(Boolean)
    .map(String);

  // Barbeiro A: notas 5 e 3, de clientes distintos → média 4,0 com 2 avaliações.
  const doA = porBarbeiro.get(barbeiroA) ?? [];
  [5, 3].forEach((nota, i) => {
    const agendamento = doA[i];
    if (!agendamento) return;
    novas.push({
      id: `aval-a-${i}`,
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: clientes[i % clientes.length],
      appointment_id: agendamento.id,
      rating: nota,
      comment: `[harness] avaliação ${i}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  });

  // Barbeiro B: uma nota 4 → média 4,0 com 1 avaliação.
  const doB = porBarbeiro.get(barbeiroB) ?? [];
  if (doB[0]) {
    novas.push({
      id: "aval-b-0",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: clientes[2 % clientes.length],
      appointment_id: doB[0].id,
      rating: 4,
      comment: "[harness] avaliação b",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  setTableRows("reviews", [...getTableRows("reviews"), ...novas]);
  return { barbeiroA, barbeiroB, criadas: novas.length };
}

/* ══════════════ 1. a RPC devolve o agregado certo ══════════════ */

async function testeAgregado() {
  group("nota por profissional: agregado correto, sem sessão");

  await mockSupabaseClient.auth.signOut();
  const { barbeiroA, barbeiroB, criadas } = semearAvaliacoes();
  check("cenário semeado com avaliações de clientes diferentes", criadas >= 3, `${criadas} avaliações`);

  const lista = await notas(MOCK_BARBERSHOP_ID);
  const porId = new Map(lista.map((r) => [String(r.barber_id), r]));

  check("anônimo consegue ler as notas", lista.length > 0, `${lista.length} linha(s)`);
  check(
    "só devolve barber_id, rating_avg e rating_count",
    lista.every((r) => Object.keys(r).sort().join(",") === "barber_id,rating_avg,rating_count"),
    Object.keys(lista[0] ?? {}).join(", "),
  );

  const a = porId.get(barbeiroA);
  const b = porId.get(barbeiroB);
  check("barbeiro com notas 5 e 3 tem média 4", Number(a?.rating_avg) === 4, String(a?.rating_avg));
  check("e contagem 2 — as duas avaliações, de clientes diferentes", Number(a?.rating_count) === 2, String(a?.rating_count));
  check("barbeiro com uma nota 4 tem média 4", Number(b?.rating_avg) === 4, String(b?.rating_avg));
  check("e contagem 1", Number(b?.rating_count) === 1, String(b?.rating_count));

  group("nota por profissional: não é a nota de quem está logado");

  // O defeito antigo: com sessão do cliente, a RLS de `appointments` deixava
  // passar só os agendamentos dele, e a média virava a dele. Aqui a resposta
  // tem de ser IDÊNTICA à do anônimo, para qualquer chamador.
  const semSessao = JSON.stringify(await notas(MOCK_BARBERSHOP_ID));
  await login(MOCK_ADMIN_EMAIL);
  const comAdmin = JSON.stringify(await notas(MOCK_BARBERSHOP_ID));
  await mockSupabaseClient.auth.signOut();

  check("a resposta é a mesma com e sem sessão", semSessao === comAdmin, `${semSessao} vs ${comAdmin}`);
  check(
    "a média cobre mais de um cliente",
    Number(porId.get(barbeiroA)?.rating_count) > 1,
    "se fosse 1, o agregado seria só a avaliação de um cliente",
  );

  group("nota por profissional: avaliação sem agendamento não entra");

  // `appointment_id` é nulo quando o agendamento foi apagado (ON DELETE SET
  // NULL): não há como saber a quem a avaliação se referia.
  const antes = getTableRows("reviews");
  setTableRows("reviews", [
    ...antes,
    {
      id: "aval-orfa",
      barbershop_id: MOCK_BARBERSHOP_ID,
      client_id: String(MOCK_USER_IDS.clienteCarla),
      appointment_id: null,
      rating: 1,
      comment: "[harness] órfã",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
  const comOrfa = await notas(MOCK_BARBERSHOP_ID);
  const totalComOrfa = comOrfa.reduce((s, r) => s + Number(r.rating_count), 0);
  const totalSemOrfa = lista.reduce((s, r) => s + Number(r.rating_count), 0);
  check(
    "avaliação órfã não muda nenhuma contagem",
    totalComOrfa === totalSemOrfa,
    `${totalComOrfa} vs ${totalSemOrfa}`,
  );
  setTableRows("reviews", antes);
}

/* ══════════════ 2. recusas ══════════════ */

async function testeRecusas() {
  group("nota por profissional: barbearia não pública devolve vazio");

  check("barbearia PENDENTE devolve []", (await notas(MOCK_BARBERSHOP_E_ID)).length === 0);

  const base = getTableRows("barbershops");
  const rejeitada = {
    ...base[0],
    id: "c0c0c0c0-0000-4000-8000-000000000001",
    subdomain: "rejeitada-notas",
    status: "rejected",
  };
  const sentinela = {
    ...base[0],
    id: "c0c0c0c0-0000-4000-8000-000000000002",
    subdomain: "_system",
    status: "approved",
  };
  setTableRows("barbershops", [...base, rejeitada, sentinela]);

  check("barbearia REJEITADA devolve []", (await notas(rejeitada.id)).length === 0);
  check("sentinela _system devolve []", (await notas(sentinela.id)).length === 0);
  setTableRows("barbershops", base);

  check("id inexistente devolve []", (await notas("00000000-0000-4000-8000-000000000000")).length === 0);
  check("id nulo devolve []", (await notas(null)).length === 0);
  check("id indefinido devolve []", (await notas(undefined)).length === 0);
}

/* ══════════════ 3. o guard: o mock não é mais permissivo ══════════════ */

async function testeMockNaoPermissivo() {
  group("mock: o anônimo não lê o que o banco não deixa");

  await mockSupabaseClient.auth.signOut();

  const permitidas = tabelasLegiveisPorAnon();
  check(
    "a lista de leitura anônima é a do banco (5 objetos)",
    permitidas.join(",") === "availability,barbearias_publicas,plans,reviews,services",
    permitidas.join(", "),
  );

  for (const tabela of ["appointments", "profiles", "user_roles", "barbershops", "products"]) {
    const { data, error } = await (mockSupabaseClient as any).from(tabela).select("*");
    check(
      `${tabela}: leitura anônima é NEGADA com 42501`,
      (error as any)?.code === "42501" && (data ?? []).length === 0,
      JSON.stringify(error),
    );
  }

  for (const tabela of permitidas) {
    const { error } = await (mockSupabaseClient as any).from(tabela).select("*");
    check(`${tabela}: leitura anônima continua permitida`, !error, JSON.stringify(error));
  }

  group("mock: o EMBED também exige privilégio");

  // A consulta exata que existia em PublicBookingWizard. Este é o teste que
  // teria pego o defeito original — e que só funciona porque o query-builder
  // passou a checar as tabelas alcançadas por embed, não só a do `from`.
  const { data: viaEmbed, error: erroEmbed } = await (mockSupabaseClient as any)
    .from("reviews")
    .select("rating, appointments!inner(barber_id)")
    .eq("barbershop_id", MOCK_BARBERSHOP_ID);
  check(
    "reviews com embed em appointments é NEGADO para anônimo",
    (erroEmbed as any)?.code === "42501" && (viaEmbed ?? []).length === 0,
    JSON.stringify(erroEmbed),
  );
  check(
    "e o erro nomeia appointments, não reviews",
    String((erroEmbed as any)?.message ?? "").includes("appointments"),
    String((erroEmbed as any)?.message),
  );

  // Sem embed proibido, a mesma tabela continua legível: o que bloqueia é a
  // tabela alcançada, não o fato de haver embed.
  const { error: erroSimples } = await (mockSupabaseClient as any)
    .from("reviews")
    .select("id, rating")
    .eq("barbershop_id", MOCK_BARBERSHOP_ID);
  check("reviews sem embed continua legível por anônimo", !erroSimples, JSON.stringify(erroSimples));

  group("mock: com sessão, o embed volta a funcionar");

  await login(MOCK_ADMIN_EMAIL);
  const { error: erroComSessao } = await (mockSupabaseClient as any)
    .from("reviews")
    .select("rating, appointments!inner(barber_id)")
    .eq("barbershop_id", MOCK_BARBERSHOP_ID);
  check("staff logado consegue o embed", !erroComSessao, JSON.stringify(erroComSessao));
  await mockSupabaseClient.auth.signOut();
}

/* ══════════════ 4. guard de regressão no código ══════════════ */

/** Telas e hooks alcançáveis sem sessão. */
const CAMINHO_ANONIMO = [
  "src/routes/barbearias.tsx",
  "src/routes/agendar.index.tsx",
  "src/routes/agendar.$slug.tsx",
  "src/routes/index.tsx",
  "src/routes/manifest[.]json.tsx",
  "src/components/booking/PublicBookingWizard.tsx",
  "src/components/booking/useBookingData.ts",
  "src/components/ReviewsShowcase.tsx",
  "src/components/TenantThemeProvider.tsx",
  "src/hooks/use-barbershop.tsx",
  "src/hooks/use-plan.tsx",
];

function testeGuardDeRegressao() {
  group("código: nenhuma tela anônima faz embed em appointments");

  for (const arquivo of CAMINHO_ANONIMO) {
    const codigo = semComentarios(lerArquivo(arquivo));
    check(
      `${arquivo} não embute appointments`,
      !/appointments\s*!?\s*(inner)?\s*\(/.test(codigo) && !/:\s*appointments\s*\(/.test(codigo),
      "o join reviews × appointments só pode acontecer no servidor",
    );
  }

  group("código: nem LÊ tabela fora do que o anon pode ler");

  // A varredura procura LEITURA — `from(x).select(...)`. Escrita não entra:
  // `anon` não tem INSERT nessas tabelas, então um INSERT só existe em handler
  // que já exige sessão, e barrá-lo aqui seria falso positivo.
  //
  // `barbershops` fica fora da lista: `use-barbershop` e `use-plan` só a
  // consultam no ramo COM sessão, e é a suíte superficie-barbershops que trava
  // isso, com asserções específicas para cada ramo.
  const proibidas = ["appointments", "profiles", "tickets", "ticket_items", "notifications", "client_notes"];

  /**
   * Leituras legítimas: acontecem em bloco que já exige sessão. Cada entrada
   * precisa dizer ONDE está a guarda — sem isso a exceção vira desculpa, e o
   * guard perde o sentido.
   */
  const EXCECOES: Record<string, Record<string, string>> = {
    "src/components/ReviewsShowcase.tsx": {
      profiles: "bloco após `if (!user) return null` — lê o próprio perfil do usuário logado",
    },
  };

  for (const arquivo of CAMINHO_ANONIMO) {
    const codigo = semComentarios(lerArquivo(arquivo));
    const achadas = proibidas.filter((t) => {
      // `from("x")` seguido de `.select(` — leitura. `.insert(`/`.update(`/
      // `.delete(` não contam.
      const leitura = new RegExp(`from\\(\\s*["'\`]${t}["'\`]\\s*\\)[\\s\\S]{0,80}?\\.select\\(`);
      if (!leitura.test(codigo)) return false;
      return !EXCECOES[arquivo]?.[t];
    });
    check(`${arquivo} não lê tabela privada`, achadas.length === 0, achadas.join(", "));
  }

  // A exceção só vale enquanto a guarda existir de fato.
  const showcase = semComentarios(lerArquivo("src/components/ReviewsShowcase.tsx"));
  check(
    "a exceção de ReviewsShowcase continua atrás de `if (!user)`",
    /if \(!user\) return null;[\s\S]{0,400}from\(\s*["']profiles["']\s*\)/.test(showcase),
    "se a guarda sumir, a exceção deixa de ser legítima",
  );

  // O INSERT do agendamento também precisa continuar exigindo sessão.
  const wizardBruto = semComentarios(lerArquivo("src/components/booking/PublicBookingWizard.tsx"));
  check(
    "PublicBookingWizard só escreve em appointments, nunca lê",
    !/from\(\s*["']appointments["']\s*\)[\s\S]{0,80}?\.select\(/.test(wizardBruto),
    "ler appointments no navegador é o defeito que esta frente corrigiu",
  );
  // O INSERT vive em `handleBook`, que sai cedo sem sessão. `anon` não tem
  // INSERT em `appointments` no banco, então sem essa guarda a tela mandaria
  // uma escrita fadada a 42501.
  check(
    "e o INSERT do agendamento exige sessão",
    /if \([^)]*!user[^)]*\) return;/.test(wizardBruto) &&
      /from\(\s*["']appointments["']\s*\)[\s\S]{0,40}\.insert\(/.test(wizardBruto),
    "handleBook precisa continuar barrando quem não tem sessão",
  );

  group("código: PublicBookingWizard usa a RPC e trata o erro");

  const wizard = semComentarios(lerArquivo("src/components/booking/PublicBookingWizard.tsx"));
  check("chama get_public_barber_ratings", wizard.includes("get_public_barber_ratings"));
  check(
    "não descarta o erro da consulta de notas",
    /error: ratingError/.test(wizard) && /if \(ratingError\)/.test(wizard),
  );
  check("registra o erro por logTechnicalError", /logTechnicalError\([^)]*PublicBookingWizard/.test(wizard));
  check("tem estado próprio para falha", /setRatingsUnavailable/.test(wizard));

  const wizardComTexto = lerArquivo("src/components/booking/PublicBookingWizard.tsx");
  check(
    "falha e ausência de avaliação renderizam textos diferentes",
    wizardComTexto.includes("Avaliações indisponíveis") && wizardComTexto.includes("Sem avaliações"),
  );
  check(
    "o estado de falha vem ANTES do ramo de contagem zero",
    wizardComTexto.indexOf("ratingsUnavailable ?") < wizardComTexto.indexOf("b.rating_count && b.rating_count > 0"),
    "senão a falha continuaria caindo em 'Sem avaliações'",
  );

  group("código: /barbearias não lê profiles direto");

  const lista = semComentarios(lerArquivo("src/routes/barbearias.tsx"));
  check("não consulta a tabela profiles", !/from\(\s*["']profiles["']\s*\)/.test(lista));
  check("usa fetchProfileSummaries", lista.includes("fetchProfileSummaries"));
}

/* ══════════════ 5. a migration ══════════════ */

function testeMigration() {
  const sql = readFileSync(MIGRATION, "utf8");
  const codigo = sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  group("migration: a função");

  check("cria get_public_barber_ratings", /CREATE OR REPLACE FUNCTION public\.get_public_barber_ratings\(_barbershop_id uuid\)/.test(codigo));
  check("é SECURITY DEFINER", /SECURITY DEFINER/.test(codigo));
  check("fixa search_path", /SET search_path TO 'public'/.test(codigo));
  check("é STABLE (não escreve)", /\bSTABLE\b/.test(codigo));
  check("devolve barber_id, rating_avg e rating_count", /barber_id\s+uuid/.test(codigo) && /rating_avg\s+numeric/.test(codigo) && /rating_count integer/.test(codigo));
  check("arredonda para uma casa", /round\(avg\(r\.rating\)::numeric, 1\)/.test(codigo));
  check("reaproveita barbershop_is_public", /public\.barbershop_is_public\(_barbershop_id\)/.test(codigo));
  check("recusa id nulo", /_barbershop_id IS NOT NULL/.test(codigo));
  check("exige agendamento com profissional", /a\.barber_id IS NOT NULL/.test(codigo));
  check("exige o mesmo tenant nos dois lados", /a\.barbershop_id = r\.barbershop_id/.test(codigo));

  group("migration: o que NÃO sai da função");

  const bloco = /RETURNS TABLE \(([\s\S]*?)\)/.exec(codigo)?.[1] ?? "";
  check("bloco de retorno localizado", bloco.length > 0);
  for (const coluna of ["comment", "client_id", "appointment_id", "date", "start_time", "status", "price"]) {
    check(`não devolve ${coluna}`, !new RegExp(`\\b${coluna}\\b`).test(bloco));
  }

  group("migration: grants e forma");

  check("revoga EXECUTE de PUBLIC", /REVOKE ALL ON FUNCTION public\.get_public_barber_ratings\(uuid\) FROM PUBLIC/.test(codigo));
  check("concede EXECUTE a anon e authenticated", /GRANT EXECUTE ON FUNCTION public\.get_public_barber_ratings\(uuid\) TO anon, authenticated/.test(codigo));
  check("não concede acesso a tabela", !/GRANT SELECT/i.test(codigo));
  check("nenhum DROP no código executável", !/\bDROP\b/i.test(codigo));
  check("não altera policy", !/(CREATE|ALTER|DROP)\s+POLICY/i.test(codigo));
  check("não recria get_public_barbers_v2", !/FUNCTION public\.get_public_barbers_v2/.test(codigo));
  check("documenta rollback", /ROLLBACK/.test(sql));

  const comandos = codigo
    .replace(/\$\$[\s\S]*?\$\$/g, "CORPO")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  check(
    "executa exatamente 4 comandos (CREATE, COMMENT, REVOKE, GRANT)",
    comandos.length === 4,
    `${comandos.length}: ${comandos.map((c) => c.split(/\s+/).slice(0, 3).join(" ")).join(" | ")}`,
  );
  check(
    "só comandos aditivos",
    comandos.every((c) => /^(CREATE|COMMENT|REVOKE ALL ON FUNCTION|GRANT EXECUTE)/i.test(c)),
    comandos.filter((c) => !/^(CREATE|COMMENT|REVOKE ALL ON FUNCTION|GRANT EXECUTE)/i.test(c)).join(" | "),
  );

  group("migration: nenhuma outra versiona esta função");

  const dir = path.join(ROOT, "supabase", "migrations");
  const outras = readdirSync(dir).filter((arquivo) => {
    if (!arquivo.endsWith(".sql") || arquivo === path.basename(MIGRATION)) return false;
    return /get_public_barber_ratings/.test(readFileSync(path.join(dir, arquivo), "utf8"));
  });
  check("função definida em um único arquivo", outras.length === 0, outras.join(", "));
}

/* ══════════════ 6. paridade mock ↔ SQL ══════════════ */

function testeParidade() {
  group("paridade entre mock e migration");

  const client = lerArquivo("src/mocks/client.ts");
  check("mock implementa a RPC", client.includes("get_public_barber_ratings"));
  check("mock cita a migration", client.includes("20260805140000"));
  check("mock exige barbearia aprovada e não-sentinela", /status !== "approved"/.test(client) && /_system/.test(client));
  check("mock trata appointment_id nulo", /review\.appointment_id \? /.test(client));
  check("mock confere o tenant dos dois lados", /agendamento\?\.barbershop_id !== review\.barbershop_id/.test(client));

  const grants = lerArquivo("src/mocks/grants.ts");
  check("grants.ts documenta a origem da lista", grants.includes("has_table_privilege"));
  check("grants.ts não inclui barbershops", !/^\s*"barbershops",/m.test(grants));
  check("grants.ts não inclui appointments", !/^\s*"appointments",/m.test(grants));

  const builder = lerArquivo("src/mocks/query-builder.ts");
  check("query-builder checa as tabelas do embed", /this\.embeds\.map\(\(e\) => e\.table\)/.test(builder));
  check("e devolve 42501 nomeando a tabela negada", /permission denied for table \$\{negada\}/.test(builder));
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  resetMockDatabase();
  resetAnonGrants();
  await mockSupabaseClient.auth.signOut();

  await testeAgregado();
  await testeRecusas();
  await testeMockNaoPermissivo();
  testeGuardDeRegressao();
  testeMigration();
  testeParidade();

  resetAnonGrants();
  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
