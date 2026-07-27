/**
 * Núcleo compartilhado dos comandos remotos do Supabase CLI.
 *
 * O BarbaFlow desenvolve contra o projeto remoto — não há `supabase start`, não
 * há Docker no fluxo padrão. O que este módulo garante é que os comandos
 * administrativos só rodem contra o projeto CERTO, e que falhem alto quando
 * falta alguma condição, em vez de perguntarem algo num terminal que talvez
 * ninguém esteja olhando.
 *
 * Nada aqui imprime chave, token ou senha: a saída do CLI passa por redação
 * antes de chegar ao console, e nenhuma variável de ambiente é ecoada.
 */
import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Raiz do repositório (este arquivo vive em scripts/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Único projeto remoto que os scripts deste repositório podem tocar.
 * Ambiente de DESENVOLVIMENTO/HOMOLOGAÇÃO — não é produção.
 * Mantido em sincronia com ALLOWED_REMOTE_REF de scripts/seed-barbaflow-lib.mjs.
 */
export const EXPECTED_PROJECT_REF = "qfcngyyzyiwotehubifx";

/** Onde o CLI grava o ref do projeto vinculado por `supabase link`. */
const LINK_STATE = path.join(ROOT, "supabase", ".temp", "project-ref");

/* ─────────────────────────────── redação ──────────────────────────────── */

// A ordem importa: os padrões que consomem um valor INTEIRO (querystring,
// connection string) vêm antes dos que reconhecem o formato do segredo. Assim
// `apikey=eyJ...` é redigido de uma vez, em vez de sobrar metade da marcação.
const SENSITIVE = [
  // Parâmetros sensíveis em querystring
  [/([?&](?:apikey|access_token|token|password)=)[^&\s]+/gi, "$1[omitido]"],
  // Senha embutida numa connection string postgres://user:senha@host
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, "$1[omitido]$2"],
  // JWT solto (anon/service_role legados)
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, "[jwt omitido]"],
  // Chaves novas do Supabase e tokens de acesso do CLI
  [/\bsb(?:_secret|_publishable|p)_[A-Za-z0-9_-]+/g, "[chave omitida]"],
];

/** Remove material sensível de um texto antes de ele chegar ao console. */
export function redact(text) {
  return SENSITIVE.reduce((acc, [re, repl]) => acc.replace(re, repl), String(text));
}

/* ──────────────────────────── falha controlada ────────────────────────── */

/** Erro esperado (condição não atendida), impresso sem stack. */
export class RemoteGuardError extends Error {}

/** Aborta com mensagem legível e código de saída != 0. */
export function fail(message) {
  throw new RemoteGuardError(message);
}

/* ──────────────────────────────── guardas ─────────────────────────────── */

/** Ref do projeto atualmente vinculado, ou `null` se não houver vínculo. */
export function readLinkedRef() {
  if (!existsSync(LINK_STATE)) return null;
  const ref = readFileSync(LINK_STATE, "utf8").trim();
  return ref || null;
}

/**
 * Exige que o CLI esteja vinculado ao projeto esperado.
 *
 * O estado do vínculo (`supabase/.temp/`) é ignorado pelo Git de propósito: ele
 * é por máquina. Numa máquina nova o vínculo não existe, e a mensagem abaixo
 * diz exatamente o que rodar.
 */
export function requireLinkedProject() {
  return validateLinkedRef(readLinkedRef());
}

/**
 * Validação pura do ref vinculado — separada da leitura de disco para poder
 * ser exercitada pelo harness (scripts/run-remote-scripts-harness.mjs).
 */
export function validateLinkedRef(ref) {
  if (!ref) {
    fail(
      "Projeto Supabase não vinculado nesta máquina.\n" +
        "  Rode, nesta ordem:\n" +
        "    npx supabase login\n" +
        `    npx supabase link --project-ref ${EXPECTED_PROJECT_REF}`,
    );
  }

  if (ref !== EXPECTED_PROJECT_REF) {
    fail(
      `Projeto vinculado NÃO autorizado: "${ref}".\n` +
        `  Os scripts deste repositório só operam em "${EXPECTED_PROJECT_REF}" ` +
        "(desenvolvimento/homologação).\n" +
        "  Se o vínculo está errado, refaça:\n" +
        `    npx supabase link --project-ref ${EXPECTED_PROJECT_REF}`,
    );
  }

  return ref;
}

/**
 * Exige a senha do banco remoto, usada pelos comandos que abrem conexão
 * (migration list, db lint, db push --dry-run).
 *
 * Sem isto o CLI abre um prompt interativo — que trava um script rodando em
 * pipe ou em CI. Falhar aqui é mais honesto que pendurar.
 */
export function requireDbPassword() {
  return validateDbPassword(process.env.SUPABASE_DB_PASSWORD);
}

/** Validação pura da senha — testável sem mexer no ambiente do processo. */
export function validateDbPassword(valor) {
  const pwd = valor?.trim();
  if (!pwd) {
    fail(
      "Variável obrigatória ausente: SUPABASE_DB_PASSWORD.\n" +
        "  É a senha do banco do projeto remoto (Dashboard → Settings → Database).\n" +
        "  Defina-a no seu .env.local privado — nunca no repositório.\n" +
        "  PowerShell:  $env:SUPABASE_DB_PASSWORD = '...'",
    );
  }
  return pwd;
}

/**
 * Marcas que a saída do `gen types` precisa conter para ser aceita.
 * Uma mensagem de erro do CLI jamais deve substituir types.ts.
 */
export const ASSINATURAS_TYPES = ["export type Json", "export type Database"];

/** Devolve as assinaturas AUSENTES no texto. Vazio = saída aceitável. */
export function assinaturasFaltando(texto) {
  return ASSINATURAS_TYPES.filter((s) => !String(texto).includes(s));
}

/**
 * Grava em um temporário ao lado do destino e só então renomeia por cima.
 *
 * O `rename` no mesmo diretório é atômico (no Windows o Node usa MoveFileEx com
 * MOVEFILE_REPLACE_EXISTING). Consequência prática: types.ts nunca é observado
 * pela metade, e uma falha no meio da escrita deixa o arquivo antigo intacto em
 * vez de um híbrido corrompido.
 */
export function gravarAtomico(dest, buffer) {
  const tmp = `${dest}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, buffer);
    renameSync(tmp, dest);
  } catch (e) {
    // Não deixa lixo para trás se algo falhar no caminho.
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* o erro original é o que importa */
    }
    throw e;
  }
}

/* ─────────────────────────── execução do CLI ──────────────────────────── */

const IS_WINDOWS = process.platform === "win32";

/**
 * Como invocar o `npx` (que resolve o supabase sem exigi-lo como dependência).
 *
 * No Windows o `npx` é um `.cmd`, e desde o Node 18.20/20.12 o spawn recusa
 * executá-lo sem `shell: true` (CVE-2024-27980) — que por sua vez emite aviso
 * de depreciação e concatena argumentos sem escapar. Evitamos os dois lados
 * chamando o `npx-cli.js` com o próprio Node: sem shell, sem `.cmd`.
 */
function cliInvocation(args) {
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (existsSync(npxCli)) {
    return { file: process.execPath, argv: [npxCli, ...args], shell: false };
  }
  // Instalação de Node fora do padrão: cai no `npx` do PATH.
  return { file: IS_WINDOWS ? "npx.cmd" : "npx", argv: args, shell: IS_WINDOWS };
}

/**
 * Roda o Supabase CLI.
 *
 * @param args argumentos após `supabase`
 * @param capture `true` devolve stdout como Buffer (bytes crus — nada de
 *   reencodar; é assim que a geração de tipos preserva UTF-8 no Windows sem
 *   depender de redirecionamento do PowerShell, que grava UTF-16).
 * @returns `{ code, stdout, stderr }`
 */
export function runSupabaseCli(args, { capture = false } = {}) {
  return new Promise((resolve) => {
    const inv = cliInvocation(["--yes", "supabase", ...args]);
    let child;
    try {
      child = spawn(inv.file, inv.argv, {
        cwd: ROOT,
        // stdout capturado quando precisamos do conteúdo; senão vai direto à tela.
        stdio: ["inherit", capture ? "pipe" : "inherit", "pipe"],
        windowsHide: true,
        shell: inv.shell,
      });
    } catch (e) {
      // spawn pode lançar de forma SÍNCRONA (ex.: EINVAL) — sem este catch a
      // exceção escapa do envelope e vira "falha inesperada".
      resolve({ code: 127, stdout: Buffer.alloc(0), stderr: String(e.message), spawnError: e });
      return;
    }

    const out = [];
    const err = [];
    child.stdout?.on("data", (c) => out.push(c));
    child.stderr?.on("data", (c) => {
      err.push(c);
      // stderr do CLI é progresso/erro — mostramos já redigido.
      process.stderr.write(redact(c.toString("utf8")));
    });

    child.on("error", (e) => {
      resolve({ code: 127, stdout: Buffer.concat(out), stderr: String(e.message), spawnError: e });
    });

    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

/**
 * Envelope padrão de um script remoto: imprime o alvo, roda, e traduz qualquer
 * falha em exit code != 0 com mensagem limpa.
 */
export async function main(label, fn) {
  try {
    console.log(`\n▸ ${label}`);
    console.log(`  projeto: ${EXPECTED_PROJECT_REF} (desenvolvimento/homologação)\n`);
    const code = await fn();
    process.exitCode = code ?? 0;
  } catch (e) {
    if (e instanceof RemoteGuardError) {
      console.error(`\n✖ ${redact(e.message)}\n`);
    } else {
      console.error(`\n✖ Falha inesperada: ${redact(e?.message ?? e)}\n`);
    }
    process.exitCode = 1;
  }
}

/** Mensagem padrão quando o próprio CLI não pôde ser executado. */
export function explainCliFailure(result) {
  if (result.spawnError || result.code === 127) {
    return (
      "Não foi possível executar o Supabase CLI.\n" +
      "  Verifique se o Node/npx está no PATH e se nenhuma política de\n" +
      "  Controle de Aplicativo do Windows está bloqueando supabase.exe.\n" +
      `  Detalhe: ${redact(result.stderr || "sem detalhes")}`
    );
  }
  return null;
}
