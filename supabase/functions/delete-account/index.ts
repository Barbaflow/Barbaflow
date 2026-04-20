import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const responseHeaders = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Content-Type": "application/json",
  },
};

const GRACE_PERIOD_DAYS = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, responseHeaders);
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        ...responseHeaders,
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        ...responseHeaders,
      });
    }

    const userId = user.id;

    const ALLOWED_REASONS = new Set([
      "no_use",
      "found_alternative",
      "too_expensive",
      "missing_features",
      "bad_experience",
      "privacy",
      "temporary",
      "other",
    ]);
    let feedbackReason: string | null = null;
    let feedbackDetails: string | null = null;
    try {
      const body = await req.json().catch(() => null);
      if (body && typeof body === "object") {
        const r = typeof body.reason === "string" ? body.reason.trim() : "";
        if (ALLOWED_REASONS.has(r)) feedbackReason = r;
        const d = typeof body.details === "string" ? body.details.trim() : "";
        if (d) feedbackDetails = d.slice(0, 500);
      }
    } catch (_) {
      // ignore body parse errors
    }

    // Block scheduling if user owns a barbershop or has staff role
    const { data: ownedShops } = await supabase
      .from("barbershops")
      .select("id, name")
      .eq("owner_id", userId)
      .limit(1);

    if (ownedShops && ownedShops.length > 0) {
      return new Response(
        JSON.stringify({
          error: "owner_blocked",
          message:
            "Você é dono de uma barbearia. Transfira ou exclua a barbearia antes de remover sua conta.",
        }),
        { status: 400, ...responseHeaders },
      );
    }

    const { data: staffRoles } = await supabase
      .from("user_roles")
      .select("role, barbershop_id")
      .eq("user_id", userId)
      .in("role", ["barbeiro", "admin_barbearia", "super_admin"]);

    if (staffRoles && staffRoles.length > 0) {
      return new Response(
        JSON.stringify({
          error: "staff_blocked",
          message:
            "Você faz parte da equipe de uma barbearia. Peça ao administrador para remover seu acesso antes de excluir a conta.",
        }),
        { status: 400, ...responseHeaders },
      );
    }

    // Cancel future appointments where the user is the client (immediate)
    const today = new Date().toISOString().slice(0, 10);
    await supabase
      .from("appointments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("client_id", userId)
      .eq("status", "scheduled")
      .gte("date", today);

    // Schedule deletion for 30 days from now (upsert to handle re-requests)
    const scheduledFor = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Check if there's already an active scheduled deletion
    const { data: existing } = await supabase
      .from("account_deletions")
      .select("id, scheduled_for, cancelled_at, processed_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (existing && !existing.cancelled_at && !existing.processed_at) {
      return new Response(
        JSON.stringify({
          success: true,
          already_scheduled: true,
          scheduled_for: existing.scheduled_for,
          grace_period_days: GRACE_PERIOD_DAYS,
        }),
        { status: 200, ...responseHeaders },
      );
    }

    if (existing) {
      // Reset cancelled/processed entry to a new request
      await supabase
        .from("account_deletions")
        .update({
          scheduled_for: scheduledFor,
          reason: feedbackReason,
          details: feedbackDetails,
          cancelled_at: null,
          processed_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase.from("account_deletions").insert({
        user_id: userId,
        scheduled_for: scheduledFor,
        reason: feedbackReason,
        details: feedbackDetails,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        scheduled_for: scheduledFor,
        grace_period_days: GRACE_PERIOD_DAYS,
      }),
      { status: 200, ...responseHeaders },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: "server_error", message }), {
      status: 500,
      ...responseHeaders,
    });
  }
});
