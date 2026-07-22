-- ============================================================================
-- Leitura do próprio catálogo e edição das configurações pela equipe do tenant
-- ----------------------------------------------------------------------------
-- PROBLEMAS CORRIGIDOS (auditoria dos módulos serviços / equipe / configurações
-- contra o Supabase real)
--
-- (1) `public.services` — SELECT exigia barbearia APROVADA
--
--     A policy criada em 20260415170006 é:
--
--       USING (EXISTS (SELECT 1 FROM barbershops b
--                       WHERE b.id = barbershop_id AND b.status = 'approved')
--              OR has_role(auth.uid(), 'super_admin'))
--
--     `public.barbershops.status` tem DEFAULT 'pending' (20260415164717) e o
--     OnboardingWizard não envia status. Logo, TODA barbearia recém-criada
--     nasce `pending` — inclusive a primeira barbearia real do projeto.
--
--     Consequência comprovada: o administrador dessa barbearia CONSEGUE
--     inserir serviços (a policy de INSERT só olha o papel), mas o SELECT
--     seguinte devolve zero linhas. A aba "Serviços" mostra "Nenhum serviço
--     cadastrado ainda" logo após cadastrar um — sem erro, sem explicação, e
--     sem caminho de recuperação pela interface enquanto o super_admin não
--     aprovar a barbearia. Não é um problema de estado do frontend: a linha
--     existe no banco e a leitura é recusada pela RLS.
--
-- (2) `public.availability` — mesmo defeito, mesma origem
--
--     Idêntica em forma e em causa (mesma migration, mesmo predicado). A grade
--     gerada por `generate_availability_from_schedule` fica invisível para a
--     própria equipe enquanto a barbearia estiver `pending`.
--
-- (3) `public.barbershops` — a EQUIPE não enxerga a própria barbearia pendente
--
--     A policy de SELECT (última versão em 20260722140000) libera: aprovada e
--     não-sentinela, OU proprietário, OU super_admin. Um `admin_barbearia`
--     convidado ou um `barbeiro` que não seja o dono não enxerga a linha
--     enquanto a barbearia estiver `pending`.
--
--     Consequência comprovada: `useBarbershop` resolve o tenant lendo
--     `user_roles` e depois `barbershops WHERE id = <papel>`. Com a linha
--     invisível, essa leitura volta vazia e o aplicativo inteiro conclui
--     "nenhuma barbearia vinculada" — nenhuma tela funciona para esse usuário.
--
-- (4) `public.barbershops` — UPDATE só para o PROPRIETÁRIO
--
--     A policy de 20260415164717 é `USING (owner_id = auth.uid() OR
--     has_role(auth.uid(), 'super_admin'))`. Um `admin_barbearia` que não seja
--     o dono — o caso normal de quem entra por convite com papel de
--     administrador — não altera NADA da barbearia: logo, cores, endereço,
--     horário limite de cancelamento, política de no-show, textos do recibo.
--
--     Pior: um UPDATE barrado pela RLS não devolve erro, devolve ZERO LINHAS.
--     A tela exibia "Salvo!" para uma alteração que o banco recusou. O
--     frontend passou a checar as linhas afetadas nesta mesma tarefa, mas isso
--     só torna a recusa VISÍVEL — a permissão que falta é do schema.
--
-- (5) `public.team_invitations` — policies liam `auth.users`
--
--     As policies de SELECT e UPDATE (20260415174544) contêm
--     `email = (SELECT email FROM auth.users WHERE id = auth.uid())`, e
--     `authenticated` não tem SELECT em `auth.users`. Como o privilégio de
--     tabela é verificado independentemente de qual ramo do OR seria
--     verdadeiro, TODA leitura de convites falha com `42501 permission denied
--     for table users` — inclusive a do próprio administrador. A seção
--     "Convites Pendentes" da tela de Equipe nunca funcionou contra o
--     Supabase real, e o cancelamento de convite falhava pelo mesmo motivo.
--
-- ----------------------------------------------------------------------------
-- PRIVILÉGIO MÍNIMO
--
--   * (1), (2) e (3) apenas ADICIONAM uma alternativa de LEITURA para quem já
--     é equipe (`admin_barbearia`/`barbeiro` daquela barbearia) ou
--     proprietário dela. A leitura pública continua restrita a barbearias
--     `approved`; nenhuma linha nova fica visível para `anon` ou para
--     clientes, e a sentinela `_system` continua oculta;
--
--   * (4) adiciona `admin_barbearia` DAQUELA barbearia à policy de UPDATE.
--     Não amplia o que pode ser alterado: `plan_id` e `status` continuam
--     bloqueados para qualquer não-privilegiado pelo trigger
--     `trg_enforce_barbershop_plan` (20260721120000), que roda BEFORE UPDATE e
--     recusa com erro — inclusive para o proprietário;
--
--   * como (4) passa a permitir que um administrador não-proprietário edite a
--     linha, `owner_id` deixa de ser alterável por não-privilegiado. Sem isso,
--     um administrador convidado poderia se tornar dono da barbearia — uma
--     escalação que a policy antiga impedia por acidente (só o dono editava).
--     Postgres não permite comparar OLD/NEW em WITH CHECK, então a
--     imutabilidade fica em um trigger, não em policy;
--
--   * (5) troca o subselect em `auth.users` por `auth.email()`, helper padrão
--     do Supabase que lê o claim do JWT verificado e já tem EXECUTE para
--     `authenticated`. A semântica é preservada e nenhum acesso novo a
--     `auth` é concedido.
--
-- Nada é concedido a `anon` além de EXECUTE no predicado
-- `viewer_is_barbershop_staff`, que não aceita user_id de terceiros e devolve
-- `false` para não autenticados (ver item 0). Nenhum GRANT de tabela novo é
-- necessário: `authenticated` já tem SELECT em services/availability/
-- team_invitations e UPDATE em barbershops desde 20260721140000 — o que
-- faltava era a POLICY, não o privilégio de tabela. `service_role`
-- (BYPASSRLS) não é afetado.
--
-- Idempotente e seguro em base vazia. Posterior a 20260722160000; nenhuma das
-- 66 migrations anteriores é modificada.
-- ============================================================================

-- ------------------------------------------------------------------
-- 0) Predicado de "equipe da barbearia" seguro para policy pública
-- ------------------------------------------------------------------
-- Expressão de policy roda com os privilégios de QUEM CONSULTA. As policies de
-- services/availability têm role `public`, então `anon` também as avalia — e
-- `anon` não tem EXECUTE em `has_role_in_barbershop` nem SELECT em
-- `public.user_roles`. Usar qualquer um dos dois direto na policy faria toda a
-- vitrine pública responder `42501 permission denied` (verificado: a página
-- pública de serviços quebrou no primeiro teste desta migration).
--
-- Este helper resolve isso sem alargar a superfície: é SECURITY DEFINER, NÃO
-- recebe user_id (usa sempre `auth.uid()`), e devolve `false` de imediato para
-- quem não está autenticado. Um visitante anônimo, portanto, não consegue
-- sondar o papel de ninguém — diferente de conceder `has_role_in_barbershop` a
-- `anon`, que aceitaria um user_id arbitrário.
CREATE OR REPLACE FUNCTION public.viewer_is_barbershop_staff(_barbershop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       -- Equipe: admin_barbearia ou barbeiro daquela barbearia.
       EXISTS (
         SELECT 1 FROM public.user_roles ur
         WHERE ur.user_id = auth.uid()
           AND ur.barbershop_id = _barbershop_id
           AND ur.role IN ('admin_barbearia'::public.app_role, 'barbeiro'::public.app_role)
       )
       -- Proprietário: cobre a janela entre criar a barbearia e ter o papel.
       OR EXISTS (
         SELECT 1 FROM public.barbershops b
         WHERE b.id = _barbershop_id AND b.owner_id = auth.uid()
       )
     )
$$;

COMMENT ON FUNCTION public.viewer_is_barbershop_staff(uuid) IS
  'true quando QUEM CONSULTA (auth.uid()) é equipe (admin_barbearia/barbeiro) ou proprietário da barbearia informada. Não aceita user_id de terceiros e devolve false para não autenticados — pode ser avaliada por policies com role public.';

REVOKE ALL ON FUNCTION public.viewer_is_barbershop_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.viewer_is_barbershop_staff(uuid) TO anon, authenticated;

-- ------------------------------------------------------------------
-- 1) services — a equipe lê o próprio catálogo em qualquer status
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view services of approved barbershops" ON public.services;

CREATE POLICY "Anyone can view services of approved barbershops"
  ON public.services
  FOR SELECT
  USING (
    -- Público: catálogo de barbearias aprovadas (inalterado).
    EXISTS (
      SELECT 1 FROM public.barbershops b
      WHERE b.id = barbershop_id AND b.status = 'approved'::public.approval_status
    )
    -- Equipe/proprietário da própria barbearia, em qualquer status.
    OR public.viewer_is_barbershop_staff(barbershop_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Anyone can view services of approved barbershops" ON public.services IS
  'Leitura pública do catálogo de barbearias aprovadas; a equipe e o proprietário leem o catálogo da PRÓPRIA barbearia em qualquer status (inclusive pending, o padrão de toda barbearia recém-criada).';

-- ------------------------------------------------------------------
-- 2) availability — mesma correção, mesma justificativa
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view availability of approved barbershops" ON public.availability;

CREATE POLICY "Anyone can view availability of approved barbershops"
  ON public.availability
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.barbershops b
      WHERE b.id = barbershop_id AND b.status = 'approved'::public.approval_status
    )
    OR public.viewer_is_barbershop_staff(barbershop_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Anyone can view availability of approved barbershops" ON public.availability IS
  'Leitura pública da agenda de barbearias aprovadas; a equipe e o proprietário leem a própria agenda em qualquer status de aprovação.';

-- ------------------------------------------------------------------
-- 3) barbershops — a equipe enxerga a própria barbearia em qualquer status
-- ------------------------------------------------------------------
-- Terceira face do mesmo defeito. A policy de SELECT (última versão em
-- 20260722140000) libera: aprovada e não-sentinela, OU proprietário, OU
-- super_admin. Falta a EQUIPE: um `admin_barbearia` convidado ou um `barbeiro`
-- que não seja o dono NÃO ENXERGA a barbearia enquanto ela estiver `pending`
-- — o status padrão de toda barbearia recém-criada.
--
-- O efeito é maior do que parece: `useBarbershop` resolve o tenant lendo
-- `user_roles` e depois `barbershops WHERE id = <papel>`. Com a linha
-- invisível, essa leitura volta vazia e o app inteiro conclui "nenhuma
-- barbearia vinculada" para esse usuário. Nenhuma tela funciona para ele.
--
-- E, como o Postgres exige que a linha seja LEGÍVEL para ser atualizada, sem
-- esta correção a permissão de UPDATE do item (4) não teria efeito nenhum
-- numa barbearia pendente. Comprovado no banco local.
DROP POLICY IF EXISTS "Anyone can view approved barbershops" ON public.barbershops;

CREATE POLICY "Anyone can view approved barbershops"
  ON public.barbershops
  FOR SELECT
  USING (
    -- Público e equipe: barbearias aprovadas, exceto a sentinela (inalterado).
    (status = 'approved'::public.approval_status AND subdomain <> '_system')
    -- Proprietário: a própria barbearia em qualquer status (inalterado).
    OR owner_id = auth.uid()
    -- Equipe da barbearia (admin convidado, barbeiro): qualquer status, nunca
    -- a sentinela.
    OR (subdomain <> '_system' AND public.viewer_is_barbershop_staff(id))
    -- Super admin: tudo, inclusive a sentinela (moderação no AdminDashboard).
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Anyone can view approved barbershops" ON public.barbershops IS
  'Leitura pública restrita a barbearias aprovadas que não sejam a sentinela _system; o proprietário e a equipe (admin_barbearia/barbeiro) veem a própria em qualquer status; o super_admin vê todas.';

-- ------------------------------------------------------------------
-- 4) barbershops — o administrador do tenant edita a própria barbearia
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners and super admins can update barbershops" ON public.barbershops;

CREATE POLICY "Owners and super admins can update barbershops"
  ON public.barbershops
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    -- Administrador DAQUELA barbearia (o convidado com papel de admin).
    OR public.has_role_in_barbershop(auth.uid(), id, 'admin_barbearia'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.has_role_in_barbershop(auth.uid(), id, 'admin_barbearia'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Owners and super admins can update barbershops" ON public.barbershops IS
  'Proprietário, admin_barbearia daquela barbearia e super_admin atualizam a linha. plan_id e status continuam barrados pelo trigger trg_enforce_barbershop_plan; owner_id é imutável para não-privilegiados (trg_freeze_barbershop_owner).';

-- ------------------------------------------------------------------
-- 5) owner_id imutável para quem não é super_admin/backend
-- ------------------------------------------------------------------
-- Contrapartida direta do item (4): sem esta trava, o administrador convidado
-- que passou a poder editar a linha poderia gravar `owner_id = auth.uid()` e
-- assumir a barbearia. `subdomain` NÃO é congelado aqui — nenhuma tela o
-- altera hoje, e travá-lo seria uma restrição sem defeito comprovado por trás.
CREATE OR REPLACE FUNCTION public.freeze_barbershop_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    -- Mesma noção de "privilegiado" já usada por enforce_barbershop_plan.
    IF NOT (
      (_uid IS NOT NULL AND public.has_role(_uid, 'super_admin'::public.app_role))
      OR public.is_trusted_backend()
    ) THEN
      RAISE EXCEPTION
        'Transferir a propriedade da barbearia é uma operação administrativa.'
        USING ERRCODE = 'insufficient_privilege',
              HINT = 'Peça a um super_admin para alterar o proprietário.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.freeze_barbershop_owner() IS
  'Impede que owner_id de public.barbershops mude por API de usuário comum. Só super_admin ou backend confiável (service_role / conexão administrativa) transferem a propriedade.';

-- Superfície mínima: só o trigger (SECURITY DEFINER, executa como o dono)
-- chama esta função. Nenhum papel do Data API precisa de EXECUTE.
REVOKE ALL ON FUNCTION public.freeze_barbershop_owner() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_freeze_barbershop_owner ON public.barbershops;
CREATE TRIGGER trg_freeze_barbershop_owner
  BEFORE UPDATE ON public.barbershops
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_barbershop_owner();

-- ------------------------------------------------------------------
-- 6) team_invitations — policies liam auth.users e falhavam para TODOS
-- ------------------------------------------------------------------
-- As policies de SELECT e UPDATE criadas em 20260415174544 contêm:
--
--     OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
--
-- Expressão de policy roda com os privilégios de quem consulta, e
-- `authenticated` NÃO tem SELECT em `auth.users` (verificado:
-- `has_table_privilege('authenticated','auth.users','SELECT')` = false). O
-- Postgres checa o privilégio da tabela ao executar o comando, independente do
-- ramo do OR que seria verdadeiro — então QUALQUER leitura de
-- `public.team_invitations` falha com:
--
--     42501 permission denied for table users
--
-- inclusive a do próprio administrador da barbearia lendo os próprios
-- convites. Comprovado no banco local: a seção "Convites Pendentes" da tela de
-- Equipe nunca funcionou contra o Supabase real, e o cancelamento de convite
-- (UPDATE) falhava pelo mesmo motivo.
--
-- Correção de privilégio mínimo: trocar o subselect por `auth.email()` —
-- helper padrão do Supabase que lê o claim do JWT verificado, já com EXECUTE
-- para `authenticated`, sem tocar em `auth.users`. A semântica ("o convidado
-- enxerga o próprio convite") é preservada; nenhum acesso novo é concedido.
DROP POLICY IF EXISTS "Barbershop admins can view invitations" ON public.team_invitations;

CREATE POLICY "Barbershop admins can view invitations"
  ON public.team_invitations
  FOR SELECT
  TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
    OR lower(email) = lower(auth.email())
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Barbershop admins can view invitations" ON public.team_invitations IS
  'Administrador da barbearia vê os convites dela; o convidado vê o próprio convite pelo e-mail do JWT (auth.email(), sem acesso a auth.users); super_admin vê todos.';

DROP POLICY IF EXISTS "Barbershop admins can update invitations" ON public.team_invitations;

CREATE POLICY "Barbershop admins can update invitations"
  ON public.team_invitations
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
    OR lower(email) = lower(auth.email())
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Barbershop admins can update invitations" ON public.team_invitations IS
  'Cancelamento pelo administrador da barbearia e aceite/recusa pelo próprio convidado (e-mail do JWT). super_admin opera o tenant que selecionou.';

-- RLS permanece habilitada nas tabelas tocadas (reafirmado; nenhuma delas é
-- desligada em momento algum por esta migration).
ALTER TABLE public.services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbershops       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_invitations  ENABLE ROW LEVEL SECURITY;
