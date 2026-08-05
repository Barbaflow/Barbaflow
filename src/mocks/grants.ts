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
 * renderizar diferente (§8 do CLAUDE.md). Sem ela, o teste negativo da fase 2
 * de `barbershops` seria indistinguível de "a barbearia não existe".
 *
 * Existe para que a fase 2 (`REVOKE SELECT ON public.barbershops FROM anon`)
 * possa ser exercitada SEM banco, antes de ser aplicada: o harness liga o
 * REVOKE, roda o caminho anônimo inteiro e verifica que a vitrine
 * (`barbearias_publicas`, que passou a ler como o dono) e a RPC
 * (`get_public_barbers_v2`, SECURITY DEFINER) continuam de pé enquanto o acesso
 * direto à tabela larga passa a ser negado.
 *
 * Só o papel anônimo é afetado, como no SQL: com sessão ativa a leitura segue
 * pela policy "Anyone can view approved barbershops", que a fase 2 não toca.
 */

/** Tabelas cujo `SELECT` está revogado do `anon` nesta execução. */
const selectRevogadoDoAnon = new Set<string>();

/** Liga a simulação de `REVOKE SELECT ON <table> FROM anon`. */
export function revokeAnonSelect(table: string): void {
  selectRevogadoDoAnon.add(table);
}

/** Desfaz a simulação — equivale ao `GRANT SELECT … TO anon` do rollback. */
export function grantAnonSelect(table: string): void {
  selectRevogadoDoAnon.delete(table);
}

/** Devolve todas as tabelas ao estado concedido. */
export function resetAnonGrants(): void {
  selectRevogadoDoAnon.clear();
}

/** `true` quando o `anon` NÃO tem `SELECT` na tabela. */
export function anonSelectRevoked(table: string): boolean {
  return selectRevogadoDoAnon.has(table);
}
