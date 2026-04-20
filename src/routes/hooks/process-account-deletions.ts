import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Cron-triggered route: deletes accounts whose 30-day grace period has elapsed.
export const Route = createFileRoute("/hooks/process-account-deletions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authHeader = request.headers.get("authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (!token) {
          return new Response(JSON.stringify({ error: "Missing authorization" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Service role required for auth.admin.deleteUser
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
        if (!serviceKey || !supabaseUrl) {
          return new Response(
            JSON.stringify({ error: "server_misconfigured" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        // Verify the caller is allowed (anon key acts as the cron auth token)
        if (token !== process.env.SUPABASE_ANON_KEY && token !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        const admin = createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

        const nowIso = new Date().toISOString();
        const { data: pending, error: fetchError } = await admin
          .from("account_deletions")
          .select("id, user_id, reason, details, scheduled_for")
          .is("cancelled_at", null)
          .is("processed_at", null)
          .lte("scheduled_for", nowIso)
          .limit(100);

        if (fetchError) {
          return new Response(
            JSON.stringify({ error: "fetch_failed", message: fetchError.message }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let processed = 0;
        const errors: { user_id: string; message: string }[] = [];

        for (const row of pending || []) {
          const userId = row.user_id;
          try {
            // Anonymize past reviews
            await admin
              .from("reviews")
              .update({ comment: null, updated_at: new Date().toISOString() })
              .eq("client_id", userId);

            // Cancel any remaining scheduled appointments
            const today = new Date().toISOString().slice(0, 10);
            await admin
              .from("appointments")
              .update({ status: "cancelled", updated_at: new Date().toISOString() })
              .eq("client_id", userId)
              .eq("status", "scheduled")
              .gte("date", today);

            // Remove personal records
            await admin.from("notifications").delete().eq("user_id", userId);
            await admin.from("client_blocks").delete().eq("client_id", userId);
            await admin.from("user_roles").delete().eq("user_id", userId);
            await admin.from("profiles").delete().eq("user_id", userId);

            // Remove avatar files
            const { data: avatarFiles } = await admin.storage.from("avatars").list(userId);
            if (avatarFiles && avatarFiles.length > 0) {
              await admin.storage
                .from("avatars")
                .remove(avatarFiles.map((f) => `${userId}/${f.name}`));
            }

            // Persist anonymous churn feedback
            if (row.reason) {
              await admin.from("account_deletion_feedback").insert({
                reason: row.reason,
                details: row.details,
                had_barbershop_role: false,
              });
            }

            // Delete the auth user
            const { error: delError } = await admin.auth.admin.deleteUser(userId);
            if (delError) {
              errors.push({ user_id: userId, message: delError.message });
              continue;
            }

            // Mark deletion as processed (the row remains for audit; user_id FK no longer exists)
            await admin
              .from("account_deletions")
              .update({ processed_at: new Date().toISOString() })
              .eq("id", row.id);

            processed += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            errors.push({ user_id: userId, message });
          }
        }

        return new Response(
          JSON.stringify({
            success: true,
            processed,
            errors,
            checked: pending?.length ?? 0,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
