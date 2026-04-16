import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useBarbershop } from "./use-barbershop";

/**
 * Auto-assigns "cliente" role when a user logs in on a barbershop's subdomain
 * and doesn't already have any role in that barbershop.
 * Runs once per session.
 */
export function useAutoClientRole() {
  const { user } = useAuth();
  const { barbershopId, isDefault, loading } = useBarbershop();
  const assignedRef = useRef(false);

  useEffect(() => {
    if (!user || loading || isDefault || assignedRef.current) return;

    assignedRef.current = true;

    (async () => {
      // Check if user already has a role in this barbershop
      const { data: existing } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("barbershop_id", barbershopId)
        .limit(1)
        .maybeSingle();

      if (existing) return; // Already has a role

      // Auto-assign cliente role
      await supabase.from("user_roles").insert({
        user_id: user.id,
        barbershop_id: barbershopId,
        role: "cliente" as const,
      });
    })();
  }, [user, barbershopId, isDefault, loading]);
}
