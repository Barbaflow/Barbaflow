-- ============================================================================
-- Onboarding: o dono da barbearia pode criar o próprio vínculo de admin
-- ----------------------------------------------------------------------------
-- PROBLEMA COMPROVADO
--
-- O onboarding nunca funcionou de ponta a ponta contra a RLS real. Reproduzido
-- no Supabase local, com uma conta comum recém-criada e o mesmo caminho do
-- OnboardingWizard (Data API, papel `authenticated`):
--
--   passo 2 — INSERT em public.barbershops  → 201 Created
--   passo 4 — INSERT em public.user_roles   → 403
--             {"code":"42501","message":"new row violates row-level security
--              policy for table \"user_roles\""}
--
--   estado final: 1 barbearia, 0 papéis.
--
-- A causa é a policy de INSERT de `public.user_roles`:
--
--   "Super admins can manage all roles"  INSERT  TO authenticated
--     WITH CHECK ( has_role(auth.uid(), 'super_admin')
--                  OR has_role_in_barbershop(auth.uid(), barbershop_id,
--                                            'admin_barbearia') )
--
-- Ela exige que o usuário JÁ SEJA admin daquela barbearia para poder criar um
-- papel nela. Quem acabou de criar a própria barbearia não é — e não tem como
-- passar a ser, porque o único caminho para virar admin é justamente este
-- INSERT. É um impasse: a condição de entrada exige o resultado.
--
-- O efeito prático é uma barbearia órfã a cada onboarding: existe, tem dono,
-- e ninguém consegue administrá-la pela interface. Como o wizard não checava o
-- erro do passo 4, ele ainda anunciava "Barbearia criada com sucesso!".
--
-- ----------------------------------------------------------------------------
-- A CORREÇÃO
--
-- Uma terceira alternativa na MESMA policy, deliberadamente estreita — as duas
-- existentes ficam intactas:
--
--     role = 'admin_barbearia'
--     AND user_id = auth.uid()
--     AND a barbearia alvo pertence a auth.uid()
--
-- As três condições valem juntas, então esta alternativa só permite:
--   * atribuir `admin_barbearia` — nunca `super_admin`, `barbeiro` ou
--     `cliente` (e o trigger `enforce_barber_limit` continua barrando
--     auto-promoção a super_admin por qualquer via);
--   * a SI MESMO — `user_id` tem de ser o próprio chamador, então ninguém
--     vincula terceiros;
--   * na PRÓPRIA barbearia — `owner_id = auth.uid()`, verificado na tabela.
--
-- Não há escalação: o dono já controla integralmente a própria barbearia (a
-- policy de UPDATE de `barbershops` é `owner_id = auth.uid()`), e não é
-- possível se tornar dono de uma barbearia alheia — a mesma policy de UPDATE
-- impede alterar `owner_id` de linha de terceiro. Nenhum outro tenant é
-- alcançado.
--
-- Continua valendo tudo que já protegia esta tabela:
--   * `trg_enforce_barber_limit` — limite de profissionais do plano e bloqueio
--     de auto-promoção a super_admin;
--   * `trg_protect_last_barbershop_admin` — a barbearia não fica sem admin;
--   * as policies de UPDATE e DELETE, que não são tocadas aqui.
--
-- Esta alternativa também torna possível uma recuperação segura: um dono que
-- ficou órfão por causa do bug (barbearia criada, papel não) consegue concluir
-- o próprio vínculo pela interface, sem intervenção manual no banco e sem
-- criar uma segunda barbearia.
--
-- Escopo: só a policy de INSERT de `public.user_roles`. RLS continua
-- habilitada, nenhum grant muda, nenhum dado é inserido, a sentinela não é
-- tocada. Posterior a 20260722140000; nenhuma das 64 migrations anteriores é
-- modificada.
-- ============================================================================

DROP POLICY IF EXISTS "Super admins can manage all roles" ON public.user_roles;

CREATE POLICY "Super admins can manage all roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Super admin: qualquer papel, em qualquer barbearia.
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    -- Admin da barbearia: monta a própria equipe.
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
    -- Dono no onboarding: cria o PRÓPRIO vínculo de admin na PRÓPRIA barbearia.
    OR (
      role = 'admin_barbearia'::public.app_role
      AND user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.barbershops b
        WHERE b.id = barbershop_id
          AND b.owner_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY "Super admins can manage all roles" ON public.user_roles IS
  'INSERT de papéis: super_admin em qualquer barbearia; admin_barbearia na própria equipe; e o dono da barbearia criando o próprio vínculo admin_barbearia (onboarding e recuperação de barbearia órfã).';

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
