/* ═══════════════════════════════════════════════════════════════════════════
   ASSINATURA SaaS DA BARBEARIA — ciclo de vida e cobrança recorrente (Paddle)
   ---------------------------------------------------------------------------
   Esta etapa trata da ASSINATURA da barbearia para usar o BarbaFlow. NÃO tem
   relação com pagamento de serviços/comandas pelo cliente, split, marketplace
   ou pagamento de barbeiros.

   O que esta migration faz (sem alterar migrations antigas):
     • liga a assinatura à BARBEARIA (a tabela nasceu por user_id): novas colunas
       barbershop_id / canceled_at / trial_end, com backfill pelo dono;
     • restringe `status` aos estados do Paddle Billing;
     • garante NO MÁXIMO UMA assinatura corrente (não-cancelada) por barbearia;
     • idempotência de webhook: tabela `billing_webhook_events` (event_id único);
     • RPCs seguras:
         - record_billing_event  → dedupe de webhook (service_role);
         - apply_subscription_from_webhook → grava a assinatura e o plano da
           barbearia validando a POSSE (service_role); a verdade vem do webhook;
         - get_barbershop_subscription → leitura da assinatura para a página de
           cobrança, restrita a admin_barbearia/super_admin daquele tenant.

   Segurança: nenhum dado de cartão é armazenado; identificadores externos são
   os do Paddle (paddle_*); a escrita continua fechada ao frontend (só
   service_role via webhook) — esta migration só reforça isso.

   Migration posterior a 20260724120000; não altera nada anterior.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════ 1. subscriptions: ligar à barbearia + estados completos ════════ */
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS canceled_at   timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end     timestamptz;

-- Backfill: a assinatura pertence à barbearia do DONO que pagou (owner_id).
UPDATE public.subscriptions s
   SET barbershop_id = b.id
  FROM public.barbershops b
 WHERE b.owner_id = s.user_id
   AND s.barbershop_id IS NULL;

COMMENT ON COLUMN public.subscriptions.barbershop_id IS
  'Barbearia dona da assinatura. A assinatura pertence à barbearia, não ao usuário.';

-- Estados aceitos = os do Paddle Billing. `free` NÃO é status de assinatura
-- (barbearia sem assinatura = plano free via barbershops.plan_id).
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active','trialing','past_due','canceled','paused'));

-- No máximo UMA assinatura corrente (não-cancelada) por barbearia/ambiente.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active_per_barbershop
  ON public.subscriptions (barbershop_id, environment)
  WHERE barbershop_id IS NOT NULL AND status <> 'canceled';

CREATE INDEX IF NOT EXISTS idx_subscriptions_barbershop
  ON public.subscriptions (barbershop_id);

/* ═══════════ 2. Idempotência de webhook ════════════════════════════════════ */
-- Cada evento do provedor é registrado UMA vez. Redelivery/replay não reaplica.
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      text NOT NULL DEFAULT 'paddle',
  event_id      text NOT NULL,
  event_type    text,
  environment   text NOT NULL,
  barbershop_id uuid REFERENCES public.barbershops(id) ON DELETE SET NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: só o service_role (que ignora RLS) lê/grava.
REVOKE ALL ON public.billing_webhook_events FROM anon, authenticated;

/* ═══════════ 3. RPC: registrar evento (dedupe) — service_role ══════════════ */
-- Devolve TRUE se o evento é novo (deve ser processado) e FALSE se já foi visto.
CREATE OR REPLACE FUNCTION public.record_billing_event(
  _provider text,
  _event_id text,
  _event_type text,
  _environment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _inserted boolean;
BEGIN
  IF NOT public.is_trusted_backend() THEN
    RAISE EXCEPTION 'forbidden: apenas o backend confiável registra eventos de cobrança'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.billing_webhook_events (provider, event_id, event_type, environment)
  VALUES (COALESCE(_provider, 'paddle'), _event_id, _event_type, _environment)
  ON CONFLICT (provider, event_id) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;  -- 1 linha = novo; 0 = duplicado
END;
$$;

/* ═══════════ 4. RPC: aplicar assinatura do webhook — service_role ══════════ */
-- Fonte da verdade da cobrança. Valida POSSE (a barbearia pertence ao usuário
-- que pagou, ou ele é admin dela) antes de gravar — nunca confia cegamente no
-- barbershop_id vindo do customData. Idempotente por paddle_subscription_id.
CREATE OR REPLACE FUNCTION public.apply_subscription_from_webhook(
  _user_id uuid,
  _barbershop_id uuid,
  _paddle_subscription_id text,
  _paddle_customer_id text,
  _product_id text,
  _price_id text,
  _status text,
  _plan_name text,
  _current_period_start timestamptz,
  _current_period_end timestamptz,
  _cancel_at_period_end boolean,
  _canceled_at timestamptz,
  _trial_end timestamptz,
  _environment text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _plan_id uuid;
BEGIN
  IF NOT public.is_trusted_backend() THEN
    RAISE EXCEPTION 'forbidden: apenas o backend confiável aplica assinaturas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- POSSE: a barbearia informada precisa ser do usuário que pagou (dono) ou de
  -- quem administra a barbearia. Impede um customData forjado com tenant alheio.
  IF _barbershop_id IS NOT NULL AND NOT (
    EXISTS (SELECT 1 FROM public.barbershops WHERE id = _barbershop_id AND owner_id = _user_id)
    OR public.has_role_in_barbershop(_user_id, _barbershop_id, 'admin_barbearia'::app_role)
  ) THEN
    RAISE EXCEPTION 'tenant_ownership_invalid: usuário % não administra a barbearia %', _user_id, _barbershop_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Upsert idempotente pela chave natural do Paddle (paddle_subscription_id UNIQUE).
  INSERT INTO public.subscriptions AS s (
    user_id, barbershop_id, paddle_subscription_id, paddle_customer_id,
    product_id, price_id, status, current_period_start, current_period_end,
    cancel_at_period_end, canceled_at, trial_end, environment, updated_at
  ) VALUES (
    _user_id, _barbershop_id, _paddle_subscription_id, _paddle_customer_id,
    _product_id, _price_id, _status, _current_period_start, _current_period_end,
    COALESCE(_cancel_at_period_end, false), _canceled_at, _trial_end, _environment, now()
  )
  ON CONFLICT (paddle_subscription_id) DO UPDATE SET
    barbershop_id        = COALESCE(EXCLUDED.barbershop_id, s.barbershop_id),
    paddle_customer_id   = EXCLUDED.paddle_customer_id,
    product_id           = EXCLUDED.product_id,
    price_id             = EXCLUDED.price_id,
    status               = EXCLUDED.status,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end   = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    canceled_at          = EXCLUDED.canceled_at,
    trial_end            = EXCLUDED.trial_end,
    updated_at           = now();

  -- Entitlement da barbearia = barbershops.plan_id. Assinatura ativa/em teste/
  -- atrasada mantém o plano pago (atraso é período de graça); cancelada volta a free.
  IF _barbershop_id IS NOT NULL THEN
    IF _status IN ('active','trialing','past_due') THEN
      SELECT id INTO _plan_id FROM public.plans WHERE name = _plan_name::plan_name;
    ELSE
      SELECT id INTO _plan_id FROM public.plans WHERE name = 'free';
    END IF;

    IF _plan_id IS NOT NULL THEN
      UPDATE public.barbershops SET plan_id = _plan_id WHERE id = _barbershop_id;
    END IF;
  END IF;
END;
$$;

/* ═══════════ 5. RPC: ler a assinatura da barbearia — página de cobrança ════ */
-- Restrita a admin_barbearia/super_admin do tenant (barbeiro/cliente/anon não).
-- Devolve a assinatura corrente (não-cancelada preferida; senão a mais recente).
CREATE OR REPLACE FUNCTION public.get_barbershop_subscription(_barbershop_id uuid)
RETURNS TABLE (
  status               text,
  price_id             text,
  environment          text,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean,
  canceled_at          timestamptz,
  trial_end            timestamptz,
  updated_at           timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
    public.has_role_in_barbershop(_caller, _barbershop_id, 'admin_barbearia'::app_role)
    OR public.has_role(_caller, 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: só o administrador gerencia a assinatura desta barbearia'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT s.status, s.price_id, s.environment, s.current_period_start, s.current_period_end,
         s.cancel_at_period_end, s.canceled_at, s.trial_end, s.updated_at
  FROM public.subscriptions s
  WHERE s.barbershop_id = _barbershop_id
  ORDER BY (s.status <> 'canceled') DESC, s.updated_at DESC
  LIMIT 1;
END;
$$;

/* ═══════════ 6. Grants ═════════════════════════════════════════════════════ */
-- RPCs de escrita do webhook: só o backend confiável (service_role). O guard
-- is_trusted_backend() é a trava real; os REVOKE/GRANT reforçam.
REVOKE ALL ON FUNCTION public.record_billing_event(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_subscription_from_webhook(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_billing_event(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_subscription_from_webhook(uuid, uuid, text, text, text, text, text, text, timestamptz, timestamptz, boolean, timestamptz, timestamptz, text) TO service_role;

-- Leitura da assinatura: usuário autenticado (a própria função filtra por papel/tenant).
REVOKE ALL ON FUNCTION public.get_barbershop_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_barbershop_subscription(uuid) TO authenticated;
