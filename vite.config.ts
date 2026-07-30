// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only),
//     VITE_* env injection, @ path alias, React/TanStack dedupe, error logger
//     plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
//
// DEPLOY — por que este arquivo continua sem opções:
// A partir da v2 o wrapper substituiu o plugin do Cloudflare pelo Nitro. O Nitro
// escolhe o preset a partir do ambiente do build:
//   - na Vercel (VERCEL=1)  → preset `vercel`, saída em .vercel/output (Build
//                             Output API v3), consumida pela plataforma sozinha;
//   - fora dela             → `defaultPreset: "cloudflare-module"` do wrapper,
//                             mantendo o fallback Cloudflare de `wrangler.jsonc`.
// Fixar um preset aqui quebraria um dos dois alvos. Para reproduzir o build da
// Vercel localmente: `$env:VERCEL = "1"; npm run build`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig();
