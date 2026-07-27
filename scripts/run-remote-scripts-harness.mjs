/**
 * Harness dos scripts de banco remoto.
 *
 *   node scripts/run-remote-scripts-harness.mjs
 *
 * Estes testes NÃO tocam o Supabase: nenhuma rede, nenhum CLI, nenhum projeto
 * remoto. Eles exercitam exatamente a parte que decide se um comando pode ou
 * não prosseguir — as guardas, a redação de segredos e a escrita de types.ts.
 *
 * O que fica de fora, de propósito: a execução real do Supabase CLI. Ela só
 * pode ser validada numa máquina onde o CLI rode (ver a seção de Smart App
 * Control em docs/DESENVOLVIMENTO_REMOTO.md).
 */
import { readFileSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_PROJECT_REF,
  RemoteGuardError,
  validateLinkedRef,
  validateDbPassword,
  assinaturasFaltando,
  redact,
  explainCliFailure,
  readLinkedRef,
  gravarAtomico,
} from "./supabase-remote-lib.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

let passou = 0;
let falhou = 0;

function group(titulo) {
  console.log(`\n▸ ${titulo}`);
}

function check(nome, ok, detalhe = "") {
  if (ok) {
    passou++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhou++;
    console.log(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/** Roda `fn` e devolve a RemoteGuardError lançada, ou null se não lançou. */
function capturaGuarda(fn) {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof RemoteGuardError ? e : null;
  }
}

/* ══════════════ 1. guarda do project ref ══════════════ */

function testeProjectRef() {
  group("guarda do project ref");

  check("o ref esperado é o de desenvolvimento/homologação", EXPECTED_PROJECT_REF === "qfcngyyzyiwotehubifx");

  const semVinculo = capturaGuarda(() => validateLinkedRef(null));
  check("sem vínculo: recusa", semVinculo !== null);
  check(
    "sem vínculo: ensina login e link",
    semVinculo?.message.includes("supabase login") && semVinculo?.message.includes("--project-ref"),
  );

  const errado = capturaGuarda(() => validateLinkedRef("projeto-de-producao"));
  check("ref divergente: recusa", errado !== null);
  check("ref divergente: nomeia o ref encontrado", errado?.message.includes("projeto-de-producao"));
  check("ref divergente: nomeia o ref autorizado", errado?.message.includes(EXPECTED_PROJECT_REF));

  const vazio = capturaGuarda(() => validateLinkedRef(""));
  check("ref vazio é tratado como sem vínculo", vazio !== null);

  check("ref correto: passa", validateLinkedRef(EXPECTED_PROJECT_REF) === EXPECTED_PROJECT_REF);

  // A trava do seed e a dos scripts remotos precisam apontar para o MESMO
  // projeto — divergirem seria uma porta lateral silenciosa.
  const seedLib = readFileSync(path.join(SCRIPTS, "seed-barbaflow-lib.mjs"), "utf8");
  check(
    "trava do seed usa o mesmo ref dos scripts remotos",
    seedLib.includes(`ALLOWED_REMOTE_REF = "${EXPECTED_PROJECT_REF}"`),
  );
}

/* ══════════════ 2. guarda da senha do banco ══════════════ */

function testeSenha() {
  group("guarda de SUPABASE_DB_PASSWORD");

  for (const [rotulo, valor] of [
    ["ausente", undefined],
    ["vazia", ""],
    ["só espaços", "   "],
  ]) {
    const err = capturaGuarda(() => validateDbPassword(valor));
    check(`senha ${rotulo}: recusa`, err !== null);
  }

  const err = capturaGuarda(() => validateDbPassword(undefined));
  check("mensagem nomeia a variável", err?.message.includes("SUPABASE_DB_PASSWORD"));
  check("mensagem não sugere versionar a senha", err?.message.includes("nunca no repositório"));

  check("senha presente: passa", validateDbPassword("  s3nh4  ") === "s3nh4");
}

/* ══════════════ 3. redação de segredos ══════════════ */

function testeRedacao() {
  group("redação de segredos");

  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";

  const casos = [
    ["JWT solto", `token ${jwt} fim`, "dBjftJeZ4CVPmB92K27uhbUJU1p1r"],
    ["apikey em querystring", `https://x.supabase.co/rest?apikey=${jwt}`, "dBjftJeZ4CVPmB92K27uhbUJU1p1r"],
    ["secret key nova", "usando sb_secret_ABCdef123456 aqui", "sb_secret_ABCdef123456"],
    ["token do CLI", "sbp_0102030405060708090a0b0c", "sbp_0102030405060708090a0b0c"],
    ["senha em connection string", "postgres://postgres:MinhaSenha@db.host:5432/x", "MinhaSenha"],
    ["password em querystring", "POST /auth?password=hunter2", "hunter2"],
  ];

  for (const [nome, entrada, segredo] of casos) {
    const saida = redact(entrada);
    check(`${nome} é redigido`, !saida.includes(segredo), saida);
  }

  check("texto sem segredo passa intacto", redact("migration 20260101 aplicada") === "migration 20260101 aplicada");
  check("host do projeto NÃO é redigido (não é segredo)", redact("https://x.supabase.co").includes("supabase.co"));
}

/* ══════════════ 4. validação da saída do gen types ══════════════ */

function testeValidacaoTypes() {
  group("validação da saída de gen types");

  const valido = 'export type Json = string\n\nexport type Database = {\n  public: {}\n}\n';
  check("saída válida é aceita", assinaturasFaltando(valido).length === 0);

  const casosInvalidos = [
    ["saída vazia", ""],
    ["erro do CLI", "Error: failed to connect to project"],
    ["HTML de proxy", "<html><body>502 Bad Gateway</body></html>"],
    ["só metade das assinaturas", "export type Json = string"],
    ["aviso sem tipos", "Warning: schema is empty"],
  ];

  for (const [nome, texto] of casosInvalidos) {
    check(`${nome}: recusada`, assinaturasFaltando(texto).length > 0);
  }
}

/* ══════════════ 5. escrita atômica de types.ts ══════════════ */

function testeEscritaAtomica() {
  group("escrita atômica");

  const dir = mkdtempSync(path.join(tmpdir(), "barbaflow-types-"));
  try {
    const alvo = path.join(dir, "types.ts");
    const original = Buffer.from("conteudo original que nao pode ser perdido\n", "utf8");
    writeFileSync(alvo, original);

    // Conteúdo com acento: prova que nada é reencodado no caminho.
    const novo = Buffer.from('export type Database = { descrição: "ação" }\n', "utf8");
    gravarAtomico(alvo, novo);

    const lido = readFileSync(alvo);
    check("substitui o arquivo existente", Buffer.compare(lido, novo) === 0);
    check("bytes preservados (UTF-8, sem reencode)", lido.toString("utf8").includes("descrição"));
    check("sem BOM no início", lido[0] !== 0xef);

    const temporarios = readdirSync(dir);
    check(
      "nenhum arquivo .tmp deixado para trás",
      temporarios.every((f) => !f.includes(".tmp-")),
      temporarios.join(", "),
    );

    // Destino impossível: a falha não pode destruir o arquivo bom.
    const alvoBom = path.join(dir, "bom.ts");
    writeFileSync(alvoBom, original);
    let lancou = false;
    try {
      gravarAtomico(path.join(dir, "subdir-inexistente", "x.ts"), novo);
    } catch {
      lancou = true;
    }
    check("destino inválido: lança em vez de falhar em silêncio", lancou);
    check("arquivo alheio permanece intacto", Buffer.compare(readFileSync(alvoBom), original) === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ══════════════ 6. diagnóstico de falha do CLI ══════════════ */

function testeFalhaCli() {
  group("diagnóstico de falha do CLI");

  const spawnFail = explainCliFailure({ code: 127, stderr: "spawnSync supabase.exe UNKNOWN", spawnError: new Error("x") });
  check("falha de spawn é explicada", spawnFail !== null);
  check("menciona Controle de Aplicativo", spawnFail?.includes("Controle de Aplicativo"));

  const ok = explainCliFailure({ code: 0, stderr: "" });
  check("execução normal não gera diagnóstico", ok === null);

  const erroDoCli = explainCliFailure({ code: 1, stderr: "permission denied" });
  check("erro do próprio CLI não vira 'não executou'", erroDoCli === null);

  const comSegredo = explainCliFailure({
    code: 127,
    stderr: "falhou com sb_secret_VAZOU123 no ambiente",
    spawnError: new Error("x"),
  });
  check("diagnóstico redige segredo do stderr", !comSegredo.includes("sb_secret_VAZOU123"), comSegredo);
}

/* ══════════════ 7. estado real desta máquina ══════════════ */

function testeEstadoLocal() {
  group("estado do vínculo nesta máquina (informativo)");
  const ref = readLinkedRef();
  check(
    "vínculo local, se existir, aponta para o projeto autorizado",
    ref === null || ref === EXPECTED_PROJECT_REF,
    `ref lido: ${ref ?? "(sem vínculo)"}`,
  );
}

/* ────────────────────────────── runner ────────────────────────────── */

testeProjectRef();
testeSenha();
testeRedacao();
testeValidacaoTypes();
testeEscritaAtomica();
testeFalhaCli();
testeEstadoLocal();

console.log(
  `\n${falhou === 0 ? "OK" : "FALHOU"} — ${passou} passaram, ${falhou} falharam.\n` +
    "Nota: a execução real do Supabase CLI NÃO é coberta aqui.\n",
);
process.exit(falhou === 0 ? 0 : 1);
