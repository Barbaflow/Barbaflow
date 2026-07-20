/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Fonte de dados da aplicação: "mock" (offline) ou "supabase". Ver src/lib/data-source.ts */
  readonly VITE_DATA_SOURCE?: "mock" | "supabase";
}
