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

    const { data: existing } = await supabase
      .from("account_deletions")
      .select("id, scheduled_for, cancelled_at, processed_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!existing) {
      return new Response(
        JSON.stringify({ error: "not_found", message: "Nenhuma exclusão agendada." }),
        { status: 404, ...responseHeaders },
      );
    }
    if (existing.processed_at) {
      return new Response(
        JSON.stringify({ error: "already_processed", message: "Conta já foi excluída." }),
        { status: 400, ...responseHeaders },
      );
    }
    if (existing.cancelled_at) {
      return new Response(
        JSON.stringify({ success: true, already_cancelled: true }),
        { status: 200, ...responseHeaders },
      );
    }

    await supabase
      .from("account_deletions")
      .update({ cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", existing.id);

    return new Response(JSON.stringify({ success: true }), { status: 200, ...responseHeaders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: "server_error", message }), {
      status: 500,
      ...responseHeaders,
    });
  }
});
