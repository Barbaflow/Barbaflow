/**
 * Contrato de saída dos harnesses que exigem PostgreSQL real.
 *
 * Três suítes validam triggers, constraints e concorrência de verdade — coisas
 * que só um banco prova. Elas rodam via `docker exec` contra um Postgres local.
 * No fluxo remote-first (docs/DESENVOLVIMENTO_REMOTO.md) o Docker é opcional,
 * então esse banco pode simplesmente não existir.
 *
 * O erro que este módulo existe para impedir: banco ausente → suíte não roda →
 * processo sai 0 → o log lê-se como "tudo verde". Uma suíte que não executou
 * não passou; ela não aconteceu.
 *
 * Por isso o código de saída distingue os três estados:
 *
 *   0   PASS     — a suíte rodou e todas as verificações passaram
 *   1   FAIL     — a suíte rodou e algo falhou
 *   78  SKIPPED  — a suíte NÃO rodou (banco indisponível); nada foi verificado
 *
 * Quem decide se um SKIPPED é aceitável é o runner (scripts/run-harness-suite.mjs),
 * não a suíte: `harness:db` aceita com HARNESS_ALLOW_DB_SKIP=true; `harness:all`
 * nunca aceita — ele só fica verde quando tudo executou de fato.
 *
 * Estas suítes nunca devem apontar para o projeto remoto compartilhado: elas
 * escrevem, alteram e apagam dados.
 */

/** Código de saída que significa "a suíte não foi executada". */
export const EXIT_SKIPPED = 78;

/** Imprime o aviso e encerra o processo sinalizando SKIPPED. */
export function pularPorFaltaDeBanco(container, detalhe = "") {
  const linha = "─".repeat(70);

  process.stdout.write(
    `\n${linha}\n` +
      `SKIPPED — suíte NÃO executada: Postgres local indisponível\n` +
      `          (container "${container}")\n\n` +
      "Nada foi verificado. Isto não é um resultado verde.\n\n" +
      "Esta suíte precisa de um banco real e não faz parte do fluxo\n" +
      "remote-first. Para rodá-la, suba um stack local:\n" +
      "    npx supabase start\n\n" +
      "Ela nunca deve ser apontada para o projeto remoto compartilhado:\n" +
      "escreve, altera e apaga dados.\n" +
      (detalhe ? `\n${detalhe}\n` : "") +
      `${linha}\n`,
  );

  process.exit(EXIT_SKIPPED);
}
