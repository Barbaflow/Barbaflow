/**
 * Regras dos cards de filtro rápido de `/clientes`.
 *
 * Existem como função pura porque nasceram de três defeitos que só apareciam
 * no SEGUNDO clique — o tipo de coisa que passa despercebido em revisão de JSX
 * e que um harness pega em uma linha. Os handlers da tela ficaram sendo só a
 * ligação entre o clique e estas funções.
 *
 * Os três defeitos, para quem vier depois:
 *
 *   1. os cards de filtro faziam `set(valorFixo)` — atribuição idempotente.
 *      Clicar de novo no card já ativo reescrevia o mesmo valor e o filtro
 *      nunca saía;
 *   2. o card "Clientes" mexia só em `statusFilter`, mas o destaque dele exige
 *      `status === "all" && periodo === "all"`. Com um período ativo, clicar
 *      nele não acendia o card nem limpava o período: clique sem efeito
 *      visível nenhum;
 *   3. "Agendamentos" não tem `onClick`. Não era filtro nenhum — o número dele
 *      é a SOMA de agendamentos, e não a contagem de clientes que os outros
 *      quatro mostram. Virou atalho de ordenação, que é a dimensão que o
 *      código já modelava para essa palavra (`SORT_OPTIONS`).
 */

/** O valor que significa "sem filtro" nos dois eixos de `/clientes`. */
export const SEM_FILTRO = "all";

export type DirecaoDeOrdenacao = "asc" | "desc";

/**
 * Alterna um filtro de seleção única.
 *
 * Clicar no que já está ativo volta ao neutro; clicar em outro troca. É o ramo
 * de volta que faltava — sem ele o card só sabia ligar.
 */
export function alternarFiltro<T extends string>(atual: T, alvo: T, neutro: T): T {
  return atual === alvo ? neutro : alvo;
}

/**
 * O próximo estado de ordenação ao acionar uma coluna.
 *
 * Mesma coluna inverte a direção; coluna nova entra na direção padrão dela.
 * Extraído de `handleSort` para que o card "Agendamentos" e o seletor de
 * ordenação compartilhem a regra em vez de terem duas cópias que divergem.
 */
export function proximaOrdenacao<T extends string>(
  chaveAtual: T,
  direcaoAtual: DirecaoDeOrdenacao,
  alvo: T,
  direcaoPadrao: DirecaoDeOrdenacao,
): { chave: T; direcao: DirecaoDeOrdenacao } {
  if (chaveAtual === alvo) {
    return { chave: alvo, direcao: direcaoAtual === "asc" ? "desc" : "asc" };
  }
  return { chave: alvo, direcao: direcaoPadrao };
}
