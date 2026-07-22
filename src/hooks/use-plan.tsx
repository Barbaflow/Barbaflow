import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBarbershop } from "./use-barbershop";

interface PlanInfo {
  planName: "free" | "pro" | "enterprise";
  appointmentLimit: number | null;
  appointmentsUsed: number;
  barberLimit: number | null;
  hasSubscriptions: boolean;
  price: number;
  loading: boolean;
}

const UNRESOLVED: PlanInfo = {
  planName: "free",
  appointmentLimit: 50,
  appointmentsUsed: 0,
  barberLimit: 1,
  hasSubscriptions: false,
  price: 0,
  loading: true,
};

/**
 * Plano de uma barbearia.
 *
 * `barbershopIdOverride` existe para as telas que operam um tenant explícito
 * (super_admin abrindo `?barbershop=<uuid>`): sem ele, o limite de
 * profissionais e o nome do plano vinham do tenant do PRÓPRIO usuário e a tela
 * misturava dados de duas barbearias. Sem override, vale o tenant resolvido —
 * e `null` (nenhum tenant) mantém o estado de carregamento, nunca um plano
 * inventado.
 */
export function usePlan(barbershopIdOverride?: string | null): PlanInfo {
  const { barbershop, resolvedBarbershopId, tenantStatus } = useBarbershop();
  const tenantId = barbershopIdOverride ?? resolvedBarbershopId;
  // Quando o tenant pedido é o do contexto, plano e uso já estão em memória.
  const isContextTenant = Boolean(tenantId) && tenantId === barbershop?.id;
  const contextPlanId = isContextTenant ? (barbershop?.plan_id ?? null) : null;
  const contextUsed = isContextTenant ? (barbershop?.appointments_this_month ?? 0) : 0;

  const [planInfo, setPlanInfo] = useState<PlanInfo>(UNRESOLVED);

  useEffect(() => {
    if (!tenantId) {
      // Sem tenant não há plano a consultar. Enquanto a resolução acontece
      // seguimos em `loading`; quando ela termina sem barbearia, assumimos o
      // padrão do produto (free) — sem inventar um id para consultar.
      setPlanInfo({ ...UNRESOLVED, loading: tenantStatus === "loading" });
      return;
    }

    let cancelled = false;

    const fetchPlan = async () => {
      // Tenant de outra barbearia (seleção do super_admin): o contexto não tem
      // a linha, então buscamos plano e uso direto pelo id pedido.
      let planId = contextPlanId;
      let used = contextUsed;

      if (!contextPlanId) {
        const { data: shop } = await supabase
          .from("barbershops")
          .select("plan_id, appointments_this_month")
          .eq("id", tenantId)
          .maybeSingle();
        if (cancelled) return;
        planId = shop?.plan_id ?? null;
        used = shop?.appointments_this_month ?? 0;
      }

      if (!planId) {
        // Barbearia sem plano gravado: o padrão do produto é free.
        if (!cancelled) setPlanInfo({ ...UNRESOLVED, appointmentsUsed: used, loading: false });
        return;
      }

      const { data } = await supabase.from("plans").select("*").eq("id", planId).maybeSingle();
      if (cancelled) return;

      setPlanInfo({
        planName: (data?.name as PlanInfo["planName"]) ?? "free",
        appointmentLimit: data?.appointment_limit ?? null,
        appointmentsUsed: used,
        barberLimit: data?.barber_limit ?? null,
        hasSubscriptions: data?.has_subscriptions ?? false,
        price: Number(data?.price ?? 0),
        loading: false,
      });
    };

    fetchPlan();

    const channel = supabase
      .channel(`barbershop-plan-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "barbershops",
          filter: `id=eq.${tenantId}`,
        },
        (payload) => {
          const updated = payload.new as { appointments_this_month?: number };
          setPlanInfo((prev) => ({
            ...prev,
            appointmentsUsed: updated.appointments_this_month ?? prev.appointmentsUsed,
          }));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tenantId, contextPlanId, contextUsed, tenantStatus]);

  return planInfo;
}

export function usePlanUsagePercent() {
  const { appointmentLimit, appointmentsUsed } = usePlan();
  if (!appointmentLimit) return 0;
  return Math.round((appointmentsUsed / appointmentLimit) * 100);
}

/** Check if the current plan allows a feature */
export function useCanAccessFeature(feature: "reports" | "team_unlimited") {
  const { planName, loading } = usePlan();
  if (loading) return { canAccess: false, loading: true };

  switch (feature) {
    case "reports":
      return { canAccess: planName !== "free", loading: false };
    case "team_unlimited":
      return { canAccess: planName !== "free", loading: false };
    default:
      return { canAccess: true, loading: false };
  }
}
