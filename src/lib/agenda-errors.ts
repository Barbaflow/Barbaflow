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

/** SQLSTATEs/mensagens de sessão inválida ou expirada vindos do PostgREST. */
export function isSessionExpired(error: DbErrorLike | null | undefined): boolean {
  const texto = `${error?.message ?? ""}`.toLowerCase();
  return (
    error?.code === "PGRST301" ||
    texto.includes("jwt expired") ||
    texto.includes("invalid claim") ||
    texto.includes("jwt is expired")
  );
}

/** `true` quando o banco recusou por já existir atendimento no intervalo. */
export function isSlotConflict(error: DbErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === EXCLUSION_VIOLATION) return true;
  // Cinto e suspensório: o mock e alguns caminhos não propagam `code`.
  return `${error.message ?? ""}${error.details ?? ""}`.includes(OVERLAP_CONSTRAINT);
}

/**
 * Recusas do trigger `enforce_client_appointment_transition`
 * (migration 20260722230000). O banco levanta um código estável; a interface
 * traduz. Sem isto, a recusa chegaria como texto cru do Postgres.
 */
const RECUSAS_DO_CLIENTE: Record<string, string> = {
  appointment_forbidden: "Este agendamento não é seu.",
  appointment_field_locked:
    "Barbearia, profissional e serviço não podem ser alterados por aqui. Fale com a barbearia.",
  appointment_status_forbidden:
    "Você pode cancelar; concluir ou marcar falta é a barbearia que faz.",
  appointment_not_cancellable: "Este agendamento não está mais ativo, então não há o que cancelar.",
  appointment_cancel_too_late:
    "O prazo de cancelamento desta barbearia já passou. Entre em contato com ela.",
  appointment_not_reschedulable: "Só um agendamento ativo pode ser reagendado.",
  appointment_reschedule_too_late:
    "O prazo de reagendamento desta barbearia já passou. Entre em contato com ela.",
  appointment_reschedule_past: "Escolha um horário futuro.",
  appointment_duration_mismatch: "A duração precisa ser a do serviço contratado.",
  appointment_slot_unavailable: "Esse horário não está disponível na agenda do profissional.",
};

/** Mensagem da recusa do banco para uma ação do cliente, se for uma delas. */
export function clientTransitionMessage(
  error: DbErrorLike | null | undefined,
): string | null {
  const texto = `${error?.message ?? ""}`;
  const chave = Object.keys(RECUSAS_DO_CLIENTE).find((k) => texto.includes(k));
  return chave ? RECUSAS_DO_CLIENTE[chave] : null;
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
  if (isSessionExpired(error)) {
    return {
      title: "Sua sessão expirou",
      description: "Entre novamente para continuar.",
    };
  }
  const recusa = clientTransitionMessage(error);
  if (recusa) return { title: recusa };
  return { title: fallback, description: error?.message ?? undefined };
}
