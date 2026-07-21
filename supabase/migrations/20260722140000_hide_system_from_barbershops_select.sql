-- ============================================================================
-- A sentinela `_system` sai também da leitura direta de public.barbershops
-- ----------------------------------------------------------------------------
-- PROBLEMA CONFIRMADO
--
-- A migration 20260722130000 tirou a sentinela da view `barbearias_publicas`,
-- mas a TABELA continuava exposta. Verificado contra o projeto real, com a
-- chave publishable:
--
--     barbearias_publicas → 0 linhas
--     barbershops         → 1 linha: "_system"
--
-- A causa é a policy de SELECT, cuja primeira alternativa é apenas
-- `status = 'approved'`. A sentinela nasce `approved` (o bootstrap a cria
-- assim, e o DEFAULT da coluna é 'approved' desde 20260416002727), então ela
-- casa nessa alternativa para QUALQUER papel — inclusive `anon`.
--
-- Esconder no frontend não resolve: `PublicBookingWizard`, `use-barbershop`,
-- `routes/barbearias` e `AdminDashboard` já filtram `_system` no cliente, e
-- ainda assim um `GET /rest/v1/barbershops` com a chave anônima devolvia a
-- linha. Filtro de frontend não é proteção; a regra tem que estar na RLS.
--
-- ----------------------------------------------------------------------------
-- AUDITORIA DAS POLICIES DE public.barbershops
--
-- Existe UMA ÚNICA policy de SELECT (as demais são INSERT/UPDATE/DELETE), todas
-- PERMISSIVE, e a de SELECT não tem cláusula TO — vale para todos os papéis,
-- inclusive `anon`:
--
--   "Anyone can view approved barbershops"  SELECT  PERMISSIVE  (todos)
--     USING ( status = 'approved'
--             OR owner_id = auth.uid()
--             OR has_role(auth.uid(), 'super_admin') )
--
-- Por ser a única policy de SELECT, não há interação com outras a preservar:
-- restringir esta expressão é suficiente e não é anulado por nenhuma outra.
--
-- Caminhos de acesso legítimos que ela concede hoje, e que precisam sobreviver:
--
--   * público / equipe  → barbearia `approved` (páginas públicas, agendamento,
--                         resolução de tenant por subdomínio, telas internas de
--                         barbeiro e admin);
--   * proprietário      → a própria barbearia em QUALQUER status, inclusive
--                         durante o onboarding e se for `pending`/`rejected`;
--   * super_admin       → tudo, em qualquer status, inclusive a sentinela
--                         (o AdminDashboard depende disso para moderar).
--
-- ----------------------------------------------------------------------------
-- A CORREÇÃO
--
-- Somente a PRIMEIRA alternativa é restringida:
--
--     status = 'approved'   →   status = 'approved' AND subdomain <> '_system'
--
-- As outras duas ficam intactas. Isso é o que preserva todos os caminhos
-- autorizados:
--
--   * a equipe (`barbeiro`, `admin_barbearia`) não perde nada: ninguém
--     trabalha na sentinela — o único papel ancorado nela é `super_admin`,
--     coberto pela terceira alternativa;
--   * o proprietário continua vendo a própria barbearia em qualquer status
--     pela segunda alternativa, que nem toca em `subdomain`;
--   * o super_admin continua vendo a sentinela pela terceira alternativa (e,
--     como o bootstrap o define como `owner_id` dela, também pela segunda);
--   * `service_role` tem BYPASSRLS e não é afetado por policy nenhuma.
--
-- Usamos o predicado literal `subdomain <> '_system'` em vez de
-- `public.barbershop_is_system_sentinel(id)`: aquela função é SECURITY DEFINER
-- e teve EXECUTE revogado de anon/authenticated em 20260721130000. Expressão de
-- policy roda com os privilégios de quem consulta, então chamá-la aqui
-- quebraria toda a leitura pública. `subdomain` é UNIQUE, então o predicado
-- simples identifica a sentinela sem ambiguidade. É o mesmo critério já usado
-- na view em 20260722130000.
--
-- Escopo: só a policy de SELECT. RLS continua habilitada, os grants de tabela
-- não mudam, a view não é tocada, a sentinela não é alterada, `user_roles` não
-- é alterada, nenhum dado é inserido. Posterior a 20260722130000; nenhuma das
-- 63 migrations anteriores é modificada.
-- ============================================================================

DROP POLICY IF EXISTS "Anyone can view approved barbershops" ON public.barbershops;

CREATE POLICY "Anyone can view approved barbershops"
  ON public.barbershops
  FOR SELECT
  USING (
    -- Público e equipe: barbearias aprovadas, exceto a sentinela.
    (status = 'approved'::public.approval_status AND subdomain <> '_system')
    -- Proprietário: a própria barbearia em qualquer status (onboarding,
    -- pending, rejected).
    OR owner_id = auth.uid()
    -- Super admin: tudo, inclusive a sentinela (moderação no AdminDashboard).
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Anyone can view approved barbershops" ON public.barbershops IS
  'Leitura pública restrita a barbearias aprovadas que não sejam a sentinela _system; o proprietário vê a própria em qualquer status e o super_admin vê todas.';

-- RLS permanece habilitada (reafirmado; a tabela já a tinha desde
-- 20260415164717 e esta migration não a desliga em momento algum).
ALTER TABLE public.barbershops ENABLE ROW LEVEL SECURITY;
