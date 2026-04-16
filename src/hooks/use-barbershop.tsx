import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_BARBERSHOP_ID } from "@/lib/constants";
import type { Tables } from "@/integrations/supabase/types";

type Barbershop = Tables<"barbershops">;

interface BarbershopContextValue {
  barbershop: Barbershop | null;
  barbershopId: string;
  loading: boolean;
  isDefault: boolean; // true when using fallback (no subdomain matched)
}

const BarbershopContext = createContext<BarbershopContextValue>({
  barbershop: null,
  barbershopId: DEFAULT_BARBERSHOP_ID,
  loading: true,
  isDefault: true,
});

/**
 * Extracts subdomain from hostname.
 */
function extractSubdomain(): string | null {
  if (typeof window === "undefined") return null;

  const hostname = window.location.hostname;

  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  const parts = hostname.split(".");

  if (parts.length < 3) return null;

  const subdomain = parts[0];

  if (["www", "app", "api", "admin"].includes(subdomain)) return null;

  if (subdomain.includes("preview--")) return null;

  return subdomain;
}

export function BarbershopProvider({ children }: { children: React.ReactNode }) {
  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDefault, setIsDefault] = useState(true);

  useEffect(() => {
    const subdomain = extractSubdomain();

    if (subdomain) {
      supabase
        .from("barbershops")
        .select("*")
        .eq("subdomain", subdomain)
        .eq("status", "approved")
        .single()
        .then(({ data, error }) => {
          if (data && !error) {
            setBarbershop(data);
            setIsDefault(false);
            setLoading(false);
          } else {
            resolveFromUserRoles();
          }
        });
    } else {
      resolveFromUserRoles();
    }
  }, []);

  // Subscribe to realtime updates on the resolved barbershop
  useEffect(() => {
    if (!barbershop?.id) return;

    const channel = supabase
      .channel(`barbershop-context-${barbershop.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "barbershops",
          filter: `id=eq.${barbershop.id}`,
        },
        (payload) => {
          setBarbershop((prev) => prev ? { ...prev, ...payload.new } as Barbershop : prev);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barbershop?.id]);

  async function resolveFromUserRoles() {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("barbershop_id")
        .eq("user_id", user.id)
        .in("role", ["admin_barbearia", "barbeiro"])
        .neq("barbershop_id", "00000000-0000-0000-0000-000000000000")
        .limit(1)
        .maybeSingle();

      if (roleData?.barbershop_id) {
        const { data: shop } = await supabase
          .from("barbershops")
          .select("*")
          .eq("id", roleData.barbershop_id)
          .single();

        if (shop) {
          setBarbershop(shop);
          setIsDefault(false);
          setLoading(false);
          return;
        }
      }

      const { data: ownedShop } = await supabase
        .from("barbershops")
        .select("*")
        .eq("owner_id", user.id)
        .neq("subdomain", "_system")
        .limit(1)
        .maybeSingle();

      if (ownedShop) {
        setBarbershop(ownedShop);
        setIsDefault(false);
        setLoading(false);
        return;
      }
    }

    const { data } = await supabase
      .from("barbershops")
      .select("*")
      .eq("id", DEFAULT_BARBERSHOP_ID)
      .single();

    if (data) {
      setBarbershop(data);
    }
    setLoading(false);
  }

  const barbershopId = barbershop?.id ?? DEFAULT_BARBERSHOP_ID;

  return (
    <BarbershopContext.Provider value={{ barbershop, barbershopId, loading, isDefault }}>
      {children}
    </BarbershopContext.Provider>
  );
}

export function useBarbershop() {
  return useContext(BarbershopContext);
}
