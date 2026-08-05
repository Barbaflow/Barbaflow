/**
 * Simulação de GRANT/REVOKE de tabela para o papel `anon`.
 *
 * O mock sempre modelou POLICY (que linhas o ator enxerga). Não modelava
 * GRANT — e os dois são camadas diferentes, com resultados diferentes:
 *
 *   • policy que não casa  → 200 com lista VAZIA;
 *   • privilégio ausente   → 42501 `permission denied for table …`, sem linha
 *                            nenhuma, e o PostgREST responde ERRO.
 *
 * A distinção importa porque "não carregou" e "não tem nada" precisam
 * renderizar diferente (§8 do CLAUDE.md). Sem ela, um teste negativo é
 * indistinguível de "não existe esse dado".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO DEIXOU DE SER UM INTERRUPTOR DE TESTE E VIROU O PADRÃO
 *
 * Nasceu para exercitar o `REVOKE SELECT ON barbershops FROM anon` (fase 2,
 * 20260805130000) sem banco. Virou o comportamento padrão do mock por um motivo
 * concreto: a consulta de notas por profissional de `PublicBookingWizard` era
 * IMPOSSÍVEL contra o Supabase real — `anon` nunca teve SELECT em
 * `appointments` — e mesmo assim passava offline, porque o mock resolvia o
 * embed lendo o store direto, sem checar privilégio. O defeito atravessou a
 * revisão inteira da superfície pública por causa disso.
 *
 * Agora o mock recusa, sem sessão, qualquer leitura fora da lista abaixo — que
 * é a lista REAL, conferida no projeto remoto em 05/08/2026:
 *
 *     SELECT c.relname, has_table_privilege('anon', c.oid, 'SELECT')
 *       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 *      WHERE n.nspname = 'public' AND c.relkind IN ('r','v');
 *
 * A checagem vale também para tabela alcançada por EMBED: no PostgREST o
 * privilégio é exigido de cada relação do plano, não só da que está no `from`.
 */

/**
 * Objetos que o papel `anon` PODE ler no projeto remoto. Qualquer outro devolve
 * 42501 quando não há sessão.
 *
 * `barbershops` NÃO está aqui: a fase 2 revogou o SELECT do anônimo, e o mock
 * reflete o banco de hoje. O caminho público lê `barbearias_publicas`.
 * `products` também não: saiu em 20260730120000, e a leitura passou a ser por
 * `get_public_products`.
 */
const LEITURA_ANONIMA_PERMITIDA = new Set([
  "availability",
  "barbearias_publicas",
  "plans",
  "reviews",
  "services",
]);

/** Ajustes pontuais desta execução (testes de REVOKE/GRANT). */
const concedidasNaExecucao = new Set<string>();
const revogadasNaExecucao = new Set<string>();

/** Simula `REVOKE SELECT ON <table> FROM anon` a partir de agora. */
export function revokeAnonSelect(table: string): void {
  revogadasNaExecucao.add(table);
  concedidasNaExecucao.delete(table);
}

/**
 * Simula `GRANT SELECT ON <table> TO anon`. É o que permite exercitar o estado
 * ANTERIOR a um REVOKE já aplicado — por exemplo, provar que o rollback
 * documentado no rodapé de uma migration devolve mesmo o acesso.
 */
export function grantAnonSelect(table: string): void {
  concedidasNaExecucao.add(table);
  revogadasNaExecucao.delete(table);
}

/** Volta ao mapa real de privilégios, desfazendo os ajustes da execução. */
export function resetAnonGrants(): void {
  concedidasNaExecucao.clear();
  revogadasNaExecucao.clear();
}

/** `true` quando o `anon` NÃO tem `SELECT` no objeto. */
export function anonSelectRevoked(table: string): boolean {
  if (concedidasNaExecucao.has(table)) return false;
  if (revogadasNaExecucao.has(table)) return true;
  return !LEITURA_ANONIMA_PERMITIDA.has(table);
}

/** A lista real, para o harness afirmar sobre ela em vez de repeti-la. */
export function tabelasLegiveisPorAnon(): string[] {
  return [...LEITURA_ANONIMA_PERMITIDA].sort();
}
