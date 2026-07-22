import { supabase } from "@/integrations/supabase/client";

export type BarberDisplay = {
  display_name: string;
  avatar_url: string | null;
};

export type BarberDisplayMap = Record<string, BarberDisplay>;

/**
 * Fetches standardized display names + avatars for a list of user ids
 * via the SECURITY DEFINER RPC `get_barber_display_names`.
 *
 * Falls back to `profiles` data only if the RPC call fails.
 * Returns a map keyed by user_id.
 */
export async function fetchBarberDisplayNames(
  userIds: string[]
): Promise<BarberDisplayMap> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};

  const { data, error } = await supabase.rpc("get_barber_display_names", {
    _user_ids: ids,
  });

  // Sem fallback para `profiles`: a tabela virou privada na migration
  // 20260722240000, então a consulta direta devolveria vazio de qualquer
  // forma — e um fallback que nunca funciona só esconde a falha real da RPC.
  if (error || !data) return {};

  const map: BarberDisplayMap = {};
  data.forEach((row) => {
    map[row.user_id] = {
      display_name: row.display_name || "Barbeiro",
      avatar_url: row.avatar_url ?? null,
    };
  });
  return map;
}
