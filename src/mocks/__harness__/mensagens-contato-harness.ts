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
    "não é indexável por buscador",
    /robots[\s\S]{0,60}noindex/.test(codigo),
  );

  group("tela /admin/mensagens: consulta e estados");

  check(
    "seleciona colunas explícitas (sem select *)",
    codigo.includes('"id, name, email, phone, message, created_at"') && !codigo.includes('select("*")'),
  );
  check("ordena da mais recente para a mais antiga", /ascending:\s*false/.test(codigo));
  check("limita o volume da consulta", /\.limit\(\d+\)/.test(codigo));
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

  group("painel do super admin");

  const painel = lerArquivo(PAINEL);
  check("o painel leva até as mensagens", painel.includes('to="/admin/mensagens"'));
  check("o link continua ao lado do de churn", painel.includes('to="/admin/churn"'));
}

/* ══════════════ 4. o formulário público não regrediu ══════════════ */

function testeFormulario() {
  group("formulário público /contato");

  const codigo = lerArquivo(FORMULARIO);

  check("continua gravando em contact_submissions", codigo.includes('from("contact_submissions")'));
  check("envia os campos que a tela lê", /name:|email:|message:/.test(codigo));
  check("não exige sessão para enviar", !/if\s*\(!user\)\s*return/.test(codigo));
  check("não tenta ler as mensagens de volta", !/contact_submissions"\)[\s\S]{0,80}\.select/.test(codigo));
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

  group("paridade entre mock e SQL");

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
  testeTela();
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
