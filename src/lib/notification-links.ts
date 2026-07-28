/**
 * Destino de cada tipo de notificação.
 *
 * Decisão pura, sem rede e sem React, para poder ser exercitada pelo harness.
 *
 * Duas regras que valem para todos os casos:
 *
 *   1. Tipo desconhecido devolve `null` — a notificação continua aparecendo e
 *      podendo ser marcada como lida, apenas não navega. Um tipo novo criado no
 *      banco nunca quebra a interface.
 *   2. Nenhum destino é montado a partir de texto da notificação. As rotas são
 *      literais fixas; o único parâmetro dinâmico (o slug da barbearia, em
 *      `review_reply`) vem de uma consulta ao banco, não do conteúdo da linha.
 *      Não há como uma notificação forjada mandar o usuário para outro lugar.
 *
 * Autorização continua sendo do destino: `/agenda`, `/comandas` e `/relatorios`
 * têm os próprios guardas de papel e tenant. Este módulo decide para onde ir,
 * não quem pode entrar.
 */

/** Papel de quem está lendo — o mesmo tipo pode ter destinos diferentes. */
export type NotificationPerspective = "staff" | "client";

export type NotificationDestination =
  /** Rota literal, sem parâmetros. */
  | { kind: "route"; to: string }
  /** Precisa resolver a barbearia e a avaliação antes de navegar. */
  | { kind: "review" }
  /** Sem destino conhecido: a notificação não é clicável. */
  | null;

/** Tipos que o banco realmente produz hoje (triggers das migrations 2026-04). */
export const NOTIFICATION_TYPES = [
  "new_appointment",
  "appointment_confirmed",
  "appointment_cancelled",
  "appointment_completed",
  "appointment_rescheduled",
  "review_reply",
  "noshow_blocked",
  "noshow_unblocked",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isKnownNotificationType(type: unknown): type is NotificationType {
  return typeof type === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/**
 * Para onde levar ao clicar.
 *
 * `appointment_cancelled` e `appointment_rescheduled` vão para os dois lados —
 * cliente e profissional recebem o mesmo tipo. Por isso a perspectiva é
 * obrigatória: ela vem de onde o sino está montado (painéis = staff, área do
 * cliente = client), não de um palpite sobre o conteúdo.
 */
export function resolveNotificationDestination(
  type: unknown,
  perspective: NotificationPerspective,
): NotificationDestination {
  if (!isKnownNotificationType(type)) return null;

  const staff = perspective === "staff";

  switch (type) {
    // Só chega para profissional e admin.
    case "new_appointment":
      return staff ? { kind: "route", to: "/agenda" } : null;

    // Só chega para o cliente.
    case "appointment_confirmed":
    case "appointment_completed":
      return staff ? null : { kind: "route", to: "/meus-agendamentos" };

    // Chega para os dois lados — o destino depende de quem lê.
    case "appointment_cancelled":
    case "appointment_rescheduled":
      return staff
        ? { kind: "route", to: "/agenda" }
        : { kind: "route", to: "/meus-agendamentos" };

    // Bloqueio por faltas: assunto do cliente.
    case "noshow_blocked":
    case "noshow_unblocked":
      return staff ? null : { kind: "route", to: "/meus-agendamentos" };

    case "review_reply":
      return { kind: "review" };
  }
}

/** Um UUID v4 do Postgres. Usado para não navegar com id malformado. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * Slug de barbearia aceito na URL pública. Restrito de propósito: mesmo vindo
 * do banco, é o único trecho de rota montado dinamicamente.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSubdomain(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value);
}
