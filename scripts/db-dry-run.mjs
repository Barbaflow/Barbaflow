/**
 * Simula o envio das migrations pendentes ao projeto REMOTO vinculado.
 *
 *   npm run db:dry-run
 *
 * `--dry-run` NÃO escreve no banco: o CLI apenas lista o que aplicaria. É a
 * etapa obrigatória antes de qualquer `db push` real — e o push real é sempre
 * manual, com autorização explícita. Este repositório não expõe um script de
 * push justamente para que ninguém o execute por reflexo.
 */
import {
  main,
  requireLinkedProject,
  requireDbPassword,
  runSupabaseCli,
  explainCliFailure,
  EXPECTED_PROJECT_REF,
  fail,
} from "./supabase-remote-lib.mjs";

await main("Simulação de push de migrations (nada é escrito)", async () => {
  requireLinkedProject();
  requireDbPassword();

  const r = await runSupabaseCli(["db", "push", "--linked", "--dry-run"]);

  const cliProblem = explainCliFailure(r);
  if (cliProblem) fail(cliProblem);

  if (r.code !== 0) {
    fail(
      `A simulação terminou com código ${r.code}.\n` +
        "  Resolva a causa antes de pensar em push real.\n" +
        "  Se o histórico divergiu, comece por `npm run db:status:remote` —\n" +
        "  nunca por `migration repair` às cegas.",
    );
  }

  console.log(
    "\n────────────────────────────────────────────────────────────────\n" +
      "Nada foi escrito no banco remoto.\n\n" +
      "Para aplicar de verdade, com autorização explícita, rode À MÃO:\n" +
      `  npx supabase db push --linked   # projeto ${EXPECTED_PROJECT_REF}\n\n` +
      "Nunca use `db reset --linked`: ele APAGA o banco remoto.\n" +
      "────────────────────────────────────────────────────────────────\n",
  );
  return 0;
});
