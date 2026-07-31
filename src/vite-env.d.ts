/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Fonte de dados da aplicação: "mock" (offline) ou "supabase". Ver src/lib/data-source.ts */
  readonly VITE_DATA_SOURCE?: "mock" | "supabase";
  /**
   * Origem pública da aplicação (ex.: https://barbaflow.pro). Usada apenas
   * quando não há navegador — no SSR — para montar as URLs de retorno dos
   * e-mails de autenticação. Ver src/lib/auth-redirect.ts
   */
  readonly VITE_PUBLIC_SITE_URL?: string;
}
