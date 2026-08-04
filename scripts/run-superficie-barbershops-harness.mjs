/**
 * Executa o harness da superfície pública de `barbershops`. Usa o Vite já
 * instalado apenas para resolver o alias `@` e compilar TypeScript sob demanda
 * (ssrLoadModule) — nenhuma dependência nova.
 *
 *   node scripts/run-superficie-barbershops-harness.mjs
 */
import { createServer } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class MemoryStorage {
  #map = new Map();
  get length() { return this.#map.size; }
  key(i) { return Array.from(this.#map.keys())[i] ?? null; }
  getItem(k) { return this.#map.has(String(k)) ? this.#map.get(String(k)) : null; }
  setItem(k, v) { this.#map.set(String(k), String(v)); }
  removeItem(k) { this.#map.delete(String(k)); }
  clear() { this.#map.clear(); }
}

const storage = new MemoryStorage();
globalThis.localStorage = storage;
globalThis.window = { localStorage: storage };

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
    const mod = await server.ssrLoadModule(
      "/src/mocks/__harness__/superficie-publica-barbershops-harness.ts",
    );
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
