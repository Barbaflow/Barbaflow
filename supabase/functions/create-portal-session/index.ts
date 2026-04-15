import { createClient } from 'npm:@supabase/supabase-js@2';
import { getPaddleClient, type PaddleEnv } from '../_shared/paddle.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const responseHeaders = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Content-Type": "application/json",
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, responseHeaders);
  }

  try {
    // Get auth user
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, ...responseHeaders });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, ...responseHeaders });
    }

    const { environment } = await req.json();
    const env = (environment || 'sandbox') as PaddleEnv;

    // Get subscription
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('paddle_customer_id, paddle_subscription_id')
      .eq('user_id', user.id)
      .eq('environment', env)
      .in('status', ['active', 'trialing', 'past_due'])
      .single();

    if (subError || !subscription) {
      return new Response(JSON.stringify({ error: "Nenhuma assinatura ativa encontrada" }), { status: 404, ...responseHeaders });
    }

    const paddle = getPaddleClient(env);
    const portalSession = await paddle.customerPortalSessions.create(
      subscription.paddle_customer_id,
      [subscription.paddle_subscription_id]
    );

    return new Response(
      JSON.stringify({ url: portalSession.urls.general.overview }),
      responseHeaders
    );
  } catch (e) {
    console.error('Portal session error:', e);
    return new Response(JSON.stringify({ error: "Erro ao criar sessão do portal" }), { status: 500, ...responseHeaders });
  }
});
