/**
 * Fonte de dados da aplicação.
 *
 * Lê VITE_DATA_SOURCE e resolve para "mock" (dados fictícios locais) ou
 * "supabase" (banco real). Este módulo não acessa URL nem chave do Supabase —
 * a decisão de qual cliente construir fica em src/integrations/supabase/client.ts.
 */

export const DATA_SOURCES = ["mock", "supabase"] as const;

export type DataSource = (typeof DATA_SOURCES)[number];

const DEFAULT_DATA_SOURCE: DataSource = "supabase";

function isDataSource(value: string): value is DataSource {
  return (DATA_SOURCES as readonly string[]).includes(value);
}

function resolveDataSource(): DataSource {
  // ImportMetaEnv declara o valor como DataSource, mas em runtime é uma string
  // arbitrária vinda do .env — alargamos o tipo para poder validar de fato.
  const raw: string | undefined = import.meta.env.VITE_DATA_SOURCE;

  // Variável ausente (ou string vazia): mantém o comportamento padrão.
  if (raw === undefined || raw === "") return DEFAULT_DATA_SOURCE;

  if (isDataSource(raw)) return raw;

  console.warn(
    `[data-source] VITE_DATA_SOURCE="${raw}" é inválido. ` +
      `Valores aceitos: ${DATA_SOURCES.join(", ")}. Usando "${DEFAULT_DATA_SOURCE}".`,
  );

  return DEFAULT_DATA_SOURCE;
}

/** Fonte de dados resolvida uma única vez no carregamento do módulo. */
export const dataSource: DataSource = resolveDataSource();

/** `true` quando a aplicação roda offline, com dados fictícios. */
export const isMockDataSource: boolean = dataSource === "mock";
