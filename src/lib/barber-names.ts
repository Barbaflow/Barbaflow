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

  if (error || !data) {
    // Fallback: profile lookup (anon may get nothing, that's ok)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, avatar_url")
      .in("user_id", ids);
    const map: BarberDisplayMap = {};
    (profiles || []).forEach((p) => {
      map[p.user_id] = {
        display_name: p.full_name?.trim() || "Barbeiro",
        avatar_url: p.avatar_url,
      };
    });
    return map;
  }

  const map: BarberDisplayMap = {};
  data.forEach((row) => {
    map[row.user_id] = {
      display_name: row.display_name || "Barbeiro",
      avatar_url: row.avatar_url ?? null,
    };
  });
  return map;
}
