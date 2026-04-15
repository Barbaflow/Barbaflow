import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBarbershop } from "./use-barbershop";

interface PlanInfo {
  planName: "free" | "pro" | "enterprise";
  appointmentLimit: number | null;
  appointmentsUsed: number;
  hasSubscriptions: boolean;
  price: number;
  loading: boolean;
}

export function usePlan(): PlanInfo {
  const { barbershop, barbershopId } = useBarbershop();
  const [planInfo, setPlanInfo] = useState<PlanInfo>({
    planName: "free",
    appointmentLimit: 50,
    appointmentsUsed: 0,
    hasSubscriptions: false,
    price: 0,
    loading: true,
  });

  useEffect(() => {
    if (!barbershopId) return;

    const fetchPlan = async () => {
      const { data } = await supabase
        .from("plans")
        .select("*")
        .eq("id", barbershop?.plan_id ?? "")
        .single();

      setPlanInfo({
        planName: (data?.name as PlanInfo["planName"]) ?? "free",
        appointmentLimit: data?.appointment_limit ?? 50,
        appointmentsUsed: (barbershop as any)?.appointments_this_month ?? 0,
        hasSubscriptions: data?.has_subscriptions ?? false,
        price: Number(data?.price ?? 0),
        loading: false,
      });
    };

    fetchPlan();

    // Realtime subscription for counter updates
    const channel = supabase
      .channel("barbershop-plan")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "barbershops",
          filter: `id=eq.${barbershopId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          setPlanInfo((prev) => ({
            ...prev,
            appointmentsUsed: updated.appointments_this_month ?? prev.appointmentsUsed,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barbershopId, barbershop?.plan_id]);

  return planInfo;
}

export function usePlanUsagePercent() {
  const { appointmentLimit, appointmentsUsed } = usePlan();
  if (!appointmentLimit) return 0;
  return Math.round((appointmentsUsed / appointmentLimit) * 100);
}
