/**
 * Utilitários compartilhados da interface de comandas.
 *
 * A fonte de verdade dos valores (subtotal, desconto, total) e das validações
 * é SEMPRE o banco (triggers + RPCs open_ticket/close_ticket). Aqui ficam
 * apenas formatação e a tradução dos erros do banco para linguagem de tela.
 */

export type TicketStatus = "aberta" | "fechada" | "cancelada";

/** Formata um número em BRL. Coage strings numéricas vindas do `numeric`. */
export function fmtBRL(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  return (Number.isFinite(n) ? n : 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Identificador curto e estável da comanda (8 primeiros do uuid). */
export function shortTicketId(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

interface StatusMeta {
  label: string;
  /** Classe de badge (borda/fundo/texto). */
  badgeClass: string;
}

export const TICKET_STATUS_META: Record<TicketStatus, StatusMeta> = {
  aberta: {
    label: "Aberta",
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
  },
  fechada: {
    label: "Fechada",
    badgeClass: "border-green-500/40 bg-green-500/10 text-green-500",
  },
  cancelada: {
    label: "Cancelada",
    badgeClass: "border-muted-foreground/40 bg-muted-foreground/10 text-muted-foreground",
  },
};

/**
 * Traduz as mensagens de erro das RPCs/triggers de comanda (ERRCODE + texto)
 * para algo acionável na interface. Mantém a mensagem original como fallback.
 */
export function friendlyTicketError(raw: unknown): string {
  const m =
    raw instanceof Error
      ? raw.message
      : typeof raw === "string"
        ? raw
        : String((raw as { message?: string })?.message ?? raw ?? "");

  if (/nao_autenticado|not.?authenticated|JWT|session/i.test(m))
    return "Sua sessão expirou. Entre novamente para continuar.";
  if (/estoque_insuficiente/.test(m))
    return "Estoque insuficiente para um dos produtos. Reduza a quantidade e tente novamente.";
  if (/produto_inativo/.test(m))
    return "Um dos produtos ficou inativo. Remova-o da comanda.";
  if (/tenant_invalido/.test(m))
    return "Um item não pertence a esta barbearia. Recarregue e tente de novo.";
  if (/comanda_ja_fechada/.test(m))
    return "Este agendamento já possui uma comanda fechada.";
  if (/comanda_sem_itens/.test(m))
    return "Adicione ao menos um item antes de fechar a comanda.";
  if (/comanda_nao_aberta|comanda_imutavel/.test(m))
    return "Esta comanda não está mais aberta (pode ter sido fechada ou cancelada em outra tela).";
  if (/forbidden|insufficient_privilege|permission denied|row-level security|MOCK_FORBIDDEN/i.test(m))
    return "Você não tem permissão para esta ação nesta barbearia.";
  if (/barber_id obrigat/.test(m))
    return "Selecione o profissional responsável pela comanda.";
  if (/comanda inexistente|no_data_found/.test(m))
    return "Comanda não encontrada. Ela pode ter sido removida.";
  return m || "Não foi possível concluir a operação.";
}
