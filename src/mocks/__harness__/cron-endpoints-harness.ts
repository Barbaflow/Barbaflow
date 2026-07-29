/**
 * Harness das rotas de cron (`/hooks/*`).
 *
 * Estas duas rotas rodam com a chave administrativa e agem sobre todos os
 * tenants — uma zera o contador mensal de todas as barbearias, a outra apaga
 * contas de usuário. Antes desta correção, ambas eram acionáveis por qualquer
 * um: a primeira aceitava QUALQUER header `authorization` (ou `lovable-context`),
 * a segunda autorizava pela chave publicável, que vai no bundle do navegador.
 *
 * A verificação tem duas frentes:
 *
 *   1. comportamento — `authorizeCronRequest` com ambiente injetado, cobrindo
 *      os bypasses antigos como casos de teste explícitos;
 *   2. código — os handlers chamam a autorização ANTES de qualquer consulta,
 *      e o segredo não vaza para o bundle (nada de prefixo VITE_).
 *
 * A frente 2 é análise estática dos arquivos de rota. Não substitui um teste
 * de integração com o servidor de pé; é o que impede a ordem das instruções de
 * regredir silenciosamente — que é exatamente a falha original.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  authorizeCronRequest,
  compararSegredos,
  extrairBearer,
  lerCronSecret,
  MIN_CRON_SECRET_LENGTH,
} from "@/lib/cron-auth.server";

const ROOT = process.cwd();

/**
 * Montado por concatenação de propósito. O harness de erros varre o código-fonte
 * atrás de `VITE_*SECRET` — escrever a literal aqui faria ESTE arquivo ser
 * acusado, justamente por testar que o nome proibido não existe.
 */
const NOME_PROIBIDO = "VITE_" + "CRON_SECRET";

const DIR_HOOKS = "src/routes/hooks";
const ROTA_RESET = `${DIR_HOOKS}/reset-monthly-appointments.ts`;
const ROTA_DELECOES = `${DIR_HOOKS}/process-account-deletions.ts`;
const MODULO_AUTH = "src/lib/cron-auth.server.ts";

/** Segredo fictício com tamanho válido, usado como "o segredo certo". */
const SEGREDO = "s".repeat(MIN_CRON_SECRET_LENGTH + 8);
/** Valores públicos que NÃO podem servir de credencial. */
const PUBLISHABLE = "sb_publishable_" + "p".repeat(40);
const SERVICE_ROLE = "sb_secret_" + "x".repeat(40);

/** Ambiente bem configurado: segredo próprio, distinto de qualquer chave. */
const ENV_OK = {
  CRON_SECRET: SEGREDO,
  SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  SUPABASE_ANON_KEY: PUBLISHABLE,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
  SUPABASE_SECRET_KEY: SERVICE_ROLE,
};

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
 * Os casos de configuração inválida logam no servidor de propósito. Aqui o log
 * é capturado em vez de impresso: mantém o relatório legível e ainda permite
 * verificar que o diagnóstico existe e não carrega o valor do segredo.
 */
const logsDeErro: string[] = [];
const consoleErrorOriginal = console.error;

function capturarLogs() {
  console.error = (...args: unknown[]) => {
    logsDeErro.push(args.map(String).join(" "));
  };
}

function restaurarLogs() {
  console.error = consoleErrorOriginal;
}

/** Monta uma requisição com os headers dados. */
function req(headers: Record<string, string> = {}): Request {
  return new Request("https://exemplo.test/hooks/qualquer", { method: "POST", headers });
}

/** Roda a autorização e devolve o status resultante (200 quando autorizado). */
function status(headers: Record<string, string>, env: Record<string, string | undefined> = ENV_OK) {
  const r = authorizeCronRequest(req(headers), env);
  return r.ok ? 200 : r.response.status;
}

async function corpo(headers: Record<string, string>, env: Record<string, string | undefined> = ENV_OK) {
  const r = authorizeCronRequest(req(headers), env);
  if (r.ok) return null;
  return (await r.response.json()) as { error?: string };
}

const BEARER_OK = { authorization: `Bearer ${SEGREDO}` };

/* ══════════════ 1. o segredo tem de existir e ser um segredo ══════════════ */

function testeConfiguracao() {
  group("configuração do segredo: falha fechado");

  check("sem CRON_SECRET no ambiente → 500", status(BEARER_OK, {}) === 500);
  check("CRON_SECRET vazio → 500", status(BEARER_OK, { CRON_SECRET: "" }) === 500);
  check("CRON_SECRET só com espaços → 500", status(BEARER_OK, { CRON_SECRET: "     " }) === 500);
  check(
    `CRON_SECRET com menos de ${MIN_CRON_SECRET_LENGTH} caracteres → 500`,
    status({ authorization: "Bearer curto" }, { CRON_SECRET: "curto" }) === 500,
  );
  check(
    "segredo mal configurado não vira 200 nem com header vazio",
    status({}, {}) === 500,
  );

  group("configuração do segredo: recusa chaves do Supabase");

  const casos: [string, Record<string, string>][] = [
    ["publishable key", { CRON_SECRET: PUBLISHABLE, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE }],
    ["anon key", { CRON_SECRET: PUBLISHABLE, SUPABASE_ANON_KEY: PUBLISHABLE }],
    [
      "VITE_SUPABASE_PUBLISHABLE_KEY (a que vai no bundle)",
      { CRON_SECRET: PUBLISHABLE, VITE_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE },
    ],
    ["service_role", { CRON_SECRET: SERVICE_ROLE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE }],
    ["secret key", { CRON_SECRET: SERVICE_ROLE, SUPABASE_SECRET_KEY: SERVICE_ROLE }],
  ];

  for (const [nome, env] of casos) {
    const secret = env.CRON_SECRET;
    check(
      `CRON_SECRET igual à ${nome} → 500`,
      status({ authorization: `Bearer ${secret}` }, env) === 500,
    );
  }

  check(
    "segredo próprio, distinto das chaves → configuração aceita",
    lerCronSecret(ENV_OK).secret === SEGREDO,
  );
  check("motivo da recusa é reportado", Boolean(lerCronSecret({}).motivo));
}

/* ══════════════ 2. o chamador tem de apresentar o segredo ══════════════ */

async function testeAutorizacao() {
  group("autorização: recusa quem não tem o segredo");

  check("sem header algum → 401", status({}) === 401);
  check("Authorization vazio → 401", status({ authorization: "" }) === 401);
  check("Authorization só 'Bearer' → 401", status({ authorization: "Bearer" }) === 401);
  check("Authorization 'Bearer   ' → 401", status({ authorization: "Bearer   " }) === 401);
  check(
    "token sem o esquema Bearer → 401",
    status({ authorization: SEGREDO }) === 401,
  );
  check(
    "esquema diferente (Basic) → 401",
    status({ authorization: `Basic ${SEGREDO}` }) === 401,
  );
  check("token errado → 401", status({ authorization: "Bearer " + "z".repeat(40) }) === 401);
  check(
    "prefixo correto do segredo não passa",
    status({ authorization: `Bearer ${SEGREDO.slice(0, -1)}` }) === 401,
  );
  check(
    "segredo com sufixo extra não passa",
    status({ authorization: `Bearer ${SEGREDO}x` }) === 401,
  );

  group("autorização: os bypasses antigos continuam fechados");

  check(
    "header lovable-context sozinho → 401 (bypass da rota de reset)",
    status({ "lovable-context": "qualquer-coisa" }) === 401,
  );
  check(
    "lovable-context junto com Bearer errado → 401",
    status({ "lovable-context": "x", authorization: "Bearer errado" }) === 401,
  );
  check(
    "Authorization arbitrário → 401 (antes bastava existir)",
    status({ authorization: "Bearer qualquer-valor" }) === 401,
  );
  check(
    "publishable key como token → 401 (era o segredo da rota de deleções)",
    status({ authorization: `Bearer ${PUBLISHABLE}` }) === 401,
  );
  check(
    "service_role como token → 401",
    status({ authorization: `Bearer ${SERVICE_ROLE}` }) === 401,
  );

  group("autorização: aceita o cron legítimo");

  check("Bearer com o segredo correto → autorizado", status(BEARER_OK) === 200);
  check(
    "espaços em volta do header são tolerados",
    status({ authorization: `  Bearer   ${SEGREDO}  ` }) === 200,
  );

  group("autorização: a resposta não vaza informação");

  const naoAutorizado = await corpo({});
  check("401 responde apenas 'unauthorized'", naoAutorizado?.error === "unauthorized");

  const malConfigurado = await corpo(BEARER_OK, {});
  check(
    "500 responde apenas 'server_misconfigured'",
    malConfigurado?.error === "server_misconfigured",
  );
  check(
    "nenhuma resposta contém o segredo",
    !JSON.stringify(naoAutorizado).includes(SEGREDO) &&
      !JSON.stringify(malConfigurado).includes(SEGREDO),
  );
}

/* ══════════════ 3. primitivas ══════════════ */

function testePrimitivas() {
  group("comparação de segredos");

  check("strings iguais", compararSegredos(SEGREDO, SEGREDO));
  check("mesmo tamanho, conteúdo diferente", !compararSegredos("abcd", "abce"));
  check("tamanhos diferentes", !compararSegredos("abc", "abcd"));
  check("prefixo não passa", !compararSegredos("abc", "abcdef"));
  check("string vazia contra segredo", !compararSegredos("", SEGREDO));
  check("duas vazias", compararSegredos("", ""));
  check("caractere unicode distinto", !compararSegredos("aça", "aca"));

  group("extração do Bearer");

  check("formato canônico", extrairBearer(`Bearer ${SEGREDO}`) === SEGREDO);
  check("múltiplos espaços", extrairBearer(`Bearer    ${SEGREDO}`) === SEGREDO);
  check("null vira null", extrairBearer(null) === null);
  check("string vazia vira null", extrairBearer("") === null);
  check("sem esquema vira null", extrairBearer(SEGREDO) === null);
  check("esquema em minúsculas não é aceito", extrairBearer(`bearer ${SEGREDO}`) === null);
}

/* ══════════════ 4. os handlers autorizam antes de qualquer consulta ══════════════ */

/** Recorta o corpo do handler POST, ignorando imports e comentários de topo. */
function corpoDoHandler(codigo: string): string {
  const i = codigo.indexOf("POST: async");
  return i === -1 ? "" : codigo.slice(i);
}

/** Posição da primeira ocorrência de qualquer um dos padrões, ou Infinity. */
function primeiraOcorrencia(texto: string, padroes: RegExp[]): number {
  let menor = Infinity;
  for (const p of padroes) {
    const m = p.exec(texto);
    if (m && m.index < menor) menor = m.index;
  }
  return menor;
}

/** Tudo que só pode acontecer depois de autorizado. */
const EFEITOS = [
  /supabaseAdmin/,
  /createClient\s*\(/,
  /\.from\s*\(/,
  /process\.env\.SUPABASE_SERVICE_ROLE_KEY/,
  /request\.json\s*\(/,
  /auth\.admin/,
];

/** Veredito da análise estática de um arquivo de rota. */
type Analise = {
  importaAuth: boolean;
  handlerLocalizado: boolean;
  chamaAuth: boolean;
  propagaRecusa: boolean;
  autorizaAntesDeAgir: boolean;
  semLovableContext: boolean;
  semChavePublicaComoToken: boolean;
};

function analisarRota(codigo: string): Analise {
  const handler = corpoDoHandler(codigo);
  const iAuth = handler.indexOf("authorizeCronRequest(request");
  const iEfeito = primeiraOcorrencia(handler, EFEITOS);

  return {
    importaAuth: codigo.includes('from "@/lib/cron-auth.server"'),
    handlerLocalizado: handler.length > 0,
    chamaAuth: iAuth !== -1,
    propagaRecusa: /if\s*\(!\s*auth\.ok\)\s*return\s+auth\.response/.test(handler),
    autorizaAntesDeAgir: iAuth !== -1 && iAuth < iEfeito,
    semLovableContext: !codigo.includes("lovable-context"),
    semChavePublicaComoToken: !/SUPABASE_ANON_KEY|SUPABASE_PUBLISHABLE_KEY/.test(codigo),
  };
}

function testeOrdemDosHandlers() {
  for (const [nome, rel] of [
    ["reset-monthly-appointments", ROTA_RESET],
    ["process-account-deletions", ROTA_DELECOES],
  ] as const) {
    group(`handler ${nome}`);

    const a = analisarRota(lerArquivo(rel));

    check("importa a autorização de cron", a.importaAuth);
    check("handler POST foi localizado", a.handlerLocalizado);
    check("chama authorizeCronRequest(request)", a.chamaAuth);
    check("retorna a resposta da autorização quando ela recusa", a.propagaRecusa);
    check("nenhuma consulta ou leitura de segredo antes da autorização", a.autorizaAntesDeAgir);
    check("não usa lovable-context como prova de origem", a.semLovableContext);
    check("não compara o token com a publishable/anon key", a.semChavePublicaComoToken);
  }
}

/* ══════════════ 4b. o detector realmente detecta ══════════════ */

/**
 * Os dois trechos abaixo são o código como estava ANTES da correção. Passá-los
 * pelo mesmo analisador prova que os checks acima reprovariam a regressão, em
 * vez de apenas registrarem "verde" contra um arquivo que já está certo.
 */
const VULNERAVEL_RESET = `
      POST: async ({ request }) => {
        const lovableContext = request.headers.get("lovable-context");
        const authHeader = request.headers.get("authorization");
        if (!lovableContext && !authHeader) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        const { error } = await supabaseAdmin.from("barbershops").update({});
      },
`;

const VULNERAVEL_DELECOES = `
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace("Bearer ", "");
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (token !== process.env.SUPABASE_ANON_KEY && token !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        const admin = createClient(url, serviceKey);
      },
`;

/** Correto no conteúdo, mas autorizando tarde demais — o erro sutil. */
const VULNERAVEL_ORDEM = `
      POST: async ({ request }) => {
        const { data } = await supabaseAdmin.from("barbershops").select("id");
        const auth = authorizeCronRequest(request);
        if (!auth.ok) return auth.response;
      },
`;

function testeDetector() {
  group("o analisador reprova o código vulnerável");

  const reset = analisarRota(VULNERAVEL_RESET);
  check("reset original: acusa falta da autorização", !reset.chamaAuth);
  check("reset original: acusa uso de lovable-context", !reset.semLovableContext);

  const delecoes = analisarRota(VULNERAVEL_DELECOES);
  check("deleções original: acusa falta da autorização", !delecoes.chamaAuth);
  check(
    "deleções original: acusa a chave pública como token",
    !delecoes.semChavePublicaComoToken,
  );

  const ordem = analisarRota(VULNERAVEL_ORDEM);
  check("autorização tardia: a chamada existe", ordem.chamaAuth);
  check("autorização tardia: mesmo assim é reprovada", !ordem.autorizaAntesDeAgir);
}

/* ══════════════ 5. o segredo não pode vazar para o bundle ══════════════ */

function testeVazamento() {
  /* ---- varredura: vale para TODA rota de /hooks, não só as duas ---- */

  group("varredura de src/routes/hooks");

  // Conferir as duas rotas conhecidas por nome não protege a terceira, criada
  // depois. A varredura lê o diretório: qualquer arquivo novo entra no teste
  // sozinho, e nasce reprovado se repetir a falha original.
  const arquivosHooks = readdirSync(path.join(ROOT, DIR_HOOKS))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .sort();

  check(
    "o diretório de hooks foi encontrado e não está vazio",
    arquivosHooks.length >= 2,
    arquivosHooks.join(", "),
  );
  check(
    "as duas rotas conhecidas estão entre as varridas",
    arquivosHooks.includes("reset-monthly-appointments.ts") &&
      arquivosHooks.includes("process-account-deletions.ts"),
  );

  for (const arquivo of arquivosHooks) {
    const codigo = lerArquivo(`${DIR_HOOKS}/${arquivo}`);
    const a = analisarRota(codigo);

    check(`${arquivo}: autoriza pelo segredo próprio`, a.importaAuth && a.chamaAuth);
    check(`${arquivo}: autoriza antes de qualquer efeito`, a.autorizaAntesDeAgir);
    check(
      `${arquivo}: não aceita chave pública como credencial`,
      a.semChavePublicaComoToken,
    );
    check(`${arquivo}: não usa header arbitrário como prova`, a.semLovableContext);
    check(
      `${arquivo}: não embute o segredo no bundle`,
      !codigo.includes(NOME_PROIBIDO) && !codigo.includes("import.meta.env"),
    );
  }

  group("o segredo fica no servidor");

  const modulo = lerArquivo(MODULO_AUTH);

  check(
    "módulo de autorização não lê import.meta.env",
    !modulo.includes("import.meta.env"),
  );
  check("nome do módulo marca o escopo servidor", MODULO_AUTH.endsWith(".server.ts"));
  check(
    "a variável não tem prefixo VITE_ em lugar nenhum do código",
    !(modulo + lerArquivo(ROTA_RESET) + lerArquivo(ROTA_DELECOES)).includes(NOME_PROIBIDO),
  );
  check(
    `o mínimo de ${MIN_CRON_SECRET_LENGTH} caracteres é aplicado`,
    MIN_CRON_SECRET_LENGTH >= 32 && lerCronSecret({ CRON_SECRET: "a".repeat(31) }).secret === null,
  );

  group("a comparação é de tempo constante, e não improvisada");

  check(
    "usa timingSafeEqual em vez de comparação própria",
    /import \{[^}]*timingSafeEqual[^}]*\} from "node:crypto"/.test(modulo) &&
      /return timingSafeEqual\(/.test(modulo),
  );
  check(
    "iguala o tamanho por digest antes de comparar",
    /createHash\("sha256"\)/.test(modulo) && (modulo.match(/createHash\("sha256"\)/g) ?? []).length === 2,
  );
  check(
    "não compara o segredo com === nem com includes",
    !/token\s*===\s*secret|secret\s*===\s*token|secret\.includes\(/.test(modulo),
  );

  // O ponto que a comparação por digest resolve: qualquer que seja o tamanho do
  // palpite, o número de bytes comparados é o mesmo. Aqui só se verifica o
  // resultado — tempo não se mede de forma confiável num harness —, mas
  // nenhuma destas entradas pode passar nem lançar.
  const palpites = ["", "a", "b".repeat(31), "c".repeat(4096), SEGREDO.slice(0, -1), SEGREDO + "x"];
  check(
    "palpite de qualquer tamanho é recusado sem lançar",
    palpites.every((p) => {
      try {
        return compararSegredos(p, SEGREDO) === false;
      } catch {
        return false;
      }
    }),
  );

  group("a variável está documentada");

  const exemplo = lerArquivo(".env.example");
  check("CRON_SECRET aparece no .env.example", /^CRON_SECRET=/m.test(exemplo));
  check(
    "documentado fora da seção do frontend (sem prefixo VITE_)",
    !exemplo.includes(NOME_PROIBIDO),
  );
  check(
    "o .env.example explica o header esperado",
    /Authorization:\s*Bearer\s*<CRON_SECRET>/.test(exemplo),
  );
}

/* ────────────────────────────── runner ────────────────────────────── */

export async function runHarness() {
  capturarLogs();
  try {
    testeConfiguracao();
    await testeAutorizacao();
  } finally {
    restaurarLogs();
  }

  group("diagnóstico de configuração");
  check("configuração inválida é registrada no log do servidor", logsDeErro.length > 0);
  check(
    "o log não imprime o valor do segredo",
    !logsDeErro.some((l) => l.includes(SEGREDO) || l.includes(PUBLISHABLE) || l.includes(SERVICE_ROLE)),
  );

  testePrimitivas();
  testeOrdemDosHandlers();
  testeDetector();
  testeVazamento();

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
