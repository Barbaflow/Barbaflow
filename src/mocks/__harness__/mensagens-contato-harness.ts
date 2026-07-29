/**
 * Harness da leitura das mensagens do formulário de contato.
 *
 * A tabela `contact_submissions` guarda nome, e-mail, telefone e texto livre de
 * quem escreve pelo site público. É gravável por qualquer visitante e legível
 * só pelo super_admin (migration 20260416012649). Até agora nada no produto
 * lia essas mensagens — elas entravam e ninguém era avisado.
 *
 * Três frentes:
 *
 *   1. permissão — quem lê e quem não lê, exercitando o mock com sessão de
 *      cada papel; e o que continua sendo possível escrever;
 *   2. código — a tela guarda o papel antes de consultar, e o formulário
 *      público continua gravando como antes;
 *   3. SQL — a migration concede exatamente isso, nem mais nem menos.
 *
 * A frente 3 é análise estática do `.sql`. Não substitui aplicar a migration
 * num banco; é o que garante que a policy que a tela pressupõe existe mesmo, e
 * que ninguém a afrouxou depois.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { mockSupabaseClient } from "@/mocks/client";
import { resetMockDatabase, getTableRows } from "@/mocks/store";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_CLIENT_BENTO_EMAIL,
  MOCK_SUPER_ADMIN_EMAIL,
} from "@/mocks/fixtures";
import { displayBRPhone, isPlausibleBRPhone, whatsappUrl } from "@/lib/phone";
import {
  CONTACT_CHECK_SQLSTATE,
  CONTACT_LIMITS,
  CONTACT_RATE_LIMIT,
  CONTACT_RATE_LIMIT_SQLSTATE,
} from "@/mocks/rules";

const ROOT = process.cwd();

const TELA = "src/routes/admin.mensagens.tsx";
const FORMULARIO = "src/routes/contato.tsx";
const PAINEL = "src/components/AdminDashboard.tsx";
const MIGRATION = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260416012649_0fdafc77-680f-428a-8218-3ebe10f1437e.sql",
);
const GRANTS = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260721140000_explicit_data_api_grants.sql",
);
const LIMITES = path.join(
  ROOT,
  "supabase",
  "migrations",
  "20260729120000_contact_submissions_limits.sql",
);

/** E-mail de barbeiro do seed (perfil da Ana, Barbearia A). */
const MOCK_BARBER_EMAIL = "ana@barbearia.teste";

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

/** Consulta como a tela consulta: colunas explícitas, mais recente primeiro. */
async function lerMensagens() {
  const { data, error } = await mockSupabaseClient
    .from("contact_submissions")
    .select("id, name, email, phone, message, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  return { linhas: (data ?? []) as Record<string, unknown>[], error };
}

/* ══════════════ 1. quem pode ler ══════════════ */

async function testeLeitura() {
  group("leitura: só o super_admin enxerga");

  const total = getTableRows("contact_submissions").length;
  check("o seed tem mensagens para ler", total > 0, `${total} mensagens`);

  await logout();
  const anon = await lerMensagens();
  check("visitante sem sessão não lê nada", anon.linhas.length === 0);

  await login(MOCK_CLIENT_BENTO_EMAIL);
  const cliente = await lerMensagens();
  check("cliente autenticado não lê nada", cliente.linhas.length === 0);

  await login(MOCK_BARBER_EMAIL);
  const barbeiro = await lerMensagens();
  check("barbeiro não lê nada", barbeiro.linhas.length === 0);

  await login(MOCK_ADMIN_EMAIL);
  const adminShop = await lerMensagens();
  check("admin de barbearia não lê nada", adminShop.linhas.length === 0);

  await login(MOCK_SUPER_ADMIN_EMAIL);
  const root = await lerMensagens();
  check("super_admin lê todas as mensagens", root.linhas.length === total, `${root.linhas.length}/${total}`);

  group("leitura: conteúdo e ordem");

  check(
    "vem com os campos que a tela renderiza",
    root.linhas.every(
      (m) =>
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        typeof m.email === "string" &&
        typeof m.message === "string" &&
        typeof m.created_at === "string",
    ),
  );
  check(
    "telefone pode ser nulo sem quebrar a listagem",
    root.linhas.some((m) => m.phone === null) && root.linhas.some((m) => typeof m.phone === "string"),
  );

  const datas = root.linhas.map((m) => new Date(String(m.created_at)).getTime());
  check(
    "mais recente primeiro",
    datas.every((t, i) => i === 0 || datas[i - 1] >= t),
  );

  group("leitura: recorte por período");

  const desde30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentes } = await mockSupabaseClient
    .from("contact_submissions")
    .select("id, created_at")
    .gte("created_at", desde30)
    .order("created_at", { ascending: false });

  const noPeriodo = (recentes ?? []) as Record<string, unknown>[];
  check("o filtro de 30 dias corta o histórico antigo", noPeriodo.length < total);
  check("e ainda devolve as mensagens recentes", noPeriodo.length > 0);
  check(
    "nenhuma mensagem fora da janela escapa",
    noPeriodo.every((m) => String(m.created_at) >= desde30),
  );
}

/* ══════════════ 2. o que ainda pode ser escrito ══════════════ */

async function testeEscrita() {
  group("escrita: o formulário público continua funcionando");

  await logout();
  const { error: erroAnon } = await mockSupabaseClient.from("contact_submissions").insert({
    name: "Visitante de teste",
    email: "visitante@exemplo.teste",
    phone: null,
    message: "Mensagem enviada pelo harness.",
  });
  check("visitante anônimo consegue enviar mensagem", !erroAnon, JSON.stringify(erroAnon));

  await login(MOCK_CLIENT_BENTO_EMAIL);
  const { error: erroAuth } = await mockSupabaseClient.from("contact_submissions").insert({
    name: "Cliente de teste",
    email: "cliente@exemplo.teste",
    phone: "11987650000",
    message: "Mensagem enviada por usuário logado.",
  });
  check("usuário autenticado também consegue enviar", !erroAuth, JSON.stringify(erroAuth));

  group("escrita: mensagem enviada não é editada nem apagada");

  await login(MOCK_SUPER_ADMIN_EMAIL);
  const { linhas: atuais } = await lerMensagens();
  const alvo = String(atuais[0]?.id ?? "");
  check("há uma mensagem para tentar alterar", alvo.length > 0);

  const { error: erroUpdate } = await mockSupabaseClient
    .from("contact_submissions")
    .update({ message: "editado" })
    .eq("id", alvo);
  check("nem o super_admin edita uma mensagem", Boolean(erroUpdate));

  const { error: erroDelete } = await mockSupabaseClient
    .from("contact_submissions")
    .delete()
    .eq("id", alvo);
  check("nem o super_admin apaga uma mensagem", Boolean(erroDelete));

  const { linhas: depois } = await lerMensagens();
  check("a mensagem continua íntegra", depois.some((m) => m.id === alvo && m.message !== "editado"));

  group("escrita: o anônimo não ganhou leitura ao escrever");

  await logout();
  const { linhas: aposEscrever } = await lerMensagens();
  check("depois de enviar, o visitante segue sem ler nada", aposEscrever.length === 0);
}

/* ══════════════ 2b. limites de conteúdo e de vazão ══════════════ */

/** Envia uma mensagem pelo caminho do formulário público. */
async function enviar(campos: Record<string, unknown>) {
  const { error } = await mockSupabaseClient.from("contact_submissions").insert({
    name: "Remetente de teste",
    email: "remetente@exemplo.teste",
    phone: null,
    message: "Mensagem de teste.",
    ...campos,
  });
  return error;
}

/** SQLSTATE que a recusa carrega — é por ele que `/contato` ramifica. */
function codigoDe(erro: unknown): string | null {
  if (erro && typeof erro === "object" && "code" in erro) return String(erro.code);
  return null;
}

/**
 * As CHECK constraints e o trigger de vazão da migration 20260729120000. O
 * `anon` insere direto na Data API, então estes limites são a única barreira
 * real — a validação de `contato.tsx` não alcança quem chama o PostgREST na
 * mão.
 */
async function testeLimites() {
  group("limites: o que o formulário já mandaria passa");

  await logout();
  check("mensagem normal é aceita", (await enviar({ email: "normal@exemplo.teste" })) === null);
  check(
    "telefone ausente continua aceito",
    (await enviar({ email: "semfone@exemplo.teste", phone: null })) === null,
  );
  check(
    "telefone preenchido é aceito",
    (await enviar({ email: "comfone@exemplo.teste", phone: "11987650009" })) === null,
  );
  check(
    "nome no limite exato é aceito",
    (await enviar({ email: "limite@exemplo.teste", name: "a".repeat(CONTACT_LIMITS.name) })) === null,
  );
  check(
    "mensagem no limite exato é aceita",
    (await enviar({
      email: "limite2@exemplo.teste",
      message: "b".repeat(CONTACT_LIMITS.message),
    })) === null,
  );

  group("limites: tamanho e formato recusados");

  check("nome vazio é recusado", Boolean(await enviar({ email: "n1@exemplo.teste", name: "" })));
  check(
    "nome só com espaço é recusado",
    Boolean(await enviar({ email: "n2@exemplo.teste", name: "   " })),
  );
  check(
    "nome acima do limite é recusado",
    Boolean(await enviar({ email: "n3@exemplo.teste", name: "a".repeat(CONTACT_LIMITS.name + 1) })),
  );
  check("e-mail sem arroba é recusado", Boolean(await enviar({ email: "semarroba.exemplo" })));
  check("e-mail sem domínio é recusado", Boolean(await enviar({ email: "vazio@semponto" })));
  check("e-mail com espaço é recusado", Boolean(await enviar({ email: "com espaco@exemplo.teste" })));
  check(
    "e-mail acima do limite é recusado",
    Boolean(await enviar({ email: `${"a".repeat(CONTACT_LIMITS.email)}@exemplo.teste` })),
  );
  check(
    "telefone acima do limite é recusado",
    Boolean(
      await enviar({ email: "t1@exemplo.teste", phone: "9".repeat(CONTACT_LIMITS.phone + 1) }),
    ),
  );
  check(
    "mensagem vazia é recusada",
    Boolean(await enviar({ email: "m1@exemplo.teste", message: "   " })),
  );
  check(
    "mensagem acima do limite é recusada",
    Boolean(
      await enviar({
        email: "m2@exemplo.teste",
        message: "b".repeat(CONTACT_LIMITS.message + 1),
      }),
    ),
  );

  group("limites: teto de vazão por e-mail");

  const flood = "insistente@exemplo.teste";
  const respostas: (unknown | null)[] = [];
  for (let i = 0; i < CONTACT_RATE_LIMIT.max + 1; i++) {
    respostas.push(await enviar({ email: flood, message: `Tentativa ${i + 1}.` }));
  }
  check(
    `as primeiras ${CONTACT_RATE_LIMIT.max} do mesmo e-mail passam`,
    respostas.slice(0, CONTACT_RATE_LIMIT.max).every((e) => e === null),
  );
  check("a seguinte é recusada", Boolean(respostas[CONTACT_RATE_LIMIT.max]));
  check(
    "e a recusa vem com o SQLSTATE do trigger",
    codigoDe(respostas[CONTACT_RATE_LIMIT.max]) === CONTACT_RATE_LIMIT_SQLSTATE,
    `code=${codigoDe(respostas[CONTACT_RATE_LIMIT.max])}`,
  );

  // O formulário mostra a mensagem de "aguarde" só para o código do trigger.
  // Se um erro de tamanho viesse com o mesmo código, ele diria ao visitante
  // para esperar quando o problema é o texto que ele escreveu.
  const erroDeTamanho = await enviar({
    email: "codigo@exemplo.teste",
    message: "b".repeat(CONTACT_LIMITS.message + 1),
  });
  // Que os dois códigos sejam distintos não precisa de verificação em runtime:
  // são tipos literais, e o `tsc` recusa compilar se alguém os igualar.
  check(
    "violação de CHECK usa outro SQLSTATE",
    codigoDe(erroDeTamanho) === CONTACT_CHECK_SQLSTATE,
    `code=${codigoDe(erroDeTamanho)}`,
  );
  check(
    "maiúsculas não burlam a contagem",
    Boolean(await enviar({ email: flood.toUpperCase(), message: "Mesma pessoa, outro caixa." })),
  );
  check(
    "espaço em volta do e-mail não burla a contagem",
    Boolean(await enviar({ email: `  ${flood}  `, message: "Mesma pessoa, com espaço." })),
  );
  check(
    "outro remetente não é afetado",
    (await enviar({ email: "outro@exemplo.teste" })) === null,
  );
  check(
    "mensagem antiga do seed não conta para a janela",
    // O seed tem mensagens de 45 min a 40 dias atrás; se a janela as contasse,
    // o remetente mais antigo já entraria bloqueado.
    (await enviar({ email: "rafael.moreira@exemplo.teste", message: "Voltei depois." })) === null,
  );

  group("limites: a caixa de entrada não regrediu");

  await login(MOCK_SUPER_ADMIN_EMAIL);
  const { linhas: apos, error: erroApos } = await lerMensagens();
  check("o super_admin continua lendo depois de tudo isso", !erroApos && apos.length > 0);
  check(
    "nenhuma mensagem recusada foi gravada",
    !apos.some((m) => String(m.name).trim() === "" || String(m.message).trim() === ""),
  );
  await logout();
}

/* ══════════════ 3. a tela ══════════════ */

function testeTela() {
  group("tela /admin/mensagens: guarda o papel");

  const codigo = lerArquivo(TELA);

  check("registra a rota /admin/mensagens", codigo.includes('createFileRoute("/admin/mensagens")'));
  check("verifica has_role com super_admin", /has_role[\s\S]{0,120}super_admin/.test(codigo));
  check(
    "sem sessão, manda para o login",
    /if\s*\(!user\)/.test(codigo) && codigo.includes('to: "/login"'),
  );
  check(
    "não consulta enquanto o papel não foi confirmado",
    /if\s*\(!allowed\)\s*return;/.test(codigo),
  );
  check("renderiza 'Acesso negado' para quem não é super_admin", codigo.includes("Acesso negado"));
  check(
    "falha ao verificar o papel não vira 'Acesso negado'",
    /setRoleError\(true\)/.test(codigo) && codigo.includes("Não foi possível verificar seu acesso"),
  );
  check(
    "a falha de verificação oferece nova tentativa",
    codigo.includes("Tentar novamente") && /setRoleAttempt\(\(n\) => n \+ 1\)/.test(codigo),
  );
  // O ramo de erro precisa vir ANTES do spinner: com `roleError`, `allowed`
  // continua `null`, então o spinner o engoliria e a tela carregaria para sempre.
  const posErro = codigo.indexOf("if (roleError) {");
  const posSpinner = codigo.indexOf("if (authLoading || allowed === null)");
  check(
    "a falha de verificação não deixa o spinner girando",
    posErro > 0 && posSpinner > posErro,
    `roleError@${posErro} / spinner@${posSpinner}`,
  );
  check(
    "não é indexável por buscador",
    /robots[\s\S]{0,60}noindex/.test(codigo),
  );

  group("tela /admin/mensagens: consulta e estados");

  check(
    "seleciona colunas explícitas (sem select *)",
    codigo.includes('"id, name, email, phone, message, created_at"') && !codigo.includes('select("*")'),
  );
  check("ordena da mais recente para a mais antiga", /ascending:\s*false/.test(codigo));
  check(
    "limita o volume da consulta",
    /const LIMITE_CONSULTA = \d+;/.test(codigo) && /\.limit\(LIMITE_CONSULTA\)/.test(codigo),
  );
  check(
    "sinaliza que a consulta pode ter truncado o total",
    /rows\.length >= LIMITE_CONSULTA/.test(codigo) && /truncado \? "\+" : ""/.test(codigo),
  );
  check("tem estado de carregamento", codigo.includes("Skeleton"));
  check("tem estado de lista vazia", codigo.includes("Nenhuma mensagem"));
  check(
    "reporta erro de consulta em vez de engolir",
    codigo.includes("logTechnicalError") && codigo.includes("toast.error"),
  );
  check(
    "erro de consulta não deixa dado velho na tela",
    /setRows\(\[\]\)/.test(codigo),
  );
  check(
    "resposta atrasada de outro período não sobrescreve a atual",
    /let cancelled = false;[\s\S]{0,900}if \(cancelled\) return;[\s\S]{0,600}cancelled = true;/.test(codigo),
  );

  group("tela /admin/mensagens: uso");

  check("permite responder por e-mail", codigo.includes("mailto:"));
  check("oferece WhatsApp quando há telefone", codigo.includes("whatsappUrl"));
  check("formata o telefone para leitura", codigo.includes("displayBRPhone"));
  check("tem busca por texto", codigo.includes("Buscar por nome"));
  check(
    "a busca cobre nome, e-mail, telefone e mensagem",
    /\[r\.name,\s*r\.email,\s*r\.phone[^\]]*,\s*r\.message\]/.test(codigo),
  );
  check("link externo do WhatsApp usa rel seguro", codigo.includes('rel="noopener noreferrer"'));
  check(
    "o card de contagem acompanha a busca",
    /const contagem = buscaAtiva \? filtradas\.length : rows\.length;/.test(codigo),
  );
  check(
    "o e-mail vai codificado para o link de resposta",
    codigo.includes("mailto:${encodeURIComponent(m.email)}") && !/mailto:\$\{m\.email\}/.test(codigo),
  );

  group("painel do super admin");

  const painel = lerArquivo(PAINEL);
  check("o painel leva até as mensagens", painel.includes('to="/admin/mensagens"'));
  check("o link continua ao lado do de churn", painel.includes('to="/admin/churn"'));
}

/* ══════════════ 3b. telefone digitado à mão ══════════════ */

/**
 * O telefone de `contact_submissions` vem como o visitante digitou — o campo é
 * livre e o banco não valida. As duas funções de `lib/phone` assumiam Brasil
 * sempre; aqui se verifica que número estrangeiro não ganha máscara BR nem
 * link do WhatsApp, e que os números brasileiros continuam funcionando.
 */
function testeTelefone() {
  group("telefone: número brasileiro continua funcionando");

  check("celular com DDD e nono dígito é aceito", isPlausibleBRPhone("11987650001"));
  check("celular já com o 55 na frente é aceito", isPlausibleBRPhone("5511987650001"));
  check("fixo de 10 dígitos é aceito", isPlausibleBRPhone("1132650001"));
  check("celular vira máscara BR", displayBRPhone("11987650001") === "(11) 98765-0001");
  check(
    "celular vira link do WhatsApp com 55",
    whatsappUrl("11987650001") === "https://wa.me/5511987650001",
  );
  check(
    "número já normalizado não ganha 55 duplicado",
    whatsappUrl("5511987650001") === "https://wa.me/5511987650001",
  );

  group("telefone: número que não pode ser brasileiro");

  // 11 dígitos, mas o terceiro não é 9: não é celular brasileiro.
  check("número dos EUA não passa por brasileiro", !isPlausibleBRPhone("+1 415 555 1234"));
  check("número dos EUA não recebe máscara BR", displayBRPhone("+1 415 555 1234") === "+1 415 555 1234");
  check("número dos EUA não vira link do WhatsApp", whatsappUrl("+1 415 555 1234") === null);

  check("número de Portugal não passa por brasileiro", !isPlausibleBRPhone("+351 912 345 678"));
  check("número de Portugal não vira link do WhatsApp", whatsappUrl("+351 912 345 678") === null);

  check("DDD impossível é recusado", !isPlausibleBRPhone("0987650001"));
  check("telefone curto demais é recusado", !isPlausibleBRPhone("98765"));
  check("texto sem número é recusado", !isPlausibleBRPhone("meu whatsapp"));
  check("texto sem número sai como veio", displayBRPhone("meu whatsapp") === "meu whatsapp");
  check("campo vazio continua vazio", displayBRPhone(null) === "" && whatsappUrl(null) === null);

  group("telefone: as mensagens do seed atravessam as duas funções");

  const doSeed = getTableRows("contact_submissions")
    .map((m) => m.phone)
    .filter((p): p is string => typeof p === "string");
  check("o seed tem telefone para exercitar", doSeed.length > 0, `${doSeed.length} telefones`);
  check(
    "todo telefone do seed é brasileiro plausível",
    doSeed.every((p) => isPlausibleBRPhone(p)),
  );
  check(
    "e todos geram link do WhatsApp",
    doSeed.every((p) => whatsappUrl(p) !== null),
  );
}

/* ══════════════ 4. o formulário público não regrediu ══════════════ */

function testeFormulario() {
  group("formulário público /contato");

  const codigo = lerArquivo(FORMULARIO);

  check("continua gravando em contact_submissions", codigo.includes('from("contact_submissions")'));
  check("envia os campos que a tela lê", /name:|email:|message:/.test(codigo));
  check("não exige sessão para enviar", !/if\s*\(!user\)\s*return/.test(codigo));
  check("não tenta ler as mensagens de volta", !/contact_submissions"\)[\s\S]{0,80}\.select/.test(codigo));

  group("formulário público: recusa por limite de envio");

  check(
    "conhece o SQLSTATE do trigger de vazão",
    new RegExp(`RATE_LIMIT_SQLSTATE = "${CONTACT_RATE_LIMIT_SQLSTATE}"`).test(codigo),
  );
  check(
    "ramifica pelo código do erro, não pelo texto da mensagem",
    /code === RATE_LIMIT_SQLSTATE/.test(codigo),
  );
  check(
    "diz ao visitante para aguardar, em vez de repetir",
    /Você já enviou várias mensagens recentemente/.test(codigo),
  );
  check(
    "mantém o erro genérico para qualquer outro caso",
    codigo.includes("Erro ao enviar mensagem. Tente novamente."),
  );
  check(
    "o sucesso do envio não mudou",
    codigo.includes("setSubmitted(true)") && codigo.includes("Mensagem enviada com sucesso!"),
  );
}

/* ══════════════ 5. paridade com a migration ══════════════ */

function testeMigration() {
  group("migration: policies de contact_submissions");

  const sql = readFileSync(MIGRATION, "utf8");
  const executavel = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  check("RLS está habilitada na tabela", /ENABLE ROW LEVEL SECURITY/i.test(executavel));
  check(
    "INSERT liberado para anon e authenticated",
    /FOR INSERT[\s\S]{0,80}TO anon,\s*authenticated/i.test(executavel),
  );
  check(
    "SELECT restrito a super_admin",
    /FOR SELECT[\s\S]{0,120}has_role\(auth\.uid\(\),\s*'super_admin'\)/i.test(executavel),
  );
  check("SELECT é só para authenticated", /FOR SELECT[\s\S]{0,60}TO authenticated/i.test(executavel));
  check("não existe policy de UPDATE", !/FOR UPDATE/i.test(executavel));
  check("não existe policy de DELETE", !/FOR DELETE/i.test(executavel));

  group("migration: grants da Data API");

  const grants = readFileSync(GRANTS, "utf8");
  check(
    "anon recebe apenas INSERT",
    /GRANT INSERT ON TABLE public\.contact_submissions TO anon;/.test(grants),
  );
  check(
    "authenticated recebe SELECT e INSERT",
    /GRANT SELECT, INSERT ON TABLE public\.contact_submissions TO authenticated;/.test(grants),
  );
  check(
    "anon não recebe SELECT na tabela",
    !/GRANT[^;]*SELECT[^;]*contact_submissions[^;]*TO anon/.test(grants),
  );

  group("migration: limites de conteúdo e vazão");

  const limites = readFileSync(LIMITES, "utf8");

  check(
    "cinco CHECK constraints, todas NOT VALID",
    (limites.match(/ADD CONSTRAINT contact_submissions_\w+\s+CHECK/g) ?? []).length === 5 &&
      (limites.match(/NOT VALID;/g) ?? []).length === 5,
  );
  check(
    "nome entre 1 e o limite do formulário",
    /contact_submissions_name_length[\s\S]{0,120}char_length\(btrim\(name\)\) BETWEEN 1 AND 100/.test(limites),
  );
  check(
    "e-mail com teto de tamanho",
    /contact_submissions_email_length[\s\S]{0,120}char_length\(btrim\(email\)\) BETWEEN 1 AND 255/.test(limites),
  );
  check(
    "e-mail com o mesmo formato do formulário",
    /contact_submissions_email_format[\s\S]{0,160}btrim\(email\) ~ '\^\[\^\[:space:\]@\]\+@/.test(limites),
  );
  check(
    "telefone opcional, com teto quando vem",
    /contact_submissions_phone_length[\s\S]{0,160}phone IS NULL OR char_length\(btrim\(phone\)\) BETWEEN 1 AND 20/.test(limites),
  );
  check(
    "mensagem entre 1 e o limite do formulário",
    /contact_submissions_message_length[\s\S]{0,140}char_length\(btrim\(message\)\) BETWEEN 1 AND 2000/.test(limites),
  );

  check(
    "trigger de vazão é BEFORE INSERT por linha",
    /CREATE TRIGGER contact_submissions_rate_limit[\s\S]{0,160}BEFORE INSERT ON public\.contact_submissions[\s\S]{0,80}FOR EACH ROW/.test(limites),
  );
  check(
    "a função do trigger é SECURITY DEFINER",
    /CREATE OR REPLACE FUNCTION public\.enforce_contact_submission_rate_limit\(\)[\s\S]{0,200}SECURITY DEFINER/.test(limites),
  );
  check(
    "e fixa o search_path",
    /enforce_contact_submission_rate_limit[\s\S]{0,240}SET search_path TO 'public'/.test(limites),
  );
  check(
    "a contagem normaliza o e-mail",
    /lower\(btrim\(c\.email\)\) = lower\(btrim\(NEW\.email\)\)/.test(limites),
  );
  check(
    "há índice para a contagem do trigger",
    /CREATE INDEX IF NOT EXISTS contact_submissions_email_recent_idx[\s\S]{0,140}lower\(btrim\(email\)\), created_at DESC/.test(limites),
  );
  check("documenta rollback conceitual", /ROLLBACK CONCEITUAL/.test(limites));
  check("documenta as verificações após aplicar", /VERIFICAÇÕES APÓS APLICAR/.test(limites));

  group("paridade entre mock e SQL");

  /* ---- os números do mock são os do .sql, não parecidos com eles ---- */

  const numeroDe = (re: RegExp): number | null => {
    const m = limites.match(re);
    return m ? Number(m[1]) : null;
  };

  check(
    "limite de nome idêntico nos dois lados",
    numeroDe(/btrim\(name\)\) BETWEEN 1 AND (\d+)/) === CONTACT_LIMITS.name,
    `sql=${numeroDe(/btrim\(name\)\) BETWEEN 1 AND (\d+)/)} mock=${CONTACT_LIMITS.name}`,
  );
  check(
    "limite de e-mail idêntico nos dois lados",
    numeroDe(/btrim\(email\)\) BETWEEN 1 AND (\d+)/) === CONTACT_LIMITS.email,
    `sql=${numeroDe(/btrim\(email\)\) BETWEEN 1 AND (\d+)/)} mock=${CONTACT_LIMITS.email}`,
  );
  check(
    "limite de telefone idêntico nos dois lados",
    numeroDe(/btrim\(phone\)\) BETWEEN 1 AND (\d+)/) === CONTACT_LIMITS.phone,
    `sql=${numeroDe(/btrim\(phone\)\) BETWEEN 1 AND (\d+)/)} mock=${CONTACT_LIMITS.phone}`,
  );
  check(
    "limite de mensagem idêntico nos dois lados",
    numeroDe(/btrim\(message\)\) BETWEEN 1 AND (\d+)/) === CONTACT_LIMITS.message,
    `sql=${numeroDe(/btrim\(message\)\) BETWEEN 1 AND (\d+)/)} mock=${CONTACT_LIMITS.message}`,
  );
  check(
    "teto de vazão idêntico nos dois lados",
    numeroDe(/teto\s+CONSTANT integer\s+:= (\d+);/) === CONTACT_RATE_LIMIT.max,
    `sql=${numeroDe(/teto\s+CONSTANT integer\s+:= (\d+);/)} mock=${CONTACT_RATE_LIMIT.max}`,
  );
  check(
    "janela de vazão idêntica nos dois lados",
    numeroDe(/janela\s+CONSTANT interval\s+:= interval '(\d+) minutes';/) ===
      CONTACT_RATE_LIMIT.windowMinutes,
    `sql=${numeroDe(/janela\s+CONSTANT interval\s+:= interval '(\d+) minutes';/)} mock=${CONTACT_RATE_LIMIT.windowMinutes}`,
  );

  /* ---- e os do formulário são os mesmos que os do banco ---- */

  const formulario = lerArquivo(FORMULARIO);
  check(
    "o SQLSTATE do trigger é o mesmo nos três lados",
    /USING ERRCODE = 'P0001'/.test(limites) &&
      CONTACT_RATE_LIMIT_SQLSTATE === "P0001" &&
      lerArquivo(FORMULARIO).includes('RATE_LIMIT_SQLSTATE = "P0001"'),
  );

  check(
    "o formulário usa exatamente os mesmos limites",
    formulario.includes(`form.name.length > ${CONTACT_LIMITS.name}`) &&
      formulario.includes(`form.email.length > ${CONTACT_LIMITS.email}`) &&
      formulario.includes(`form.message.length > ${CONTACT_LIMITS.message}`) &&
      formulario.includes(`maxLength={${CONTACT_LIMITS.phone}}`),
  );


  const regras = lerArquivo("src/mocks/rules.ts");
  check("o mock filtra a leitura da tabela", regras.includes('table === "contact_submissions"'));
  check("o mock cita a migration correspondente", regras.includes("20260416012649"));
  check(
    "o mock nega update e delete",
    /Mensagens de contato não podem ser alteradas nem removidas/.test(regras),
  );
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  resetMockDatabase();

  await testeLeitura();
  await testeEscrita();
  await testeLimites();
  testeTela();
  testeTelefone();
  testeFormulario();
  testeMigration();

  await logout();

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
