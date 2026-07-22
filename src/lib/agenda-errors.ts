/**
 * Tradução dos erros da agenda que vêm do banco.
 *
 * A prevenção final de conflito é a constraint `appointments_no_overlap_per_barber`
 * (migration 20260722180000). Quando duas pessoas disputam o mesmo horário, o
 * perdedor recebe SQLSTATE 23P01 — que sem tradução chegaria à tela como um
 * texto do Postgres. Estas funções existem para que a interface diga o que de
 * fato aconteceu ("alguém pegou esse horário agora"), e não "erro ao agendar".
 */

/** SQLSTATE de violação de constraint EXCLUDE. */
const EXCLUSION_VIOLATION = "23P01";

/** Nome da constraint que impede sobreposição por profissional. */
const OVERLAP_CONSTRAINT = "appointments_no_overlap_per_barber";

interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

/** `true` quando o banco recusou por já existir atendimento no intervalo. */
export function isSlotConflict(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === EXCLUSION_VIOLATION) return true;
  // Cinto e suspensório: o mock e alguns caminhos não propagam `code`.
  return `${error.message ?? ""}${error.details ?? ""}`.includes(OVERLAP_CONSTRAINT);
}

export const SLOT_CONFLICT_TITLE = "Esse horário acabou de ser ocupado";
export const SLOT_CONFLICT_DESCRIPTION =
  "Outra pessoa reservou este horário enquanto você preenchia. Escolha outro horário — a lista já foi atualizada.";

/**
 * Mensagem final para o usuário. Conflito tem texto próprio; qualquer outra
 * falha mostra a mensagem real do banco em vez de um genérico que esconde a
 * causa (recusa de RLS, limite do plano, bloqueio por no-show…).
 */
export function agendaErrorMessage(
  error: DbErrorLike | null | undefined,
  fallback: string,
): { title: string; description?: string } {
  if (isSlotConflict(error)) {
    return { title: SLOT_CONFLICT_TITLE, description: SLOT_CONFLICT_DESCRIPTION };
  }
  return { title: fallback, description: error?.message ?? undefined };
}
