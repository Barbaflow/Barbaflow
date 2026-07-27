/**
 * Lint do schema contra o projeto REMOTO vinculado.
 *
 *   npm run db:lint:remote
 *
 * Somente leitura: o linter do Postgres aponta problemas de segurança e de
 * definição (view com SECURITY DEFINER, função sem search_path fixo, tabela
 * exposta sem RLS). Não altera nada.
 *
 * Substitui o antigo `db lint --local`, que exigia Docker.
 */
import {
  main,
  requireLinkedProject,
  requireDbPassword,
  runSupabaseCli,
  explainCliFailure,
  fail,
} from "./supabase-remote-lib.mjs";

// Nível mínimo reportado. `warning` mostra também o que ainda não é erro.
const LEVEL = process.env.SUPABASE_LINT_LEVEL?.trim() || "warning";

await main(`Lint do schema remoto (nível: ${LEVEL})`, async () => {
  requireLinkedProject();
  requireDbPassword();

  const r = await runSupabaseCli(["db", "lint", "--linked", "--level", LEVEL]);

  const cliProblem = explainCliFailure(r);
  if (cliProblem) fail(cliProblem);

  if (r.code !== 0) {
    fail(
      `O linter terminou com código ${r.code}.\n` +
        "  Um código != 0 pode significar achados de lint OU falha de conexão —\n" +
        "  leia a saída acima antes de concluir.",
    );
  }

  return 0;
});
