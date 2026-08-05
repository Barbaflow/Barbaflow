-- Só `barbeiro` atende clientes. `admin_barbearia` administra.
--
-- DECISÃO DE PRODUTO, não correção de defeito: o papel de administração deixa
-- de ser tratado como profissional atendível. Até aqui as duas RPCs de
-- listagem filtravam `role IN ('barbeiro','admin_barbearia')`, e o admin
-- aparecia na página pública de agendamento e na criação de comanda como se
-- fosse mais um da equipe.
--
-- O QUE ESTA MIGRATION NÃO FAZ, E É O PONTO
-- Não apaga, não desativa e não migra NADA. Histórico fica intacto:
--
--   • `appointments.barber_id` continua apontando para quem atendeu, inclusive
--     admins. Os relatórios agrupam por `barber_id` e NÃO derivam de
--     `user_roles` (`report_by_barber`, `get_dashboard_summary`), então quem
--     já atendeu continua aparecendo, com o nome resolvido por
--     `get_barber_display_names`, que também não filtra papel;
--   • `weekly_schedule`, `availability`, `services` e `tickets` já gravados
--     seguem como estão. A mudança é sobre quem pode ser ESCOLHIDO daqui para
--     frente, não sobre o que já aconteceu.
--
-- CONSEQUÊNCIA CONHECIDA E ACEITA: barbearia cujo único integrante é o
-- `admin_barbearia` fica sem NENHUM profissional atendível, e a página pública
-- passa a mostrar "Nenhum barbeiro disponível". É o caso de
-- `wwwpaulobabershopcom` hoje (1 admin, 0 barbeiros). Verificado: é dado de
-- teste, sem usuário real. Quem for usar para valer precisa convidar um
-- `barbeiro` — e, pela regra de papel único (20260805160000), a mesma pessoa
-- não pode acumular os dois papéis, então é convite a outra conta ou troca do
-- próprio papel.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE FICA DE FORA DE PROPÓSITO
--
-- "Atendível" e "staff" são coisas diferentes, e só a primeira muda. As ~50
-- policies e as funções que citam `admin_barbearia` para AUTORIZAR —
-- `viewer_is_barbershop_staff`, `open_ticket`, `close_ticket`,
-- `create_walkin_client`, `get_client_phone`, `get_barbershop_clients`,
-- `report_barber_scope` — respondem "pode operar?", não "atende?". Nenhuma é
-- tocada: o admin continua abrindo comanda, lançando item, vendo cliente e
-- relatório. Ele só não é mais uma opção de profissional.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O LIMITE DO PLANO ENTRA JUNTO
--
-- `role_counts_toward_barber_limit` contava os DOIS papéis, então o admin
-- ocupava uma vaga de PROFISSIONAL. Se ele não atende, essa vaga não faz mais
-- sentido — e no plano free, cujo limite é 1, ela era a diferença entre poder
-- e não poder ter um barbeiro de verdade.
--
-- A mudança é PERMISSIVA por construção (`barbeiro` é subconjunto de
-- `barbeiro` + `admin_barbearia`: a contagem só pode cair), e foi conferida no
-- remoto imediatamente antes de escrever:
--
--     _system                     free  limite 1   hoje=0 → depois=0
--     barbearia-central-teste     pro   ilimitado  hoje=5 → depois=4
--     barbearia-demo-cliente      pro   ilimitado  hoje=4 → depois=3
--     barbearia-vila-nova-teste   pro   ilimitado  hoje=4 → depois=3
--     wwwpaulobabershopcom        pro   ilimitado  hoje=1 → depois=0
--
-- Nenhuma barbearia passa a violar o limite.
--
-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÕES APÓS APLICAR
--   • como anon: `get_public_barbers_v2` de uma barbearia com admin + barbeiros
--     devolve SÓ os barbeiros;
--   • `get_public_barbers` (usada por NewComandaDialog) idem;
--   • uma barbearia só com admin devolve [] nas duas — e a página pública
--     mostra "Nenhum barbeiro disponível", que é o esperado;
--   • como admin: criar grade semanal própria é RECUSADO;
--   • como barbeiro: criar a própria grade continua funcionando;
--   • relatórios continuam mostrando atendimentos antigos feitos por admin;
--   • `role_counts_toward_barber_limit('admin_barbearia')` => false.
--
-- ROLLBACK
--   -- restaura o filtro das duas RPCs, da policy e da função de limite para
--   -- `IN ('barbeiro','admin_barbearia')`. O SQL anterior está em
--   -- 20260420123902, 20260804120000, 20260415174831 e 20260722xxxxx
--   -- respectivamente; nenhum dado precisa ser mexido para reverter.
-- ============================================================================

/* ═══════════ 1. quem aparece como profissional ════════════════════════════ */

-- A antiga, ainda usada por NewComandaDialog (tela interna).
CREATE OR REPLACE FUNCTION public.get_public_barbers(_barbershop_id uuid)
RETURNS TABLE (user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ur.user_id
  FROM public.user_roles ur
  JOIN public.barbershops b ON b.id = ur.barbershop_id
  WHERE ur.barbershop_id = _barbershop_id
    AND b.status = 'approved'
    -- Era `IN ('barbeiro','admin_barbearia')`. Administração não atende.
    AND ur.role = 'barbeiro';
$$;

-- A do caminho público. `is_owner` CONTINUA existindo: um barbeiro pode ser o
-- dono da barbearia sem ser o administrador dela, e a tela usa o selo.
CREATE OR REPLACE FUNCTION public.get_public_barbers_v2(_barbershop_id uuid)
RETURNS TABLE (
  user_id  uuid,
  is_owner boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT
    ur.user_id,
    (ur.user_id = b.owner_id) AS is_owner
  FROM public.user_roles ur
  JOIN public.barbershops b ON b.id = ur.barbershop_id
  WHERE ur.barbershop_id = _barbershop_id
    AND _barbershop_id IS NOT NULL
    AND b.status = 'approved'
    AND b.subdomain <> '_system'
    -- Era `IN ('barbeiro','admin_barbearia')`.
    AND ur.role = 'barbeiro'
  ORDER BY is_owner DESC, ur.user_id ASC;
$$;

COMMENT ON FUNCTION public.get_public_barbers_v2(uuid) IS
  'Profissionais visíveis na página pública de uma barbearia aprovada, com '
  'is_owner calculado no servidor. Desde 20260805200000 só `barbeiro` entra — '
  'admin_barbearia administra, não atende. Barbearia sem nenhum barbeiro '
  'devolve lista vazia, e a página mostra que não há profissional disponível.';

/* ═══════════ 2. quem pode ter grade semanal ═══════════════════════════════ */

-- Sem esta troca, o admin continuaria cadastrando uma grade que ninguém pode
-- escolher — dado que só serviria para confundir quem olha a agenda.
DROP POLICY IF EXISTS "Barbers can create own schedule" ON public.weekly_schedule;

CREATE POLICY "Barbers can create own schedule"
  ON public.weekly_schedule
  FOR INSERT
  TO authenticated
  WITH CHECK (
    barber_id = auth.uid()
    AND public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
  );

COMMENT ON POLICY "Barbers can create own schedule" ON public.weekly_schedule IS
  'Só quem atende cadastra grade, e só a própria. Desde 20260805200000 o '
  'admin_barbearia está fora: ele não é mais profissional atendível. As linhas '
  'que ele já tinha NÃO são apagadas — o histórico de relatórios depende delas.';

/* ═══════════ 3. quem ocupa vaga de profissional no plano ══════════════════ */

CREATE OR REPLACE FUNCTION public.role_counts_toward_barber_limit(_role public.app_role)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  -- Era `IN ('barbeiro','admin_barbearia')`. O admin não atende, então não
  -- ocupa vaga de profissional — no plano free, cujo limite é 1, essa vaga era
  -- a diferença entre poder e não poder ter um barbeiro de verdade.
  SELECT _role = 'barbeiro'::public.app_role
$$;

COMMENT ON FUNCTION public.role_counts_toward_barber_limit(public.app_role) IS
  'Papéis que consomem o limite de profissionais do plano: só `barbeiro`, '
  'desde 20260805200000. Mudança PERMISSIVA — a contagem só pode cair, e '
  'nenhuma barbearia passou a violar o limite (conferido no remoto antes).';
