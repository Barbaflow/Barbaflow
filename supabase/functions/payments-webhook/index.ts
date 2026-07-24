import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyWebhook, EventName, type PaddleEnv } from '../_shared/paddle.ts';

// Cliente service_role: única via de escrita da assinatura (o frontend nunca
// grava subscriptions). A verdade da cobrança vem SEMPRE do webhook do Paddle.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Trava de segurança: nesta fase de testes só o ambiente sandbox é permitido.
// Um evento marcado como `live` só é aceito se BILLING_ALLOW_LIVE=true estiver
// explicitamente configurado — evita processar cobrança real por engano.
function assertEnvAllowed(env: PaddleEnv): void {
  if (env === 'live' && Deno.env.get('BILLING_ALLOW_LIVE') !== 'true') {
    throw new Error('live_env_blocked: BILLING_ALLOW_LIVE não habilitado');
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const env = (url.searchParams.get('env') || 'sandbox') as PaddleEnv;

  try {
    assertEnvAllowed(env);

    // 1) Assinatura criptográfica: evento não assinado/adulterado é recusado.
    const event = await verifyWebhook(req, env);
    console.log('Received event:', event.eventType, 'env:', env);

    // 2) Idempotência: registra o event_id ANTES de aplicar. Redelivery/replay
    //    do mesmo evento não reaplica mudanças (record devolve false).
    const eventId = (event as { eventId?: string }).eventId;
    if (eventId) {
      const { data: isNew, error: dedupeErr } = await supabase.rpc('record_billing_event', {
        _provider: 'paddle',
        _event_id: eventId,
        _event_type: String(event.eventType),
        _environment: env,
      });
      if (dedupeErr) throw dedupeErr;
      if (isNew === false) {
        console.log('Duplicate event ignored:', eventId);
        return json({ received: true, duplicate: true });
      }
    }

    // 3) Aplica o efeito conforme o tipo do evento.
    switch (event.eventType) {
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
        await applySubscription(event.data, env);
        break;
      case EventName.SubscriptionCanceled:
        await applySubscription(event.data, env, { forceStatus: 'canceled' });
        break;
      case EventName.TransactionPaymentFailed:
        await markPastDue(event.data, env);
        break;
      case EventName.TransactionCompleted:
        console.log('Transaction completed:', event.data?.id, 'env:', env);
        break;
      default:
        console.log('Unhandled event:', event.eventType);
    }

    return json({ received: true });
  } catch (e) {
    // Não logamos secrets; apenas a mensagem do erro.
    console.error('Webhook error:', e instanceof Error ? e.message : String(e));
    return new Response('Webhook error', { status: 400 });
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Resolve (userId, barbershopId) do evento: do customData (checkout) ou, se
 * ausente (updated/canceled sem passthrough), da assinatura já persistida.
 * Nunca confia cegamente no customData — a RPC valida a posse.
 */
async function resolveContext(
  data: any,
  env: PaddleEnv,
): Promise<{ userId: string | null; barbershopId: string | null }> {
  const cd = data?.customData ?? {};
  let userId: string | null = cd.userId ?? null;
  let barbershopId: string | null = cd.barbershopId ?? null;

  if ((!userId || !barbershopId) && data?.id) {
    const { data: existing } = await supabase
      .from('subscriptions')
      .select('user_id, barbershop_id')
      .eq('paddle_subscription_id', data.id)
      .eq('environment', env)
      .maybeSingle();
    userId = userId ?? existing?.user_id ?? null;
    barbershopId = barbershopId ?? existing?.barbershop_id ?? null;
  }
  return { userId, barbershopId };
}

async function applySubscription(
  data: any,
  env: PaddleEnv,
  opts: { forceStatus?: string } = {},
): Promise<void> {
  const { userId, barbershopId } = await resolveContext(data, env);
  if (!userId) {
    console.error('No userId resolvable for subscription', data?.id);
    return;
  }

  const item = data.items?.[0];
  const priceId = item?.price?.importMeta?.externalId ?? item?.price?.id ?? null;
  const productId = item?.product?.importMeta?.externalId ?? item?.product?.id ?? null;
  const status = opts.forceStatus ?? data.status;
  const planName = productId === 'enterprise_plan' ? 'enterprise' : 'pro';

  await supabase.rpc('apply_subscription_from_webhook', {
    _user_id: userId,
    _barbershop_id: barbershopId,
    _paddle_subscription_id: data.id,
    _paddle_customer_id: data.customerId,
    _product_id: productId,
    _price_id: priceId,
    _status: status,
    _plan_name: planName,
    _current_period_start: data.currentBillingPeriod?.startsAt ?? null,
    _current_period_end: data.currentBillingPeriod?.endsAt ?? null,
    _cancel_at_period_end: data.scheduledChange?.action === 'cancel',
    _canceled_at: data.canceledAt ?? (status === 'canceled' ? new Date().toISOString() : null),
    _trial_end: status === 'trialing' ? (data.currentBillingPeriod?.endsAt ?? null) : null,
    _environment: env,
  });
}

/** Pagamento falhou: marca a assinatura como past_due (mantém o plano por ora). */
async function markPastDue(data: any, env: PaddleEnv): Promise<void> {
  const subscriptionId = data?.subscriptionId ?? data?.subscription_id;
  if (!subscriptionId) {
    console.log('Payment failed sem subscriptionId:', data?.id, 'env:', env);
    return;
  }
  await supabase
    .from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('paddle_subscription_id', subscriptionId)
    .eq('environment', env);
}
