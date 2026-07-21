-- ============================================================================
-- barbershops: plano e status administrativo — reconhecimento de service_role
-- ----------------------------------------------------------------------------
-- PROBLEMA CORRIGIDO (auditoria pré-push)
--
-- `public.enforce_barbershop_plan()` (migration 20260720120000) decidia quem
-- pode mexer em `plan_id` usando APENAS:
--
--     _is_super := public.has_role(auth.uid(), 'super_admin')
--
-- Consequências:
--
--  1) service_role tem `auth.uid()` NULO. Toda escrita legítima de backend era
--     classificada como "usuário comum". No UPDATE o trigger fazia
--     `NEW.plan_id := OLD.plan_id` — ou seja, REVERTIA SILENCIOSAMENTE a
--     alteração e devolvia sucesso. O webhook do Paddle
--     (`supabase/functions/payments-webhook/index.ts`, que roda com
--     SUPABASE_SERVICE_ROLE_KEY e faz `barbershops.update({ plan_id })` no
--     `subscription.created` e no `subscription.canceled`) recebia HTTP 200
--     com zero efeito: o cliente pagava e continuava no plano free, sem erro
--     em lugar nenhum. Mesmo problema para qualquer job/webhook futuro.
--
--  2) `barbershops.status` (approval_status) não era protegido de forma
--     alguma pelo trigger, e a policy de UPDATE é
--     `owner_id = auth.uid() OR has_role(auth.uid(),'super_admin')`.
--     O dono da barbearia (admin_barbearia) podia se auto-aprovar mandando
--     `status = 'approved'` no payload — a moderação do AdminDashboard era
--     puramente cosmética.
--
--  3) A reversão silenciosa é o pior modo de falha possível: nem o atacante
--     nem o backend legítimo sabem que a escrita não valeu.
--
-- ----------------------------------------------------------------------------
-- COMO service_role É RECONHECIDO (sem confiar em nada vindo do cliente)
--
-- `public.is_trusted_backend()` usa o contexto REAL da sessão Postgres:
--
--   * `current_setting('role')` — o GUC que o PostgREST altera com
--     `SET LOCAL ROLE <role>` depois de VERIFICAR a assinatura do JWT.
--     Verificado no Postgres 17.6 local: dentro de uma função SECURITY
--     DEFINER, `current_user` vira o dono da função (postgres) e portanto é
--     inútil, mas o GUC `role` continua refletindo o SET LOCAL ROLE do
--     PostgREST. É o sinal confiável.
--        anon → 'anon' | usuário logado → 'authenticated' | chave de
--        service_role → 'service_role'.
--
--   * `request.jwt.claims ->> 'role'` — reforço redundante. Esse GUC também é
--     preenchido pelo PostgREST a partir do JWT já validado contra o
--     JWT secret do projeto; não é um cabeçalho arbitrário do cliente.
--
--   * conexão direta confiável (psql/migrations/bootstrap/SQL Editor): nenhum
--     SET ROLE (`role` = 'none'), nenhum JWT e `session_user` superusuário do
--     projeto. Esse caminho já poderia desabilitar o trigger de qualquer
--     forma; reconhecê-lo evita falso negativo no
--     `supabase/bootstrap/super-admin.example.sql`.
--
-- Um usuário autenticado NUNCA cai em nenhum desses ramos: o PostgREST fixa
-- `role = 'authenticated'`, e ele não tem credencial de banco para abrir
-- conexão direta. Não existe campo de payload capaz de influenciar a decisão.
--
-- ----------------------------------------------------------------------------
-- REGRA FINAL
--
-- INSERT
--   * usuário comum (onboarding): nasce SEMPRE no plano free;
--   * usuário comum pedindo plano != free por payload: ERRO claro
--     (`insufficient_privilege`) — não silenciamos a tentativa;
--   * super_admin e service_role: podem nascer com plano explícito;
--   * `plan_id` nulo é sempre resolvido para free (nunca fica nulo).
--
-- UPDATE
--   * `plan_id` e `status` só mudam por super_admin ou service_role;
--   * admin_barbearia / barbeiro / cliente tentando mudar → ERRO claro,
--     nunca reversão silenciosa;
--   * demais colunas (nome, endereço, cores, logo, políticas) seguem livres
--     para quem a policy já autoriza;
--   * `plan_id` nulo é recusado;
--   * plano inexistente é recusado (antes da FK, com mensagem legível).
--
-- Idempotente e seguro em base vazia. Posterior a 20260720130000.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1) Reconhecimento do contexto de backend confiável
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_trusted_backend()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role_guc  text;
  _jwt_raw   text;
  _jwt_role  text;
BEGIN
  -- GUC `role`: definido por SET LOCAL ROLE do PostgREST após validar o JWT.
  -- Não é afetado por SECURITY DEFINER (que só troca current_user).
  _role_guc := coalesce(nullif(current_setting('role', true), ''), 'none');
  IF _role_guc = 'service_role' THEN
    RETURN true;
  END IF;

  -- Claims do JWT já verificado. Cast defensivo: se vier algo que não é JSON,
  -- tratamos como ausente em vez de estourar dentro de um trigger.
  _jwt_raw := nullif(current_setting('request.jwt.claims', true), '');
  IF _jwt_raw IS NOT NULL THEN
    BEGIN
      _jwt_role := (_jwt_raw::jsonb) ->> 'role';
    EXCEPTION WHEN OTHERS THEN
      _jwt_role := NULL;
    END;
    IF _jwt_role = 'service_role' THEN
      RETURN true;
    END IF;
    -- Há JWT e ele NÃO é de service_role: é tráfego de API de um usuário.
    RETURN false;
  END IF;

  -- Sem JWT e sem SET ROLE: conexão direta ao banco (migrations, bootstrap,
  -- SQL Editor). Só vale para os papéis de administração do projeto —
  -- o PostgREST conecta como `authenticator`, que não entra aqui.
  RETURN _role_guc = 'none'
     AND session_user IN ('postgres', 'supabase_admin');
END;
$$;

COMMENT ON FUNCTION public.is_trusted_backend() IS
  'true quando a escrita vem do service_role (GUC role / claim role do JWT verificado) ou de uma conexão administrativa direta. Nunca true para anon/authenticated. Não depende de nenhum dado enviado pelo cliente.';

-- Superfície mínima: quem chama esta função é o trigger SECURITY DEFINER
-- (executa como o dono, postgres). Nenhum papel de API precisa de EXECUTE.
REVOKE ALL ON FUNCTION public.is_trusted_backend() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- 2) Trigger de plano/status
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_barbershop_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _free       uuid;
  _uid        uuid    := auth.uid();
  _privileged boolean;
BEGIN
  SELECT id INTO _free FROM public.plans WHERE name = 'free';
  IF _free IS NULL THEN
    RAISE EXCEPTION
      'Plano "free" não encontrado em public.plans — aplique o seed de planos antes de criar barbearias.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- super_admin autenticado OU backend confiável (service_role / conexão
  -- administrativa direta).
  _privileged := (_uid IS NOT NULL AND public.has_role(_uid, 'super_admin'::public.app_role))
                 OR public.is_trusted_backend();

  IF TG_OP = 'INSERT' THEN
    IF NEW.plan_id IS NULL THEN
      -- Caminho normal do onboarding: não envia plan_id.
      NEW.plan_id := _free;
    ELSIF NOT _privileged AND NEW.plan_id IS DISTINCT FROM _free THEN
      -- Escolha de plano por payload: recusada explicitamente.
      RAISE EXCEPTION
        'O plano de uma nova barbearia não pode ser escolhido: toda barbearia começa no plano free.'
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Faça o upgrade pelo fluxo de assinatura; a mudança de plano é aplicada pelo backend.';
    END IF;

  ELSE  -- UPDATE
    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id AND NOT _privileged THEN
      RAISE EXCEPTION
        'Alterar o plano da barbearia é uma operação administrativa.'
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'O plano muda pelo fluxo de assinatura (backend) ou por um super_admin.';
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status AND NOT _privileged THEN
      RAISE EXCEPTION
        'Alterar o status de aprovação da barbearia é uma operação administrativa.'
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'A aprovação/rejeição é feita por um super_admin no painel administrativo.';
    END IF;

    IF NEW.plan_id IS NULL THEN
      RAISE EXCEPTION
        'A barbearia não pode ficar sem plano (plan_id nulo).'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Vale para INSERT e UPDATE, inclusive para super_admin/service_role: a FK
  -- já barraria, mas com mensagem ilegível para quem chama a API.
  IF NOT EXISTS (SELECT 1 FROM public.plans p WHERE p.id = NEW.plan_id) THEN
    RAISE EXCEPTION
      'Plano % não existe em public.plans.', NEW.plan_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_barbershop_plan() IS
  'Regra central de barbershops: onboarding nasce free, plan_id nunca nulo/inexistente, e plan_id/status só mudam por super_admin ou backend confiável (service_role). Recusa com erro em vez de reverter silenciosamente.';

DROP TRIGGER IF EXISTS trg_enforce_barbershop_plan ON public.barbershops;
CREATE TRIGGER trg_enforce_barbershop_plan
  BEFORE INSERT OR UPDATE ON public.barbershops
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_barbershop_plan();

-- ------------------------------------------------------------------
-- 3) plan_id NOT NULL no nível da coluna
-- ------------------------------------------------------------------
-- Rede de segurança independente do trigger (que pode ser desabilitado por um
-- superusuário). O trigger é BEFORE, então preenche o valor antes desta
-- checagem; nenhum caminho legítimo passa a falhar.
UPDATE public.barbershops
SET plan_id = (SELECT id FROM public.plans WHERE name = 'free')
WHERE plan_id IS NULL;

ALTER TABLE public.barbershops
  ALTER COLUMN plan_id SET NOT NULL;
