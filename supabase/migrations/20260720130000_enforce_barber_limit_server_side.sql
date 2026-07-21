-- ============================================================================
-- Enforcement server-side do limite de profissionais (plans.barber_limit)
-- ----------------------------------------------------------------------------
-- Problema corrigido (auditoria pré-push):
--
--   * `public.check_barber_limit(uuid)` existia e era consultado pela interface
--     (TeamManager/usePlan) e replicado no mock, mas NENHUMA policy, trigger ou
--     função de escrita real impedia ultrapassar o limite. Qualquer INSERT
--     direto em `public.user_roles` — via PostgREST com um token de
--     `admin_barbearia`, via `accept_team_invitation()` (SECURITY DEFINER, que
--     nem passa por RLS) ou via payload manipulado — criava profissionais
--     acima do limite do plano.
--
--   * A policy de INSERT em `public.user_roles` permite que um
--     `admin_barbearia` insira QUALQUER papel na própria barbearia, inclusive
--     `super_admin`. Como `public.has_role()` não é escopada por barbearia,
--     isso era uma escalação de privilégio para super_admin global.
--
-- Estratégia: uma REGRA CENTRAL no banco (trigger BEFORE INSERT OR UPDATE em
-- `public.user_roles`). Por estar no nível da tabela, ela cobre todos os
-- caminhos de escrita de uma só vez — onboarding, TeamManager, aceite de
-- convite (SECURITY DEFINER), service_role e SQL manual — sem depender de a
-- interface ter consultado o limite antes e sem possibilidade de bypass por
-- payload.
--
-- Regra de contagem: idêntica à que `check_barber_limit` já usava e que o mock
-- replica — só `barbeiro` e `admin_barbearia` consomem limite. `cliente` e
-- `super_admin` (inclusive o da barbearia sentinela `_system`) não consomem.
-- A contagem é por LINHA de user_roles, não por usuário distinto, exatamente
-- como a tela de equipe conta (`members.length`).
--
-- Idempotente e seguro em base vazia. Posterior a 20260720120000.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1) Regra de contagem em um único lugar
-- ------------------------------------------------------------------
-- Fonte única da verdade sobre quais papéis consomem limite, compartilhada
-- pelo trigger de enforcement e pela RPC de leitura. Assim os dois nunca
-- divergem.
CREATE OR REPLACE FUNCTION public.role_counts_toward_barber_limit(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _role IN ('barbeiro'::public.app_role, 'admin_barbearia'::public.app_role)
$$;

COMMENT ON FUNCTION public.role_counts_toward_barber_limit(public.app_role) IS
  'Papéis que consomem plans.barber_limit: barbeiro e admin_barbearia. cliente e super_admin não consomem.';

-- ------------------------------------------------------------------
-- 2) Trigger central de enforcement
-- ------------------------------------------------------------------
-- CONCORRÊNCIA
-- ------------
-- Contar-e-inserir não é atômico: dois convites aceitos ao mesmo tempo leriam
-- ambos `count = 0` e ambos passariam, estourando o limite silenciosamente.
-- Serializamos por barbearia com um advisory lock de transação:
--
--   pg_advisory_xact_lock(<namespace fixo>, <hash do barbershop_id>)
--
-- Usamos a forma de dois int4 para ter um namespace próprio e não colidir com
-- advisory locks de outras partes do sistema. O lock é liberado
-- automaticamente no fim da transação (COMMIT ou ROLLBACK) — não há risco de
-- lock vazado. Ele só é adquirido quando a linha realmente disputa o limite
-- (papel que conta + plano limitado ainda não resolvido), então INSERTs de
-- `cliente` e barbearias de plano ilimitado não serializam entre si.
--
-- Em READ COMMITTED (padrão do Postgres/Supabase) cada comando SQL dentro da
-- função PL/pgSQL pega um snapshot novo, então a transação que espera no lock
-- enxerga a linha já commitada pela primeira e recusa corretamente.
CREATE OR REPLACE FUNCTION public.enforce_barber_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller   uuid := auth.uid();
  _plan_id  uuid;
  _limit    integer;
  _plan_ok  boolean;
  _used     integer;
BEGIN
  -- (a) super_admin nunca é atribuível por esta via ------------------------
  -- A policy de INSERT deixa um admin_barbearia inserir qualquer papel na
  -- própria barbearia. Sem esta guarda, ele se promoveria a super_admin
  -- global (has_role não é escopada por barbearia).
  -- `_caller IS NULL` = service_role / psql (bootstrap manual do super_admin),
  -- que é justamente o caminho legítimo documentado em supabase/bootstrap/.
  IF NEW.role = 'super_admin'::public.app_role
     AND _caller IS NOT NULL
     AND NOT public.has_role(_caller, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION
      'O papel super_admin não pode ser atribuído por esta via.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) papéis que não consomem limite passam direto ----------------------
  -- cliente (auto-atribuído ao agendar) e super_admin (sentinela _system).
  IF NOT public.role_counts_toward_barber_limit(NEW.role) THEN
    RETURN NEW;
  END IF;

  -- (c0) linha duplicada não adiciona ninguém ------------------------------
  -- (user_id, barbershop_id, role) é UNIQUE. Reinserir o mesmo papel é no-op
  -- (ON CONFLICT DO NOTHING no aceite de convite) ou vira erro de unicidade —
  -- em nenhum dos casos aumenta a contagem, então não deve consumir limite.
  -- Sem isto, reaceitar um convite de um papel já possuído numa barbearia
  -- cheia devolveria "limite atingido" em vez de simplesmente não fazer nada.
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = NEW.user_id
      AND ur.barbershop_id = NEW.barbershop_id
      AND ur.role = NEW.role
      AND (TG_OP = 'INSERT' OR ur.id <> OLD.id)
  ) THEN
    RETURN NEW;
  END IF;

  -- (c) UPDATE que não adiciona um profissional passa direto --------------
  -- Se a linha JÁ contava para o limite da MESMA barbearia, trocar
  -- barbeiro <-> admin_barbearia não altera a contagem.
  IF TG_OP = 'UPDATE'
     AND OLD.barbershop_id = NEW.barbershop_id
     AND public.role_counts_toward_barber_limit(OLD.role) THEN
    RETURN NEW;
  END IF;

  -- (d) plano da barbearia -------------------------------------------------
  SELECT b.plan_id INTO _plan_id
  FROM public.barbershops b
  WHERE b.id = NEW.barbershop_id;

  IF NOT FOUND THEN
    -- A FK pegaria isso também, mas com mensagem bem menos clara.
    RAISE EXCEPTION
      'Barbearia % não existe.', NEW.barbershop_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF _plan_id IS NULL THEN
    RAISE EXCEPTION
      'Barbearia % não tem plano associado — não é possível validar o limite de profissionais.',
      NEW.barbershop_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT true, p.barber_limit INTO _plan_ok, _limit
  FROM public.plans p
  WHERE p.id = _plan_id;

  IF NOT FOUND THEN
    -- plan_id preenchido mas apontando para plano inexistente: falha clara em
    -- vez de tratar como ilimitado.
    RAISE EXCEPTION
      'Plano % da barbearia % não existe em public.plans.', _plan_id, NEW.barbershop_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- barber_limit NULL = ilimitado (pro/enterprise): nada a serializar.
  IF _limit IS NULL THEN
    RETURN NEW;
  END IF;

  -- (e) contagem serializada por barbearia --------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtext('public.user_roles:barber_limit'),
    hashtext(NEW.barbershop_id::text)
  );

  SELECT count(*) INTO _used
  FROM public.user_roles ur
  WHERE ur.barbershop_id = NEW.barbershop_id
    AND public.role_counts_toward_barber_limit(ur.role)
    AND (TG_OP = 'INSERT' OR ur.id <> OLD.id);

  IF _used >= _limit THEN
    RAISE EXCEPTION
      'Limite de profissionais do plano atingido (%). Faça upgrade para adicionar mais.', _limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_barber_limit() IS
  'Regra central de user_roles: impede ultrapassar plans.barber_limit por qualquer caminho de escrita e bloqueia auto-promoção a super_admin. Serializa a contagem por barbearia com advisory lock de transação.';

DROP TRIGGER IF EXISTS trg_enforce_barber_limit ON public.user_roles;
CREATE TRIGGER trg_enforce_barber_limit
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_barber_limit();

-- ------------------------------------------------------------------
-- 3) check_barber_limit alinhada à mesma regra
-- ------------------------------------------------------------------
-- Continua sendo apenas LEITURA (a interface usa para desabilitar botões); o
-- enforcement real é o trigger acima. Mudanças:
--   * usa a mesma função de contagem do trigger (não pode divergir);
--   * barbearia sem plano / plano inexistente devolve false (fail-closed) em
--     vez de NULL, seguindo o mesmo critério já adotado em
--     check_appointment_limit na migration 20260720120000.
CREATE OR REPLACE FUNCTION public.check_barber_limit(_barbershop_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _limit integer;
  _used  integer;
BEGIN
  SELECT p.barber_limit INTO _limit
  FROM public.barbershops b
  JOIN public.plans p ON p.id = b.plan_id
  WHERE b.id = _barbershop_id;

  IF NOT FOUND THEN
    RETURN false;  -- sem barbearia / sem plano: bloqueia em vez de liberar
  END IF;

  IF _limit IS NULL THEN
    RETURN true;   -- ilimitado
  END IF;

  SELECT count(*) INTO _used
  FROM public.user_roles ur
  WHERE ur.barbershop_id = _barbershop_id
    AND public.role_counts_toward_barber_limit(ur.role);

  RETURN _used < _limit;
END;
$$;

-- ------------------------------------------------------------------
-- 4) accept_team_invitation: erro legível em vez de exceção crua
-- ------------------------------------------------------------------
-- O trigger já bloqueia o aceite acima do limite mesmo aqui (SECURITY DEFINER
-- não pula triggers). Capturamos a exceção para devolver o mesmo formato
-- jsonb {success:false, error:...} que o restante da função usa, mantendo o
-- convite como `pending` para poder ser aceito após um upgrade.
-- O EXCEPTION é estreito de propósito: só check_violation, o código que o
-- enforcement de limite levanta. Nenhum outro erro é engolido.
CREATE OR REPLACE FUNCTION public.accept_team_invitation(_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invitation RECORD;
  _user_id UUID;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não autenticado');
  END IF;

  SELECT * INTO _invitation
  FROM public.team_invitations
  WHERE token = _token AND status = 'pending'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Convite não encontrado ou expirado');
  END IF;

  IF _invitation.expires_at < now() THEN
    UPDATE public.team_invitations SET status = 'expired', updated_at = now() WHERE id = _invitation.id;
    RETURN jsonb_build_object('success', false, 'error', 'Convite expirado');
  END IF;

  -- Verify email matches
  IF _invitation.email != (SELECT email FROM auth.users WHERE id = _user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este convite não é para o seu email');
  END IF;

  -- Add role — o trigger trg_enforce_barber_limit valida o limite do plano.
  BEGIN
    INSERT INTO public.user_roles (user_id, barbershop_id, role)
    VALUES (_user_id, _invitation.barbershop_id, _invitation.role)
    ON CONFLICT DO NOTHING;
  EXCEPTION
    WHEN check_violation THEN
      -- Convite continua pending: pode ser aceito depois de um upgrade.
      RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  -- Mark as accepted
  UPDATE public.team_invitations SET status = 'accepted', updated_at = now() WHERE id = _invitation.id;

  RETURN jsonb_build_object('success', true, 'barbershop_id', _invitation.barbershop_id);
END;
$$;
