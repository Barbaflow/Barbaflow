-- ============================================================================
-- Proteção server-side do ÚLTIMO admin_barbearia
-- ----------------------------------------------------------------------------
-- PROBLEMA CORRIGIDO (auditoria pré-push)
--
-- O mock (`src/mocks/rules.ts`) já impede remover ou rebaixar o último
-- `admin_barbearia` de uma barbearia, mas o banco real não tinha NENHUMA
-- proteção equivalente. As policies de `public.user_roles` deixam qualquer
-- admin_barbearia apagar linhas da própria barbearia e deixam super_admin
-- apagar qualquer linha. Bastava um DELETE pelo PostgREST — ou a exclusão de
-- uma conta cujo dono era o único admin — para a barbearia continuar existindo
-- sem ninguém capaz de administrá-la: serviços, equipe, horários e
-- agendamentos ficavam órfãos, sem caminho de recuperação pela interface.
--
-- ----------------------------------------------------------------------------
-- POR QUE UM CONSTRAINT TRIGGER DIFERIDO (e não um BEFORE DELETE)
--
-- Um `BEFORE DELETE` ingênuo ("se é o último admin, aborte") quebraria três
-- operações legítimas:
--
--   * excluir a barbearia inteira — o `ON DELETE CASCADE` de
--     `user_roles.barbershop_id` apaga os papéis, e o BEFORE veria "último
--     admin sendo removido" sem saber que a barbearia também está indo embora;
--   * transferir a administração — promover B e remover A na mesma transação
--     falharia ou não, dependendo da ORDEM dos comandos;
--   * o cascade de `auth.users` quando o usuário não é admin de nada.
--
-- `CREATE CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` resolve os
-- três: a checagem roda no COMMIT, sobre o ESTADO FINAL da transação. Nesse
-- momento a barbearia excluída já não existe (a validação se auto-dispensa) e
-- o admin recém-promovido já existe (a transferência passa). A regra fica
-- sendo, literalmente, um invariante de fim de transação:
--
--     toda barbearia que AINDA EXISTE tem >= 1 admin_barbearia
--     (exceto a sentinela `_system`, que ancora só papéis globais)
--
-- ----------------------------------------------------------------------------
-- ESCOPO
--
--   * dispara em DELETE e UPDATE de `public.user_roles`;
--   * só interessa quando a linha afetada ERA `admin_barbearia`;
--   * INSERT não dispara: uma barbearia recém-criada fica alguns instantes sem
--     admin porque o OnboardingWizard cria a barbearia e o papel em REQUISIÇÕES
--     (e portanto transações) separadas. A regra protege contra PERDER o último
--     admin, não contra nunca ter tido um;
--   * a sentinela `_system` (id 000…000 / subdomain `_system`), que existe só
--     para ancorar o papel global `super_admin`, é isenta;
--   * super_admin não é substituto de admin_barbearia e não conta para a regra.
--
-- Idempotente e seguro em base vazia. Posterior a 20260720130000.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1) Invariante em uma função reutilizável
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.barbershop_is_system_sentinel(_barbershop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _barbershop_id = '00000000-0000-0000-0000-000000000000'::uuid
      OR EXISTS (
           SELECT 1 FROM public.barbershops b
           WHERE b.id = _barbershop_id AND b.subdomain = '_system'
         )
$$;

COMMENT ON FUNCTION public.barbershop_is_system_sentinel(uuid) IS
  'Barbearia sentinela `_system`, criada por supabase/bootstrap para ancorar o papel global super_admin. Isenta das regras de equipe (não precisa de admin_barbearia).';

-- Superfície mínima: só o trigger SECURITY DEFINER abaixo chama esta função
-- (e executa como o dono, postgres). Nenhum papel de API precisa de EXECUTE.
REVOKE ALL ON FUNCTION public.barbershop_is_system_sentinel(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------
-- 2) Checagem diferida
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_last_barbershop_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _shop_name text;
BEGIN
  -- (a) a linha afetada precisa ter sido um admin ------------------------
  IF OLD.role IS DISTINCT FROM 'admin_barbearia'::public.app_role THEN
    RETURN NULL;
  END IF;

  -- (b) UPDATE que mantém o admin na mesma barbearia não remove nada -----
  IF TG_OP = 'UPDATE'
     AND NEW.role = 'admin_barbearia'::public.app_role
     AND NEW.barbershop_id = OLD.barbershop_id THEN
    RETURN NULL;
  END IF;

  -- (c) a barbearia ainda existe no estado final? -------------------------
  -- Aqui mora o suporte a cascata: se a própria barbearia foi excluída
  -- (DELETE direto ou ON DELETE CASCADE), não há nada a proteger.
  SELECT b.name INTO _shop_name
  FROM public.barbershops b
  WHERE b.id = OLD.barbershop_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- (d) sentinela `_system` é isenta --------------------------------------
  IF public.barbershop_is_system_sentinel(OLD.barbershop_id) THEN
    RETURN NULL;
  END IF;

  -- (e) invariante: sobrou pelo menos um admin? ---------------------------
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.barbershop_id = OLD.barbershop_id
      AND ur.role = 'admin_barbearia'::public.app_role
  ) THEN
    RETURN NULL;
  END IF;

  RAISE EXCEPTION
    'A barbearia "%" ficaria sem administrador.', _shop_name
    USING ERRCODE = 'restrict_violation',
          HINT = 'Promova outro membro a admin_barbearia na mesma operação, transfira a administração ou exclua a barbearia inteira.';
END;
$$;

COMMENT ON FUNCTION public.enforce_last_barbershop_admin() IS
  'Invariante de fim de transação: toda barbearia existente (exceto a sentinela _system) tem ao menos um admin_barbearia. Diferido para permitir transferência de administração e exclusão em cascata da barbearia.';

DROP TRIGGER IF EXISTS trg_protect_last_barbershop_admin ON public.user_roles;
CREATE CONSTRAINT TRIGGER trg_protect_last_barbershop_admin
  AFTER DELETE OR UPDATE ON public.user_roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_last_barbershop_admin();
