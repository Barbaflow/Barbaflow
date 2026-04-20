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

    // Optional churn feedback (anonymous - no user identifier stored)
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

    // Block deletion if user owns a barbershop or has staff role (barbeiro/admin)
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

    // Cancel future appointments where the user is the client
    const today = new Date().toISOString().slice(0, 10);
    await supabase
      .from("appointments")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("client_id", userId)
      .eq("status", "scheduled")
      .gte("date", today);

    // Anonymize past reviews (keep aggregate ratings intact, remove personal text)
    await supabase
      .from("reviews")
      .update({ comment: null, updated_at: new Date().toISOString() })
      .eq("client_id", userId);

    // Remove personal records
    await supabase.from("notifications").delete().eq("user_id", userId);
    await supabase.from("client_blocks").delete().eq("client_id", userId);
    await supabase.from("user_roles").delete().eq("user_id", userId);
    await supabase.from("profiles").delete().eq("user_id", userId);

    // Remove avatar files from storage
    const { data: avatarFiles } = await supabase.storage.from("avatars").list(userId);
    if (avatarFiles && avatarFiles.length > 0) {
      await supabase.storage
        .from("avatars")
        .remove(avatarFiles.map((f) => `${userId}/${f.name}`));
    }

    // Persist anonymous churn feedback BEFORE deleting the user (no user_id stored)
    if (feedbackReason) {
      await supabase.from("account_deletion_feedback").insert({
        reason: feedbackReason,
        details: feedbackDetails,
        had_barbershop_role: false,
      });
    }

    // Finally, delete the auth user (cascades to auth.identities, sessions, etc.)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      return new Response(
        JSON.stringify({ error: "delete_failed", message: deleteError.message }),
        { status: 500, ...responseHeaders },
      );
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, ...responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: "server_error", message }), {
      status: 500,
      ...responseHeaders,
    });
  }
});
