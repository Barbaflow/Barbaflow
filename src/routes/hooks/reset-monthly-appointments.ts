import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/hooks/reset-monthly-appointments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.replace("Bearer ", "");

        if (!token) {
          return new Response(
            JSON.stringify({ error: "Missing authorization header" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          );
        }

        const supabase = createClient(
          import.meta.env.VITE_SUPABASE_URL!,
          token,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );

        // Reset all barbershops' monthly appointment counter
        const { error, count } = await supabase
          .from("barbershops")
          .update({ appointments_this_month: 0 })
          .gte("appointments_this_month", 0)
          .select("id", { count: "exact" });

        if (error) {
          console.error("Reset monthly appointments error:", error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        console.log(`Reset monthly appointments for ${count} barbershops`);

        return new Response(
          JSON.stringify({
            success: true,
            reset_count: count,
            timestamp: new Date().toISOString(),
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      },
    },
  },
});
