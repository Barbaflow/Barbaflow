/**
 * Executa o harness das rotas de cron (/hooks/*). Usa o Vite já instalado
 * apenas para resolver o alias `@` e compilar TypeScript sob demanda
 * (ssrLoadModule) — nenhuma dependência nova.
 *
 *   node scripts/run-cron-endpoints-harness.mjs
 */
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { "@": path.resolve(root, "src") } },
  });

  try {
    const mod = await server.ssrLoadModule("/src/mocks/__harness__/cron-endpoints-harness.ts");
    const outcome = await mod.runHarness();
    console.log(outcome.report);
    process.exitCode = outcome.failed > 0 ? 1 : 0;
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
