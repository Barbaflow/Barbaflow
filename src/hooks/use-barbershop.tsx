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
 * Patterns:
 *   - {subdomain}.app.lovable.dev → subdomain
 *   - {subdomain}.barbaflow.com  → subdomain
 *   - {subdomain}.lovableproject.com → subdomain
 *   - localhost / plain domains   → null (use default)
 */
function extractSubdomain(): string | null {
  if (typeof window === "undefined") return null;

  const hostname = window.location.hostname;

  // Skip localhost and IP addresses
  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  // Match patterns like: {sub}.app.lovable.dev, {sub}.barbaflow.com, {sub}.lovableproject.com
  const parts = hostname.split(".");

  // Need at least 3 parts for a subdomain (sub.domain.tld)
  if (parts.length < 3) return null;

  const subdomain = parts[0];

  // Skip common non-tenant prefixes
  if (["www", "app", "api", "admin"].includes(subdomain)) return null;

  // Skip preview IDs (Lovable preview URLs like id-preview--xxx)
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
      // Resolve by subdomain
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
          }
          // If subdomain not found, fall through to default
          setLoading(false);
        });
    } else {
      // No subdomain — try loading default barbershop
      supabase
        .from("barbershops")
        .select("*")
        .eq("id", DEFAULT_BARBERSHOP_ID)
        .single()
        .then(({ data, error }) => {
          if (data && !error) {
            setBarbershop(data);
          }
          setLoading(false);
        });
    }
  }, []);

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
