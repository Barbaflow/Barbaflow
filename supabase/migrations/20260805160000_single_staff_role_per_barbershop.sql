-- Um papel de equipe por pessoa, por barbearia.
--
-- REGRA: ninguém pode acumular `barbeiro` e `admin_barbearia` na MESMA
-- barbearia. Um dos dois, nunca os dois.
--
-- POR QUE ISSO VIROU REGRA
-- Existia um botão "Me adicionar como barbeiro" (TeamManager) que inseria o
-- papel `barbeiro` para quem já era `admin_barbearia`. A investigação que
-- motivou esta migration mostrou três coisas:
--
--   1. NINGUÉM usa. Zero contas acumulavam os dois papéis — conferido no
--      remoto em 05/08/2026, imediatamente antes de escrever este arquivo;
--   2. NÃO É PRECISO. `get_public_barbers` e `get_public_barbers_v2` filtram
--      `role IN ('barbeiro','admin_barbearia')`: o admin já aparece na lista
--      pública de profissionais e na de comanda nova sem o papel extra. A
--      barbearia real `wwwpaulobabershopcom` prova — 1 admin, 0 barbeiros, e o
--      dono tem grade semanal, 9 atendimentos e 4 serviços;
--   3. QUEBRA NO PLANO FREE. `role_counts_toward_barber_limit` conta os DOIS
--      papéis e `enforce_barber_limit` faz `count(*)` de LINHAS, não de
--      pessoas. O admin já ocupa uma vaga; ao se auto-adicionar ocuparia duas.
--      Com `free.barber_limit = 1`, o INSERT sempre falhava com "Limite de
--      profissionais do plano atingido (1)" — e o botão não era bloqueado pela
--      UI, então em toda barbearia nova ele aparecia e sempre dava erro.
--
-- Ou seja: o acúmulo não servia para nada, gastava vaga de plano onde
-- funcionava, e era erro garantido onde não funcionava.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE TRIGGER **E** ÍNDICE, E NÃO UM SÓ
--
-- Os dois cobrem buracos diferentes, e nenhum cobre o do outro:
--
--   • o TRIGGER dá a MENSAGEM. Um índice único sozinho devolveria
--     `23505 duplicate key value violates unique constraint …`, que é erro
--     genérico de banco vazando para a tela — o oposto do que a §8 do
--     CLAUDE.md pede;
--   • o ÍNDICE dá a GARANTIA sob concorrência. O `EXISTS` do trigger não
--     enxerga linha ainda não commitada: duas transações simultâneas, uma
--     inserindo `barbeiro` e outra `admin_barbearia` para a mesma pessoa,
--     passariam as duas pelo trigger e violariam a regra. É o mesmo problema
--     que `enforce_barber_limit` resolve com `pg_advisory_xact_lock`; aqui o
--     índice parcial resolve de forma mais simples e mais forte.
--
-- Na prática o trigger (BEFORE) dispara primeiro e o usuário vê a mensagem
-- boa; o índice só entra na corrida rara.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE `check_violation`, E NÃO UMA SQLSTATE NOVA
--
-- `accept_team_invitation` (20260428172641) já tem:
--
--     EXCEPTION WHEN check_violation THEN
--       RETURN jsonb_build_object('success', false, 'error', SQLERRM);
--
-- Usando a MESMA SQLSTATE, a mensagem deste trigger atravessa a RPC sem
-- alterá-la e chega em `/convite` pelo caminho que já existe (`result.error`,
-- convite.tsx:70). Zero mudança naquela função.
--
-- E há um detalhe que só o trigger resolve: o INSERT dentro dela é
-- `ON CONFLICT DO NOTHING` SEM alvo, então uma violação do índice novo seria
-- ENGOLIDA em silêncio — o convite seria marcado como aceito e o papel não
-- entraria. Como o BEFORE trigger levanta antes de qualquer resolução de
-- conflito, o erro aparece em vez de sumir.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION NÃO FAZ
--
--   • não remove papel de ninguém — não há o que remover, a regra já vale de
--     fato hoje (zero violações);
--   • não impede a MESMA pessoa de ser staff de barbearias DIFERENTES: o
--     índice é por (user_id, barbershop_id);
--   • não toca no papel `cliente`, que fica fora do índice parcial de
--     propósito — um admin pode ser cliente da própria barbearia e agendar
--     como qualquer pessoa;
--   • não impede TROCAR de papel. Um `UPDATE` de `barbeiro` para
--     `admin_barbearia` continua válido: a linha é uma só, e o trigger olha as
--     OUTRAS linhas.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • `SELECT user_id, barbershop_id FROM public.user_roles
--      WHERE role IN ('barbeiro','admin_barbearia')
--      GROUP BY 1,2 HAVING count(*) > 1;`  -- => 0 linhas
--   • convidar como `barbeiro` um e-mail que já é `admin_barbearia` da mesma
--     barbearia: erro claro na hora de ENVIAR o convite;
--   • aceitar um convite antigo de `barbeiro` sendo admin da mesma barbearia:
--     `/convite` mostra a mensagem, e o convite continua `pending`;
--   • promover barbeiro a admin (UPDATE da linha) continua funcionando;
--   • a mesma pessoa continua podendo ser staff de duas barbearias.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_enforce_single_staff_role ON public.user_roles;
--   DROP TRIGGER IF EXISTS trg_enforce_invite_single_staff_role ON public.team_invitations;
--   DROP FUNCTION IF EXISTS public.enforce_single_staff_role();
--   DROP FUNCTION IF EXISTS public.enforce_invite_single_staff_role();
--   DROP INDEX IF EXISTS public.user_roles_one_staff_role_per_barbershop;
-- ============================================================================

/* ═══════════ 1. a garantia: um papel de staff por pessoa/barbearia ════════ */

-- Parcial de propósito: só os dois papéis de equipe entram. `cliente` e
-- `super_admin` ficam fora e podem coexistir com um deles.
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_staff_role_per_barbershop
  ON public.user_roles (user_id, barbershop_id)
  WHERE role IN ('barbeiro'::public.app_role, 'admin_barbearia'::public.app_role);

COMMENT ON INDEX public.user_roles_one_staff_role_per_barbershop IS
  'Ninguém acumula barbeiro + admin_barbearia na mesma barbearia. É o guarda '
  'sob concorrência — o EXISTS do trigger não vê linha não commitada. A '
  'mensagem amigável vem do trigger, que dispara antes.';

/* ═══════════ 2. a mensagem: trigger em user_roles ════════════════════════ */

CREATE OR REPLACE FUNCTION public.enforce_single_staff_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _outro public.app_role;
BEGIN
  -- Só os papéis de equipe se excluem entre si.
  IF NEW.role NOT IN ('barbeiro'::public.app_role, 'admin_barbearia'::public.app_role) THEN
    RETURN NEW;
  END IF;

  _outro := CASE NEW.role
              WHEN 'barbeiro'::public.app_role THEN 'admin_barbearia'::public.app_role
              ELSE 'barbeiro'::public.app_role
            END;

  -- `ur.id <> NEW.id` no UPDATE: trocar o papel da PRÓPRIA linha é legítimo, e
  -- sem esta condição a linha em edição bloquearia a si mesma.
  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = NEW.user_id
      AND ur.barbershop_id = NEW.barbershop_id
      AND ur.role = _outro
      AND (TG_OP = 'INSERT' OR ur.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION
      'Esta pessoa já é % desta barbearia. Cada pessoa tem um único papel por barbearia — administradores já aparecem na lista de profissionais para agendamento.',
      CASE _outro WHEN 'admin_barbearia'::public.app_role THEN 'administradora' ELSE 'barbeira' END
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_single_staff_role() IS
  'Recusa acumular barbeiro + admin_barbearia na mesma barbearia, com mensagem '
  'legível. Usa check_violation porque accept_team_invitation já trata essa '
  'SQLSTATE e devolve o SQLERRM à tela — sem isso, o ON CONFLICT DO NOTHING '
  'daquele INSERT engoliria a violação do índice em silêncio.';

DROP TRIGGER IF EXISTS trg_enforce_single_staff_role ON public.user_roles;
CREATE TRIGGER trg_enforce_single_staff_role
  BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_staff_role();

/* ═══════════ 3. falhar cedo: trigger em team_invitations ═════════════════ */

-- Sem isto, o convite seria criado, entregue, e só quebraria quando a pessoa
-- clicasse no link — com o convite já gasto do ponto de vista de quem enviou.
-- Aqui o erro aparece para quem convida, na hora.
CREATE OR REPLACE FUNCTION public.enforce_invite_single_staff_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _outro public.app_role;
BEGIN
  IF NEW.role NOT IN ('barbeiro'::public.app_role, 'admin_barbearia'::public.app_role) THEN
    RETURN NEW;
  END IF;

  _outro := CASE NEW.role
              WHEN 'barbeiro'::public.app_role THEN 'admin_barbearia'::public.app_role
              ELSE 'barbeiro'::public.app_role
            END;

  -- O convite guarda e-mail, não user_id: quem é convidado pode nem ter conta.
  -- Quando já tem, dá para checar agora; quando não tem, o trigger de
  -- `user_roles` pega no aceite. As duas camadas se completam.
  IF EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN auth.users u ON u.id = ur.user_id
    WHERE ur.barbershop_id = NEW.barbershop_id
      AND ur.role = _outro
      AND lower(u.email) = lower(NEW.email)
  ) THEN
    RAISE EXCEPTION
      'Esta pessoa já é % desta barbearia. Cada pessoa tem um único papel por barbearia — administradores já aparecem na lista de profissionais para agendamento.',
      CASE _outro WHEN 'admin_barbearia'::public.app_role THEN 'administradora' ELSE 'barbeira' END
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_invite_single_staff_role() IS
  'Recusa criar convite que resultaria em papel de equipe duplicado. Falha na '
  'hora de enviar, e não no clique de quem recebeu. Só alcança quem já tem '
  'conta — para o resto, o trigger de user_roles fecha no aceite.';

DROP TRIGGER IF EXISTS trg_enforce_invite_single_staff_role ON public.team_invitations;
CREATE TRIGGER trg_enforce_invite_single_staff_role
  BEFORE INSERT OR UPDATE ON public.team_invitations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invite_single_staff_role();
