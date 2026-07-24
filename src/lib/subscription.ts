/**
 * Estados da assinatura SaaS da barbearia (espelham o Paddle Billing) e helpers
 * de apresentação. A assinatura pertence à BARBEARIA; o entitlement efetivo é o
 * `plan` (barbershops.plan_id). Aqui só traduzimos o status para a interface.
 */

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled" | "paused";

/** Linha devolvida por get_barbershop_subscription. */
export interface BarbershopSubscription {
  status: SubscriptionStatus | string;
  price_id: string;
  environment: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  trial_end: string | null;
  updated_at: string | null;
}

/** Estado de exibição consolidado — combina plano + assinatura. */
export type BillingView =
  | "free" // sem assinatura paga
  | "active"
  | "trialing"
  | "past_due"
  | "cancel-scheduled" // ativa, mas cancelamento no fim do período
  | "canceled"
  | "paused";

export function resolveBillingView(
  planName: string,
  sub: BarbershopSubscription | null,
): BillingView {
  if (!sub || sub.status === "canceled") {
    // Sem assinatura corrente: é free (o plano pode ter voltado a free no cancel).
    return planName === "free" ? "free" : sub?.status === "canceled" ? "canceled" : "free";
  }
  if (sub.status === "active" && sub.cancel_at_period_end) return "cancel-scheduled";
  if (sub.status === "past_due") return "past_due";
  if (sub.status === "trialing") return "trialing";
  if (sub.status === "paused") return "paused";
  return "active";
}

interface ViewMeta {
  label: string;
  tone: "neutral" | "good" | "warn" | "danger";
  hint: string;
}

export const BILLING_VIEW_META: Record<BillingView, ViewMeta> = {
  free: { label: "Plano Free", tone: "neutral", hint: "Sem cobrança recorrente." },
  active: { label: "Assinatura ativa", tone: "good", hint: "Renovação automática no fim do período." },
  trialing: { label: "Período de teste", tone: "good", hint: "Você está no período de avaliação." },
  "past_due": {
    label: "Pagamento atrasado",
    tone: "warn",
    hint: "A última cobrança falhou. Regularize para manter o plano.",
  },
  "cancel-scheduled": {
    label: "Cancelamento programado",
    tone: "warn",
    hint: "O plano permanece até o fim do período atual e depois volta para Free.",
  },
  canceled: { label: "Assinatura cancelada", tone: "danger", hint: "A barbearia voltou para o plano Free." },
  paused: { label: "Assinatura pausada", tone: "warn", hint: "A cobrança está temporariamente pausada." },
};

/** Data pt-BR curta (dd/mm/aaaa) de um timestamp ISO, sem depender de fuso. */
export function fmtDateBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
