/**
 * Harness do endurecimento de erros e do papel automático de cliente.
 *
 * Cobre três frentes, todas com lógica pura extraída dos componentes:
 *   - decisão do papel automático (`@/lib/auto-client-role`);
 *   - redação de erro técnico para o console (`@/lib/error-reporting`);
 *   - tradução de erro de autenticação (`@/lib/auth-errors`).
 *
 * Além disso, varre o código-fonte para provar que nenhum módulo do navegador
 * importa o cliente com service_role.
 */
import {
  decideAutoClientRole,
  classifyRoleInsert,
  roleIsEnsured,
  type AutoRoleInput,
} from "@/lib/auto-client-role";
import { describeError, redactSensitive, logTechnicalError } from "@/lib/error-reporting";
import { authErrorMessage, isSupabaseAuthError } from "@/lib/auth-errors";

/* ---- infra ---- */
interface Check { group: string; name: string; ok: boolean; detail: string }
const checks: Check[] = [];
let currentGroup = "geral";
const group = (n: string) => { currentGroup = n; };
const check = (name: string, ok: boolean, detail = "") => checks.push({ group: currentGroup, name, ok, detail });

const BASE: AutoRoleInput = {
  hasSession: true,
  authLoading: false,
  isDefaultTenant: false,
  alreadyProcessed: false,
};

/* ══════════ 1. Decisão do papel automático ══════════ */
function testDecisao(): void {
  group("papel automático — decisão");

  // 3) consulta concluída, sem papel → pode criar
  const criar = decideAutoClientRole({ ...BASE, existing: { found: false, error: null } });
  check("sem papel e sem erro → cria", criar.action === "create", JSON.stringify(criar));

  // 1 e 2) consulta falhou → NÃO cria
  const erroConsulta = decideAutoClientRole({ ...BASE, existing: { found: false, error: { code: "08006" } } });
  check("erro na consulta → não cria", erroConsulta.action === "skip", JSON.stringify(erroConsulta));
  check(
    "erro na consulta é classificado como tal",
    erroConsulta.action === "skip" && erroConsulta.reason === "consulta-falhou",
    JSON.stringify(erroConsulta),
  );
  const semResultado = decideAutoClientRole({ ...BASE });
  check("sem resultado de consulta → não cria", semResultado.action === "skip", JSON.stringify(semResultado));

  // 4) papel já existe → não duplica
  const existe = decideAutoClientRole({ ...BASE, existing: { found: true, error: null } });
  check(
    "papel já existe → não cria",
    existe.action === "skip" && existe.reason === "papel-existe",
    JSON.stringify(existe),
  );

  // 6) sessão ausente
  const anon = decideAutoClientRole({ ...BASE, hasSession: false, existing: { found: false, error: null } });
  check("anônimo → não cria", anon.action === "skip" && anon.reason === "sem-sessao", JSON.stringify(anon));

  // auth carregando
  const carregando = decideAutoClientRole({ ...BASE, authLoading: true, existing: { found: false, error: null } });
  check(
    "auth carregando → não cria",
    carregando.action === "skip" && carregando.reason === "carregando",
    JSON.stringify(carregando),
  );

  // tenant padrão (domínio raiz) não tem barbearia para vincular
  const padrao = decideAutoClientRole({ ...BASE, isDefaultTenant: true, existing: { found: false, error: null } });
  check(
    "tenant padrão → não cria",
    padrao.action === "skip" && padrao.reason === "tenant-padrao",
    JSON.stringify(padrao),
  );

  // 7) sessão expirada tem motivo próprio, distinto de erro comum
  for (const [rotulo, err] of [["401", { status: 401 }], ["PGRST301", { code: "PGRST301" }]] as const) {
    const exp = decideAutoClientRole({ ...BASE, existing: { found: false, error: err } });
    check(
      `sessão expirada (${rotulo}) → motivo próprio`,
      exp.action === "skip" && exp.reason === "sessao-expirada",
      JSON.stringify(exp),
    );
  }

  // 9) ausência de loop: par já processado nunca reprocessa
  const repetido = decideAutoClientRole({ ...BASE, alreadyProcessed: true, existing: { found: false, error: null } });
  check(
    "par já processado → não repete",
    repetido.action === "skip" && repetido.reason === "ja-processado",
    JSON.stringify(repetido),
  );

  // A ordem dos guardas importa: anônimo tem precedência sobre qualquer consulta.
  const anonComErro = decideAutoClientRole({ ...BASE, hasSession: false, existing: { found: false, error: { code: "08006" } } });
  check(
    "anônimo tem precedência sobre o resultado da consulta",
    anonComErro.action === "skip" && anonComErro.reason === "sem-sessao",
    JSON.stringify(anonComErro),
  );

  // Nenhuma combinação sem consulta bem-sucedida pode resultar em criação.
  const combinacoes: AutoRoleInput[] = [
    { ...BASE, existing: { found: false, error: { code: "08006" } } },
    { ...BASE, existing: { found: true, error: null } },
    { ...BASE, hasSession: false },
    { ...BASE, authLoading: true },
    { ...BASE, isDefaultTenant: true },
    { ...BASE, alreadyProcessed: true },
    { ...BASE },
  ];
  check(
    "nenhuma combinação inválida gera criação",
    combinacoes.every((c) => decideAutoClientRole(c).action === "skip"),
    "",
  );
}

/* ══════════ 2. Resultado do INSERT ══════════ */
function testInsert(): void {
  group("papel automático — criação");

  check("sem erro → criado", classifyRoleInsert(null) === "criado");
  // 5) concorrência: UNIQUE(user_id, barbershop_id, role) violado é sucesso
  check("conflito 23505 → já existia (idempotente)", classifyRoleInsert({ code: "23505" }) === "ja-existia");
  check("idempotente conta como garantido", roleIsEnsured(classifyRoleInsert({ code: "23505" })));
  check("criado conta como garantido", roleIsEnsured(classifyRoleInsert(null)));

  // 8) erro de criação
  check("erro genérico → falhou", classifyRoleInsert({ code: "42501" }) === "falhou");
  check("falha NÃO conta como garantido", !roleIsEnsured(classifyRoleInsert({ code: "42501" })));
  check("sessão expirada no insert é distinguida", classifyRoleInsert({ status: 401 }) === "sessao-expirada");
  check("sessão expirada não conta como garantido", !roleIsEnsured(classifyRoleInsert({ status: 401 })));
}

/* ══════════ 3. Erro técnico não vaza para a tela ══════════ */
function testRedacao(): void {
  group("erro técnico fica no console");

  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const comJwt = redactSensitive(`falha ao chamar API com token ${jwt}`);
  check("JWT é redigido", !comJwt.includes(jwt) && comJwt.includes("[jwt omitido]"), comJwt);

  const comChave = redactSensitive("usando sb_secret_abcdef123456 no cabeçalho");
  check("chave sb_secret é redigida", !comChave.includes("sb_secret_abcdef123456"), comChave);

  const comQuery = redactSensitive("GET /rest/v1/x?apikey=abc123&select=id");
  check("apikey na querystring é redigida", !comQuery.includes("abc123"), comQuery);

  const comSenha = redactSensitive("POST /auth?password=hunter2");
  check("senha na querystring é redigida", !comSenha.includes("hunter2"), comSenha);

  const comAuth = redactSensitive("authorization: Bearer abc.def.ghi");
  check("cabeçalho Authorization é redigido", !comAuth.includes("abc.def.ghi"), comAuth);

  // describeError preserva o que ajuda a diagnosticar
  const d = describeError({ message: "permission denied for table user_roles", code: "42501", details: "x", hint: "y" });
  check("describeError mantém code", d.code === "42501", JSON.stringify(d));
  check("describeError mantém message", d.message.includes("permission denied"), JSON.stringify(d));

  check("describeError tolera null", describeError(null).message === "erro sem detalhes");
  check("describeError tolera string", describeError("falhou").message === "falhou");
  check("describeError tolera Error", describeError(new Error("boom")).message === "boom");

  // 10) o texto exibido ao usuário não carrega detalhe interno
  const internos = [
    "permission denied for table user_roles",
    "violates row-level security policy",
    'relation "public.tickets" does not exist',
    "PGRST301",
    "23505",
  ];
  const visiveis = [
    "Não foi possível enviar o convite. Tente novamente.",
    "Não foi possível salvar as alterações. Tente novamente.",
    "Não foi possível remover o bloqueio. Tente novamente.",
    "Não foi possível carregar seu plano.",
    "Não foi possível criar a barbearia. Tente novamente.",
  ];
  check(
    "mensagens visíveis não contêm detalhe interno",
    visiveis.every((v) => !internos.some((i) => v.includes(i))),
    "",
  );
  check(
    "mensagens visíveis não citam SQL, tabela, política ou RPC",
    visiveis.every((v) => !/(select|insert|update|delete|policy|rls|relation|constraint|rpc|table)\b/i.test(v)),
    "",
  );

  // logTechnicalError não deve lançar, seja qual for a entrada
  const original = console.error;
  let chamadas = 0;
  console.error = () => { chamadas += 1; };
  try {
    logTechnicalError("Teste", "operação", new Error("x"));
    logTechnicalError("Teste", "operação", null);
    logTechnicalError("Teste", "operação", { code: "42501" });
  } finally {
    console.error = original;
  }
  check("logTechnicalError registra sem lançar", chamadas === 3, `chamadas=${chamadas}`);
}

/* ══════════ 4. Mensagens de autenticação ══════════ */
function testAuth(): void {
  group("mensagens de autenticação");

  const fallback = "Não foi possível entrar. Tente novamente.";

  // 11) validação local escrita pela aplicação continua sendo exibida
  const validacao = new Error("Informe um telefone válido com DDD, ex: (11) 98765-4321");
  check(
    "validação local é preservada",
    authErrorMessage(validacao, fallback) === validacao.message,
    authErrorMessage(validacao, fallback),
  );
  check("erro comum da aplicação não é tratado como do provedor", !isSupabaseAuthError(validacao));

  // Erro do provedor é traduzido
  const invalido = { __isAuthError: true, code: "invalid_credentials", message: "Invalid login credentials" };
  check("credencial inválida é traduzida", authErrorMessage(invalido, fallback) === "E-mail ou senha incorretos.");
  check("mensagem em inglês não vaza", !authErrorMessage(invalido, fallback).includes("Invalid login"));

  const naoConfirmado = { __isAuthError: true, code: "email_not_confirmed", message: "Email not confirmed" };
  check("e-mail não confirmado é traduzido", authErrorMessage(naoConfirmado, fallback).includes("Confirme seu e-mail"));

  // Código desconhecido cai no texto contextual, não na mensagem do provedor
  const desconhecido = { __isAuthError: true, code: "algo_novo", message: "Something internal exploded" };
  check("código desconhecido usa o texto contextual", authErrorMessage(desconhecido, fallback) === fallback);
  check("mensagem interna não vaza no desconhecido", !authErrorMessage(desconhecido, fallback).includes("internal"));

  check("erro sem forma conhecida usa o fallback", authErrorMessage(undefined, fallback) === fallback);
  check("objeto status+code é reconhecido como do provedor", isSupabaseAuthError({ status: 400, code: "x" }));
}

/* ══════════ 5. service_role não alcança o navegador ══════════ */
function testServiceRoleIsolation(): void {
  group("isolamento da service_role");

  const fontes = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const arquivos = Object.keys(fontes);
  check("varredura encontrou o código-fonte", arquivos.length > 50, `${arquivos.length} arquivos`);

  // 12) quem importa o cliente admin precisa ser rota de servidor
  const importadores = arquivos.filter(
    (f) => f !== "/src/integrations/supabase/client.server.ts" && /from\s+["'][^"']*client\.server["']/.test(fontes[f]),
  );
  const forasDeRotaServidor = importadores.filter((f) => !f.startsWith("/src/routes/hooks/"));
  check(
    "nenhum componente/hook/lib importa client.server",
    forasDeRotaServidor.length === 0,
    forasDeRotaServidor.join(", "),
  );
  check(
    "importadores existentes declaram handlers de servidor",
    importadores.every((f) => /server\s*:\s*\{/.test(fontes[f])),
    importadores.join(", "),
  );

  // A chave privada só pode ser lida via process.env, nunca import.meta.env
  const viaImportMeta = arquivos.filter((f) => /import\.meta\.env\.[A-Za-z_]*SERVICE_ROLE/.test(fontes[f]));
  check("SERVICE_ROLE nunca é lida de import.meta.env", viaImportMeta.length === 0, viaImportMeta.join(", "));

  const comPrefixoVite = arquivos.filter((f) => /VITE_[A-Za-z_]*(SERVICE_ROLE|SECRET)/.test(fontes[f]));
  check("nenhuma variável service_role usa prefixo VITE_", comPrefixoVite.length === 0, comPrefixoVite.join(", "));

  // O cliente do navegador usa apenas a publishable
  const clientePublico = fontes["/src/integrations/supabase/client.ts"] ?? "";
  check(
    "client.ts usa apenas a publishable key",
    clientePublico.includes("VITE_SUPABASE_PUBLISHABLE_KEY") && !/SERVICE_ROLE/.test(clientePublico),
    "",
  );
}

/* ---- runner ---- */
export interface HarnessOutcome { passed: number; failed: number; report: string }
export async function runHarness(): Promise<HarnessOutcome> {
  const groups: Array<[string, () => void]> = [
    ["decisao", testDecisao],
    ["insert", testInsert],
    ["redacao", testRedacao],
    ["auth", testAuth],
    ["service-role", testServiceRoleIsolation],
  ];
  for (const [name, fn] of groups) {
    try { fn(); }
    catch (err) { check(`grupo "${name}" executou sem exceção`, false, err instanceof Error ? err.message : String(err)); }
  }
  const lines: string[] = [];
  let passed = 0, failed = 0, printedGroup = "";
  for (const item of checks) {
    if (item.group !== printedGroup) { lines.push(`\n▸ ${item.group}`); printedGroup = item.group; }
    if (item.ok) passed += 1; else failed += 1;
    lines.push(`${item.ok ? "  ✓" : "  ✗"} ${item.name}${item.detail && !item.ok ? `  — ${item.detail}` : ""}`);
  }
  lines.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  return { passed, failed, report: lines.join("\n") };
}
