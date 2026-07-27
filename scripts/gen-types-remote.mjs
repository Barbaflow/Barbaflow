/**
 * Gera os tipos TypeScript a partir do schema do projeto REMOTO vinculado.
 *
 *   npm run types:remote                 # grava src/integrations/supabase/types.ts
 *   npm run types:remote -- --out X.ts   # grava em outro caminho (comparação)
 *   npm run types:remote -- --check      # não grava; falha se houver diferença
 *
 * Substitui o antigo `gen types --local`, que exigia Docker.
 *
 * Sobre encoding: a saída do CLI é capturada como Buffer e gravada byte a byte.
 * Nada é reencodado e nenhum BOM é adicionado — é o que evita o problema
 * clássico do `supabase gen types ... > types.ts` no PowerShell, onde o
 * redirecionamento grava UTF-16 e quebra o arquivo.
 *
 * Só é escrito um arquivo se a saída realmente parecer os tipos gerados: uma
 * mensagem de erro do CLI jamais substitui types.ts.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  main,
  ROOT,
  requireLinkedProject,
  runSupabaseCli,
  explainCliFailure,
  assinaturasFaltando,
  gravarAtomico,
  redact,
  fail,
} from "./supabase-remote-lib.mjs";

const DEFAULT_OUT = path.join(ROOT, "src", "integrations", "supabase", "types.ts");

function parseArgs(argv) {
  const out = { dest: DEFAULT_OUT, check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") out.check = true;
    else if (argv[i] === "--out") {
      const v = argv[++i];
      if (!v) fail("--out exige um caminho.");
      out.dest = path.resolve(ROOT, v);
    } else fail(`Argumento desconhecido: ${argv[i]}`);
  }
  return out;
}

await main("Geração de tipos a partir do schema remoto", async () => {
  const { dest, check } = parseArgs(process.argv.slice(2));

  // Não exige SUPABASE_DB_PASSWORD: `gen types --linked` usa a API de gestão,
  // autenticada pelo `supabase login`, e não uma conexão direta ao Postgres.
  requireLinkedProject();

  const r = await runSupabaseCli(["gen", "types", "typescript", "--linked"], { capture: true });

  const cliProblem = explainCliFailure(r);
  if (cliProblem) fail(cliProblem);

  if (r.code !== 0) {
    fail(
      `O CLI terminou com código ${r.code}. Nada foi gravado.\n` +
        "  Se for erro de autenticação, rode `npx supabase login` de novo.",
    );
  }

  const buf = r.stdout;
  const texto = buf.toString("utf8");

  const faltando = assinaturasFaltando(texto);
  if (faltando.length > 0) {
    fail(
      "A saída do CLI não parece um arquivo de tipos — nada foi gravado.\n" +
        `  Ausente: ${faltando.join(", ")}\n` +
        `  Primeiros 200 caracteres: ${redact(texto.slice(0, 200))}`,
    );
  }

  if (check) {
    if (!existsSync(dest)) fail(`--check: ${path.relative(ROOT, dest)} não existe.`);
    const atual = readFileSync(dest);
    const igual = Buffer.compare(atual, buf) === 0;
    if (!igual) {
      fail(
        `--check: ${path.relative(ROOT, dest)} está DESATUALIZADO em relação ao schema remoto.\n` +
          `  local: ${atual.length} bytes · remoto: ${buf.length} bytes\n` +
          "  Rode `npm run types:remote` e revise o diff antes de commitar.",
      );
    }
    console.log(`✓ ${path.relative(ROOT, dest)} está em dia com o schema remoto (${buf.length} bytes).`);
    return 0;
  }

  // Bytes crus, sem BOM e sem conversão de encoding — e só depois da validação
  // acima, por troca atômica.
  gravarAtomico(dest, buf);
  console.log(`✓ ${path.relative(ROOT, dest)} gravado — ${buf.length} bytes, UTF-8 sem BOM.`);
  console.log("  Revise o diff antes de commitar: o schema remoto é a fonte da verdade.");
  return 0;
});
