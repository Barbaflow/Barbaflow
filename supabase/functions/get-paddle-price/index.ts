import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { gatewayFetch, type PaddleEnv } from '../_shared/paddle.ts';

const responseHeaders = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Content-Type": "application/json",
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, responseHeaders);
  }

  const { priceId, environment } = await req.json();
  if (!priceId) {
    return new Response(JSON.stringify({ error: "priceId required" }), {
      status: 400,
      ...responseHeaders,
    });
  }

  const response = await gatewayFetch(environment as PaddleEnv, `/prices?external_id=${encodeURIComponent(priceId)}`);
  const data = await response.json();

  if (!data.data?.length) {
    return new Response(JSON.stringify({ error: "Price not found" }), {
      status: 404,
      ...responseHeaders,
    });
  }

  return new Response(JSON.stringify({ paddleId: data.data[0].id }), responseHeaders);
});
