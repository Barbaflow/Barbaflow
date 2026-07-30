import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authorizeCronRequest } from "@/lib/cron-auth.server";

export const Route = createFileRoute("/hooks/reset-monthly-appointments")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Primeira instrução do handler, de propósito: esta rota zera o
        // contador de TODAS as barbearias com a chave administrativa, então
        // nada pode acontecer antes da autorização.
        const auth = authorizeCronRequest(request);
        if (!auth.ok) return auth.response;

        // Use admin client to bypass RLS and reset all barbershops
        const { error } = await supabaseAdmin
          .from("barbershops")
          .update({ appointments_this_month: 0 } as any)
          .gte("appointments_this_month", 0);

        if (error) {
          console.error("Reset monthly appointments error:", error);
          return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        console.log("Reset monthly appointments completed at", new Date().toISOString());

        return new Response(
          JSON.stringify({
            success: true,
            timestamp: new Date().toISOString(),
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      },
    },
  },
});
