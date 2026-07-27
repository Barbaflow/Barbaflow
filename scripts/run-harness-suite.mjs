/**
 * Runner das suítes de harness.
 *
 *   node scripts/run-harness-suite.mjs core   # só o que roda sem banco
 *   node scripts/run-harness-suite.mjs db     # só o que exige Postgres real
 *   node scripts/run-harness-suite.mjs all    # as duas, sem tolerar buraco
 *
 * O problema que este runner resolve é de leitura, não de execução: antes, uma
 * suíte que não rodava saía 0 e somava-se ao "tudo verde". Aqui os quatro
 * estados são distintos e o total de verificações conta APENAS o que executou:
 *
 *   PASS     a suíte rodou; todas as verificações passaram
 *   FAIL     a suíte rodou; algo falhou
 *   SKIPPED  a suíte não rodou (banco indisponível) — nada foi verificado
 *   NOT RUN  a suíte não pôde nem começar (arquivo ausente, falha de spawn)
 *
 * Política de código de saída:
 *   - `core`: verde se todas passaram. Não há skip possível — nenhuma depende
 *     de banco, então um skip aqui seria um bug.
 *   - `db`:   SKIPPED só é tolerado com HARNESS_ALLOW_DB_SKIP=true. Sem isso,
 *             banco indisponível é FALHA — é o comportamento padrão.
 *   - `all`:  nunca fica verde com SKIPPED ou NOT RUN, mesmo com a variável
 *             acima. "Tudo passou" só vale quando tudo executou.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT_SKIPPED } from "./harness-db-skip.mjs";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

/** Suítes que rodam em qualquer máquina: sem Docker, sem Postgres, sem rede. */
const CORE = [
  ["plan", "run-plan-harness.mjs"],
  ["agenda", "run-agenda-harness.mjs"],
  ["relatorios", "run-relatorios-harness.mjs"],
  ["dashboard", "run-dashboard-harness.mjs"],
  ["erros", "run-erros-role-harness.mjs"],
  ["notifications", "run-notifications-reviews-harness.mjs"],
  ["realtime", "run-realtime-harness.mjs"],
  ["remote-scripts", "run-remote-scripts-harness.mjs"],
];

/** Suítes que exigem um Postgres real (via docker exec) para provar o que testam. */
const DB = [
  ["cliente", "run-cliente-harness.mjs"],
  ["comandas", "run-comandas-harness.mjs"],
  ["agenda-concorrencia", "run-agenda-concurrency-harness.mjs"],
];

const ALLOW_DB_SKIP = process.env.HARNESS_ALLOW_DB_SKIP?.trim() === "true";

/** Executa uma suíte e classifica o resultado. */
function runOne(nome, arquivo) {
  return new Promise((resolve) => {
    const alvo = path.join(SCRIPTS, arquivo);

    if (!existsSync(alvo)) {
      resolve({ nome, estado: "NOT RUN", motivo: `arquivo ausente: ${arquivo}`, passou: 0, falhou: 0 });
      return;
    }

    console.log(`\n──── ${nome} ────`);

    let child;
    try {
      child = spawn(process.execPath, [alvo], { stdio: ["inherit", "pipe", "inherit"] });
    } catch (e) {
      resolve({ nome, estado: "NOT RUN", motivo: `falha de spawn: ${e.message}`, passou: 0, falhou: 0 });
      return;
    }

    let saida = "";
    child.stdout.on("data", (c) => {
      const s = c.toString();
      saida += s;
      process.stdout.write(s);
    });

    child.on("error", (e) => {
      resolve({ nome, estado: "NOT RUN", motivo: `falha de spawn: ${e.message}`, passou: 0, falhou: 0 });
    });

    child.on("close", (code) => {
      // As suítes fecham com "OK — N passaram, M falharam."
      const m = saida.match(/(\d+)\s+passaram,\s*(\d+)\s+falharam/);
      const passou = m ? Number(m[1]) : 0;
      const falhou = m ? Number(m[2]) : 0;

      if (code === EXIT_SKIPPED) {
        resolve({ nome, estado: "SKIPPED", motivo: "banco indisponível", passou: 0, falhou: 0 });
      } else if (code === 0) {
        resolve({ nome, estado: "PASS", motivo: "", passou, falhou });
      } else {
        resolve({
          nome,
          estado: "FAIL",
          motivo: m ? `${falhou} verificação(ões) falharam` : `código de saída ${code}`,
          passou,
          falhou,
        });
      }
    });
  });
}

function relatorio(resultados, suite) {
  const linha = "═".repeat(70);
  const por = (e) => resultados.filter((r) => r.estado === e);

  const pass = por("PASS");
  const fail = por("FAIL");
  const skip = por("SKIPPED");
  const notrun = por("NOT RUN");

  // Só conta verificações de suítes que REALMENTE executaram.
  const executadas = [...pass, ...fail];
  const totalPassou = executadas.reduce((a, r) => a + r.passou, 0);
  const totalFalhou = executadas.reduce((a, r) => a + r.falhou, 0);

  console.log(`\n${linha}`);
  console.log(`RESUMO — suíte "${suite}"`);
  console.log(linha);

  for (const r of resultados) {
    const detalhe = r.motivo ? `  (${r.motivo})` : "";
    const contagem = r.estado === "PASS" || r.estado === "FAIL" ? `  [${r.passou} ok / ${r.falhou} falhas]` : "";
    console.log(`  ${r.estado.padEnd(8)} ${r.nome.padEnd(22)}${contagem}${detalhe}`);
  }

  console.log(linha);
  console.log(
    `Suítes: ${pass.length} PASS · ${fail.length} FAIL · ` +
      `${skip.length} SKIPPED · ${notrun.length} NOT RUN`,
  );
  console.log(
    `Verificações executadas: ${totalPassou + totalFalhou} ` +
      `(${totalPassou} passaram, ${totalFalhou} falharam)`,
  );

  if (skip.length > 0 || notrun.length > 0) {
    console.log(
      "\nATENÇÃO: as suítes SKIPPED/NOT RUN não foram executadas.\n" +
        "Nenhuma verificação delas está contabilizada acima — não trate\n" +
        "este resultado como cobertura completa.",
    );
  }
  console.log(linha);

  return { fail: fail.length, skip: skip.length, notrun: notrun.length };
}

async function main() {
  const suite = (process.argv[2] || "").trim();
  if (!["core", "db", "all"].includes(suite)) {
    console.error('Uso: node scripts/run-harness-suite.mjs <core|db|all>');
    process.exit(2);
  }

  const lista = suite === "core" ? CORE : suite === "db" ? DB : [...CORE, ...DB];

  if (suite !== "core") {
    console.log(
      `\nSuítes de banco exigem Postgres local (docker exec).\n` +
        `HARNESS_ALLOW_DB_SKIP=${ALLOW_DB_SKIP ? "true — SKIPPED será tolerado em harness:db" : "não definido — banco indisponível é FALHA"}`,
    );
  }

  const resultados = [];
  for (const [nome, arquivo] of lista) {
    resultados.push(await runOne(nome, arquivo));
  }

  const { fail, skip, notrun } = relatorio(resultados, suite);

  if (fail > 0 || notrun > 0) {
    process.exit(1);
  }

  if (skip > 0) {
    if (suite === "all") {
      console.error(
        '\n✖ "all" exige execução completa: houve suíte SKIPPED.\n' +
          "  HARNESS_ALLOW_DB_SKIP não vale aqui — suba o banco ou rode\n" +
          "  harness:core e harness:db separadamente, ciente do que ficou de fora.\n",
      );
      process.exit(1);
    }
    if (suite === "core") {
      console.error('\n✖ Suíte "core" não deveria pular nada — nenhuma depende de banco.\n');
      process.exit(1);
    }
    if (!ALLOW_DB_SKIP) {
      console.error(
        "\n✖ Banco indisponível: as suítes de banco NÃO foram executadas.\n" +
          "  Suba um Postgres local (npx supabase start) ou, ciente de que\n" +
          "  nada será verificado, rode com HARNESS_ALLOW_DB_SKIP=true.\n",
      );
      process.exit(1);
    }
    console.log("\n⚠ SKIPPED tolerado por HARNESS_ALLOW_DB_SKIP=true. Nada foi verificado.\n");
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
