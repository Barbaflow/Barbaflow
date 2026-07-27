/**
 * Situação das migrations no projeto REMOTO vinculado.
 *
 *   npm run db:status:remote
 *
 * Somente leitura: lista o que já foi aplicado lá e o que existe só aqui.
 * É o primeiro comando a rodar quando o histórico parece divergente — antes de
 * cogitar qualquer `migration repair`.
 */
import {
  main,
  requireLinkedProject,
  requireDbPassword,
  runSupabaseCli,
  explainCliFailure,
  fail,
} from "./supabase-remote-lib.mjs";

await main("Migrations do projeto remoto (somente leitura)", async () => {
  requireLinkedProject();
  requireDbPassword();

  const r = await runSupabaseCli(["migration", "list", "--linked"]);

  const cliProblem = explainCliFailure(r);
  if (cliProblem) fail(cliProblem);

  if (r.code !== 0) {
    fail(
      `O CLI terminou com código ${r.code}.\n` +
        "  Se for erro de autenticação, rode `npx supabase login` de novo.\n" +
        "  Se a senha do banco mudou, atualize SUPABASE_DB_PASSWORD.",
    );
  }

  console.log(
    "\nLegenda: uma migration presente em Local e ausente em Remote ainda\n" +
      "não foi aplicada — revise com `npm run db:dry-run` antes de qualquer push.\n",
  );
  return 0;
});
