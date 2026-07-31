/**
 * Harness da recuperação e redefinição de senha.
 *
 * Cobre as três pontas do fluxo com lógica pura, sem navegador e sem rede:
 *   - solicitação  (`@/lib/password-recovery`, `@/lib/auth-redirect`);
 *   - leitura do link e decisão da tela (`@/lib/password-recovery`);
 *   - troca da senha contra a auth fictícia (`@/mocks/auth`).
 *
 * Além disso varre o código-fonte para provar duas garantias que nenhum teste
 * de unidade pegaria: `/reset-password` continua sendo rota pública, e nenhum
 * endereço de ambiente ficou fixo no código.
 */
import {
  buildRedirectUrl,
  normalizeOrigin,
  passwordRecoveryRedirectUrl,
  PRODUCTION_ORIGIN,
  RESET_PASSWORD_PATH,
} from "@/lib/auth-redirect";
import {
  decideRecoveryState,
  normalizeEmail,
  parseRecoveryLink,
  recoveryLinkMessage,
  validateNewPassword,
  validateResetEmail,
  PASSWORD_MIN_LENGTH,
  RECOVERY_MISSING_SESSION_MESSAGE,
  RESET_REQUEST_FALLBACK,
  RESET_REQUEST_SUCCESS,
  RESET_UPDATE_FALLBACK,
} from "@/lib/password-recovery";
import { resetFlowMessage } from "@/lib/password-recovery";
import {
  getMockRecoveryRequests,
  mockAuth,
  mockRecoveryCredential,
  resetMockRecoveryState,
  MOCK_ACCOUNTS,
} from "@/mocks/auth";

/* ---- infra ---- */
interface Check { group: string; name: string; ok: boolean; detail: string }
const checks: Check[] = [];
let currentGroup = "geral";
const group = (n: string) => { currentGroup = n; };
const check = (name: string, ok: boolean, detail = "") => checks.push({ group: currentGroup, name, ok, detail });

/** Sinais de que um texto técnico vazou para a tela. */
const TERMOS_TECNICOS =
  /(supabase|gotrue|auth ?api|invalid|expired|token|jwt|otp|pkce|http|401|422|error|null|undefined|exception|stack)/i;

const CONTA = MOCK_ACCOUNTS[0].email;

/* ══════════ 1. Solicitação ══════════ */
function testSolicitacao(): void {
  group("solicitação — e-mail");

  // 1) solicitação válida: normaliza espaços e caixa
  const valido = validateResetEmail("  Ana@Exemplo.COM  ");
  check("e-mail válido é aceito", valido.ok, JSON.stringify(valido));
  check(
    "e-mail é normalizado antes de enviar",
    valido.ok && valido.email === "ana@exemplo.com",
    JSON.stringify(valido),
  );
  check("normalizeEmail é idempotente", normalizeEmail(normalizeEmail(" A@B.co ")) === "a@b.co");

  // 2) e-mail malformado é barrado na tela, sem chamar o provedor
  const malformados = ["", "   ", "sem-arroba", "a@b", "a@@b.co", "com espaco@b.co", "@b.co", "a@.co"];
  check(
    "e-mails malformados são recusados",
    malformados.every((e) => !validateResetEmail(e).ok),
    malformados.filter((e) => validateResetEmail(e).ok).join(", "),
  );
  const recusado = validateResetEmail("sem-arroba");
  check(
    "recusa traz mensagem em português, sem termo técnico",
    !recusado.ok && recusado.message === "Informe um e-mail válido.",
    recusado.ok ? "" : recusado.message,
  );
}

/* ══════════ 2. Resposta genérica e enumeração ══════════ */
async function testRespostaGenerica(): Promise<void> {
  group("solicitação — resposta");

  // 3) sucesso genérico
  check(
    "sucesso não confirma existência da conta",
    !/enviamos um link para seu|conta encontrada|e-mail cadastrado/i.test(RESET_REQUEST_SUCCESS) &&
      /se houver uma conta/i.test(RESET_REQUEST_SUCCESS),
    RESET_REQUEST_SUCCESS,
  );
  check("sucesso orienta sobre spam", /spam/i.test(RESET_REQUEST_SUCCESS), RESET_REQUEST_SUCCESS);

  // 14) enumeração: e-mail existente e inexistente produzem o MESMO resultado
  resetMockRecoveryState();
  const existente = await mockAuth.resetPasswordForEmail(CONTA, { redirectTo: "http://localhost:3000/reset-password" });
  const inexistente = await mockAuth.resetPasswordForEmail("ninguem@exemplo.com", {
    redirectTo: "http://localhost:3000/reset-password",
  });
  check(
    "conta existente e inexistente devolvem o mesmo resultado",
    JSON.stringify(existente) === JSON.stringify(inexistente) && existente.error === null,
    JSON.stringify({ existente, inexistente }),
  );
  check(
    "as duas solicitações foram registradas igualmente",
    getMockRecoveryRequests().length === 2,
    String(getMockRecoveryRequests().length),
  );

  // 4) erro de rede não vira mensagem técnica
  const rede = new TypeError("Failed to fetch");
  check(
    "erro de rede usa o texto da operação",
    resetFlowMessage(rede, RESET_REQUEST_FALLBACK) === RESET_REQUEST_FALLBACK,
    resetFlowMessage(rede, RESET_REQUEST_FALLBACK),
  );
  check(
    "mensagem crua do erro de rede não chega à tela",
    !resetFlowMessage(rede, RESET_REQUEST_FALLBACK).includes("Failed to fetch"),
  );
  const limite = { __isAuthError: true, code: "over_email_send_rate_limit", message: "For security purposes..." };
  check(
    "limite de envio é traduzido",
    /aguarde/i.test(resetFlowMessage(limite, RESET_REQUEST_FALLBACK)),
    resetFlowMessage(limite, RESET_REQUEST_FALLBACK),
  );
  check(
    "mensagem do provedor não vaza no limite de envio",
    !resetFlowMessage(limite, RESET_REQUEST_FALLBACK).includes("For security"),
  );
  check(
    "erro sem forma conhecida também usa o texto da operação",
    resetFlowMessage({ oops: true }, RESET_REQUEST_FALLBACK) === RESET_REQUEST_FALLBACK,
  );
}

/* ══════════ 3. redirectTo ══════════ */
function testRedirect(): void {
  group("redirectTo");

  // 5) a origem do navegador vence sempre
  const casos: Array<[string, string]> = [
    ["http://localhost:3000", "http://localhost:3000/reset-password"],
    ["https://barbaflow-git-fix.vercel.app", "https://barbaflow-git-fix.vercel.app/reset-password"],
    ["https://barbaflow.pro", "https://barbaflow.pro/reset-password"],
    ["https://barbaflow.pro/", "https://barbaflow.pro/reset-password"],
  ];
  for (const [origem, esperado] of casos) {
    check(
      `origem ${origem} → ${esperado}`,
      buildRedirectUrl(origem, null, RESET_PASSWORD_PATH) === esperado,
      buildRedirectUrl(origem, null, RESET_PASSWORD_PATH),
    );
  }

  check(
    "sem navegador, vale a origem configurada",
    buildRedirectUrl(null, "https://preview.exemplo.app", RESET_PASSWORD_PATH) ===
      "https://preview.exemplo.app/reset-password",
  );
  check(
    "sem navegador e sem configuração, vale produção",
    buildRedirectUrl(null, null, RESET_PASSWORD_PATH) === `${PRODUCTION_ORIGIN}/reset-password`,
  );
  check(
    "origem inválida é ignorada",
    buildRedirectUrl("javascript:alert(1)", null, RESET_PASSWORD_PATH) === `${PRODUCTION_ORIGIN}/reset-password`,
    buildRedirectUrl("javascript:alert(1)", null, RESET_PASSWORD_PATH),
  );
  check("normalizeOrigin recusa vazio", normalizeOrigin("   ") === null);
  check("normalizeOrigin recusa caminho", normalizeOrigin("https://x.com/app") === null);
  check("nunca gera barra dupla", !buildRedirectUrl("https://x.com//", null, RESET_PASSWORD_PATH).includes("//reset"));
  check(
    "a URL apontada é a da tela de redefinição",
    passwordRecoveryRedirectUrl().endsWith("/reset-password"),
    passwordRecoveryRedirectUrl(),
  );
}

/* ══════════ 4. Leitura do link ══════════ */
function testLink(): void {
  group("leitura do link");

  // 6) fluxo implícito com PASSWORD_RECOVERY
  const implicito = parseRecoveryLink({
    hash: "#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=recovery",
    search: "",
  });
  check("fragmento com tokens é reconhecido", implicito.kind === "implicito", JSON.stringify(implicito));
  check(
    "com sessão, o formulário libera",
    decideRecoveryState({ link: implicito, hasSession: true }).status === "pronto",
  );

  // PKCE
  const pkce = parseRecoveryLink({ hash: "", search: "?code=8b1c-uuid" });
  check("código PKCE é reconhecido", pkce.kind === "pkce" && pkce.code === "8b1c-uuid", JSON.stringify(pkce));
  const trocar = decideRecoveryState({ link: pkce, hasSession: false });
  check("sem sessão, o código é trocado antes do formulário", trocar.status === "trocar", JSON.stringify(trocar));
  check(
    "com sessão, o código não é trocado de novo",
    decideRecoveryState({ link: pkce, hasSession: true }).status === "pronto",
  );

  // token hash
  const tokenHash = parseRecoveryLink({ hash: "", search: "?token_hash=pkce_123&type=recovery" });
  check("token_hash de recuperação é reconhecido", tokenHash.kind === "token-hash", JSON.stringify(tokenHash));
  check(
    "token_hash de outro tipo é ignorado",
    parseRecoveryLink({ search: "?token_hash=pkce_123&type=signup" }).kind === "ausente",
  );

  // 11) link expirado ou já utilizado
  const expirado = parseRecoveryLink({
    hash: "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  });
  check(
    "link expirado é reconhecido",
    expirado.kind === "erro" && expirado.reason === "expirado",
    JSON.stringify(expirado),
  );
  check(
    "erro do link vence a sessão existente",
    decideRecoveryState({ link: expirado, hasSession: true }).status === "invalido",
  );
  const negado = parseRecoveryLink({ search: "?error=access_denied&error_code=validation_failed" });
  check("outro erro cai em inválido", negado.kind === "erro" && negado.reason === "invalido", JSON.stringify(negado));

  // tokens na URL sem sessão = link já consumido
  check(
    "tokens sem sessão são tratados como link vencido",
    decideRecoveryState({ link: implicito, hasSession: false }).status === "invalido",
  );

  // 12) ausência de sessão e de link
  const vazio = parseRecoveryLink({ hash: "", search: "" });
  check("URL sem parâmetros é 'ausente'", vazio.kind === "ausente");
  const semSessao = decideRecoveryState({ link: vazio, hasSession: false });
  check("sem link e sem sessão → orientação para pedir outro", semSessao.status === "sem-sessao");
  check(
    "orientação manda solicitar novo link",
    /solicite um novo/i.test(RECOVERY_MISSING_SESSION_MESSAGE),
    RECOVERY_MISSING_SESSION_MESSAGE,
  );
  check(
    "usuário já autenticado sem link não fica preso",
    decideRecoveryState({ link: vazio, hasSession: true }).status === "pronto",
  );
}

/* ══════════ 5. Nova senha ══════════ */
function testNovaSenha(): void {
  group("nova senha — validação");

  // 7) senha e confirmação diferentes
  const diferentes = validateNewPassword("senha123", "senha124");
  check(
    "confirmação diferente é recusada",
    !diferentes.ok && diferentes.message === "As senhas não coincidem.",
    diferentes.ok ? "" : diferentes.message,
  );

  // 8) senha inválida (abaixo do mínimo do projeto)
  const curta = validateNewPassword("123", "123");
  check("senha curta é recusada", !curta.ok, curta.ok ? "" : curta.message);
  check(
    "a regra citada é a do projeto",
    !curta.ok && curta.message.includes(String(PASSWORD_MIN_LENGTH)),
    curta.ok ? "" : curta.message,
  );
  check(
    "igualdade é conferida antes do tamanho",
    !validateNewPassword("123", "456").ok &&
      (validateNewPassword("123", "456") as { message: string }).message === "As senhas não coincidem.",
  );
  check("senha no limite é aceita", validateNewPassword("123456", "123456").ok);
}

/* ══════════ 6. Troca efetiva contra a auth fictícia ══════════ */
async function testTroca(): Promise<void> {
  group("nova senha — troca");

  // 10) updateUser sem sessão falha, e a tela mostra texto próprio
  resetMockRecoveryState();
  await mockAuth.signOut();
  const semSessao = await mockAuth.updateUser({ password: "novaSenha123" });
  check("sem sessão, a troca falha", semSessao.error !== null, JSON.stringify(semSessao.error));
  check(
    "falha sem sessão não vira mensagem técnica",
    resetFlowMessage(semSessao.error, RESET_UPDATE_FALLBACK) === RESET_UPDATE_FALLBACK,
    resetFlowMessage(semSessao.error, RESET_UPDATE_FALLBACK),
  );

  // 6) o link válido abre sessão de recuperação e emite PASSWORD_RECOVERY
  const eventos: string[] = [];
  const { data: { subscription } } = mockAuth.onAuthStateChange((event) => { eventos.push(event); });
  const credencial = mockRecoveryCredential(CONTA);
  const trocado = await mockAuth.exchangeCodeForSession(credencial);
  check("código válido abre sessão", trocado.error === null && trocado.data.session !== null);
  check("evento PASSWORD_RECOVERY é emitido", eventos.includes("PASSWORD_RECOVERY"), eventos.join(", "));

  // 9) atualização bem-sucedida
  const ok = await mockAuth.updateUser({ password: "novaSenha123" });
  check("com sessão, a senha é atualizada", ok.error === null && ok.data.user !== null, JSON.stringify(ok.error));

  // 11) o mesmo link não vale duas vezes
  const repetido = await mockAuth.exchangeCodeForSession(credencial);
  check("link reutilizado é recusado", repetido.error !== null, JSON.stringify(repetido.error));
  check(
    "link reutilizado é traduzido como expirado",
    resetFlowMessage(repetido.error, RESET_UPDATE_FALLBACK) === "Este link expirou. Solicite um novo.",
    resetFlowMessage(repetido.error, RESET_UPDATE_FALLBACK),
  );

  // código desconhecido
  const invalido = await mockAuth.exchangeCodeForSession("codigo-que-nao-existe");
  check("código desconhecido é recusado", invalido.error !== null);
  // token_hash usa outra conta: o código anterior já foi consumido acima.
  const otro = MOCK_ACCOUNTS[1].email;
  const otp = await mockAuth.verifyOtp({ type: "recovery", token_hash: mockRecoveryCredential(otro) });
  check(
    "token_hash válido abre sessão",
    otp.error === null && otp.data.session !== null,
    JSON.stringify(otp.error),
  );
  check(
    "verifyOtp de outro tipo é recusado",
    (await mockAuth.verifyOtp({ type: "signup", token_hash: mockRecoveryCredential(otro) })).error !== null,
  );

  subscription.unsubscribe();
  await mockAuth.signOut();
  resetMockRecoveryState();
}

/* ══════════ 7. Nada técnico chega à tela ══════════ */
function testMensagens(): void {
  group("mensagens visíveis");

  // 13) todo texto que a tela pode exibir passa pelo mesmo crivo
  const visiveis = [
    RESET_REQUEST_SUCCESS,
    RESET_REQUEST_FALLBACK,
    RESET_UPDATE_FALLBACK,
    RECOVERY_MISSING_SESSION_MESSAGE,
    recoveryLinkMessage("expirado"),
    recoveryLinkMessage("invalido"),
    "Informe um e-mail válido.",
    "As senhas não coincidem.",
    `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres.`,
  ];
  const comTermoTecnico = visiveis.filter((m) => TERMOS_TECNICOS.test(m));
  check("nenhuma mensagem contém termo técnico", comTermoTecnico.length === 0, comTermoTecnico.join(" | "));
  check("nenhuma mensagem cita URL", visiveis.every((m) => !/https?:\/\//i.test(m)));
  check("nenhuma mensagem cita código de erro", visiveis.every((m) => !/\b\d{3}\b|_[a-z]+_/i.test(m)));
  check("toda mensagem termina em pontuação", visiveis.every((m) => /[.!?]$/.test(m)));
  check(
    "expirado e inválido são textos distintos",
    recoveryLinkMessage("expirado") !== recoveryLinkMessage("invalido"),
  );
}

/* ══════════ 8. Rota pública e ausência de endereço fixo ══════════ */
function testRotaPublica(): void {
  group("rota pública e endereços");

  const fontes = import.meta.glob("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  const arquivos = Object.keys(fontes);
  check("varredura encontrou o código-fonte", arquivos.length > 50, `${arquivos.length} arquivos`);

  // 15) /reset-password é pública: sem guarda, sem papel, sem redirecionamento
  const tela = fontes["/src/routes/reset-password.tsx"] ?? "";
  check("a rota existe", tela.length > 0);
  check("não declara guarda de carregamento", !/beforeLoad\s*[:(]/.test(tela));
  check("não exige papel nem barbearia", !/useBarbershop|user_roles|requireRole/.test(tela));
  check("não redireciona para /login por conta própria", !/navigate\(\{\s*to:\s*"\/login"/.test(tela));
  check("não redireciona para o dashboard", !/dashboard/.test(tela));
  check(
    "usa a sessão apenas para liberar o formulário",
    /getSession\(\)/.test(tela) && /onAuthStateChange/.test(tela),
  );
  check("lê o link antes dos efeitos", /useState<RecoveryLink>\(lerLinkAtual\)/.test(tela), "");

  // Nenhum guard global pode interceptar a rota: o projeto não tem middleware
  // de autenticação, e nenhuma rota deve mandar quem está em /reset-password
  // para outro lugar.
  const guardas = arquivos.filter((f) => /reset-password/.test(fontes[f]) && /redirect\s*:/.test(fontes[f]));
  check("nenhum arquivo redireciona a rota de redefinição", guardas.length === 0, guardas.join(", "));

  // O endereço do ambiente nunca fica fixo no código do fluxo
  const doFluxo = ["/src/lib/auth-redirect.ts", "/src/lib/password-recovery.ts", "/src/routes/reset-password.tsx", "/src/components/AuthForm.tsx"];
  const comVercel = doFluxo.filter((f) => /vercel\.app/.test(fontes[f] ?? ""));
  check("nenhum arquivo do fluxo cita um domínio de Preview", comVercel.length === 0, comVercel.join(", "));
  const comLocalhost = doFluxo.filter((f) => /localhost/.test(fontes[f] ?? ""));
  check("nenhum arquivo do fluxo cita localhost", comLocalhost.length === 0, comLocalhost.join(", "));

  // A montagem da URL passa pelo módulo central, em todas as chamadas
  const chamadas = arquivos.filter((f) => /resetPasswordForEmail\(/.test(fontes[f]) && !f.startsWith("/src/mocks/"));
  check("há chamadas de solicitação no app", chamadas.length > 0, chamadas.join(", "));
  const semModuloCentral = chamadas.filter((f) => !/passwordRecoveryRedirectUrl\(\)/.test(fontes[f]));
  check(
    "toda solicitação usa a URL central",
    semModuloCentral.length === 0,
    semModuloCentral.join(", "),
  );
  const comOrigemCrua = chamadas.filter((f) => /redirectTo:\s*`\$\{window\.location\.origin\}/.test(fontes[f]));
  check("nenhuma solicitação monta a URL à mão", comOrigemCrua.length === 0, comOrigemCrua.join(", "));

  // A chave administrativa não pode aparecer no fluxo
  const comChave = doFluxo.filter((f) => /SERVICE_ROLE|SECRET_KEY|client\.server/.test(fontes[f] ?? ""));
  check("nenhum arquivo do fluxo toca chave administrativa", comChave.length === 0, comChave.join(", "));
}

/* ---- runner ---- */
export interface HarnessOutcome { passed: number; failed: number; report: string }
export async function runHarness(): Promise<HarnessOutcome> {
  const groups: Array<[string, () => void | Promise<void>]> = [
    ["solicitacao", testSolicitacao],
    ["resposta", testRespostaGenerica],
    ["redirect", testRedirect],
    ["link", testLink],
    ["nova-senha", testNovaSenha],
    ["troca", testTroca],
    ["mensagens", testMensagens],
    ["rota-publica", testRotaPublica],
  ];
  for (const [name, fn] of groups) {
    try { await fn(); }
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
