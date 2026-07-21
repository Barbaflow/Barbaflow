-- ============================================================================
-- Onboarding: plano free garantido  +  limite mensal por contagem direta
-- ----------------------------------------------------------------------------
-- Corrige dois problemas apontados pela auditoria para o projeto real:
--
--  ETAPA 4 — barbershops.plan_id não tem DEFAULT nem trigger, e o
--            OnboardingWizard não envia plan_id → novas barbearias nasciam
--            com plan_id = NULL. Além disso, a policy de INSERT/UPDATE não
--            impede o frontend de escolher pro/enterprise por payload.
--
--  ETAPA 5 — check_appointment_limit lia barbershops.appointments_this_month,
--            um contador que só cresce (o trigger incrementa a cada INSERT) e
--            NUNCA zera no virar do mês. Passamos a CONTAR diretamente os
--            agendamentos do mês corrente (Opção A), evitando contador
--            acumulado permanentemente. O contador incremental é desativado.
--
-- Idempotente e seguro para aplicar em base vazia (CREATE OR REPLACE / IF
-- EXISTS). Fica após todas as migrations existentes.
-- ============================================================================

-- ------------------------------------------------------------------
-- ETAPA 4 — plano inicial free no onboarding, sem escolha arbitrária
-- ------------------------------------------------------------------
-- BEFORE INSERT/UPDATE em barbershops:
--   * INSERT  → força o plano free (localizado por NAME, identificador estável),
--               a menos que um super_admin escolha explicitamente outro plano;
--   * UPDATE  → só super_admin muda plan_id (senão a mudança é ignorada);
--   * nunca deixa plan_id nulo;
--   * falha com mensagem clara se o plano free não existir.
CREATE OR REPLACE FUNCTION public.enforce_barbershop_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _free uuid;
  _is_super boolean := public.has_role(auth.uid(), 'super_admin');
BEGIN
  SELECT id INTO _free FROM public.plans WHERE name = 'free';
  IF _free IS NULL THEN
    RAISE EXCEPTION 'Plano "free" não encontrado em public.plans — aplique o seed de planos antes de criar barbearias.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Onboarding nasce free. Só super_admin pode nascer em outro plano.
    IF NEW.plan_id IS NULL OR NOT _is_super THEN
      NEW.plan_id := _free;
    END IF;
  ELSE  -- UPDATE
    -- plan_id é administrativo: só super_admin altera (via AdminDashboard).
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id AND NOT _is_super THEN
      NEW.plan_id := OLD.plan_id;
    END IF;
    IF NEW.plan_id IS NULL THEN
      NEW.plan_id := COALESCE(OLD.plan_id, _free);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_barbershop_plan ON public.barbershops;
CREATE TRIGGER trg_enforce_barbershop_plan
  BEFORE INSERT OR UPDATE ON public.barbershops
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_barbershop_plan();

-- ------------------------------------------------------------------
-- ETAPA 5 — limite mensal por contagem direta (Opção A)
-- ------------------------------------------------------------------
-- Conta os agendamentos NÃO cancelados cuja DATA cai no mês corrente (no fuso
-- da barbearia). Considera só a barbearia consultada; NULL = ilimitado;
-- retorna boolean (formato esperado pela policy de INSERT e pelo frontend).
-- Como é SECURITY DEFINER e a checagem vive no WITH CHECK da policy de INSERT
-- de appointments, não há bypass por chamada direta à RPC.
CREATE OR REPLACE FUNCTION public.check_appointment_limit(_barbershop_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _limit integer;
  _tz text;
  _month_start date;
  _used integer;
BEGIN
  SELECT p.appointment_limit, b.timezone
    INTO _limit, _tz
  FROM public.barbershops b
  JOIN public.plans p ON p.id = b.plan_id
  WHERE b.id = _barbershop_id;

  -- Sem plano associado não deveria ocorrer (o trigger força free). Por
  -- segurança, bloqueia em vez de liberar sem limite.
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Ilimitado (pro/enterprise).
  IF _limit IS NULL THEN
    RETURN true;
  END IF;

  _month_start := (
    date_trunc('month', (now() AT TIME ZONE COALESCE(NULLIF(_tz, ''), 'America/Sao_Paulo')))
  )::date;

  SELECT count(*) INTO _used
  FROM public.appointments a
  WHERE a.barbershop_id = _barbershop_id
    AND a.status <> 'cancelled'          -- cancelados liberam a vaga
    AND a.date >= _month_start
    AND a.date <  (_month_start + interval '1 month');

  RETURN _used < _limit;
END;
$$;

-- Desativa o contador acumulado incorreto: o limite agora conta diretamente.
-- (Mantemos a coluna appointments_this_month por compatibilidade do frontend;
-- ela passa a ser apenas informativa/legada.)
DROP TRIGGER IF EXISTS after_appointment_insert ON public.appointments;
