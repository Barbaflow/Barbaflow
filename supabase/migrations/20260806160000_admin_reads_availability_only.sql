-- `admin_barbearia` passa a só LER `availability`, e a função geradora ganha
-- autorização.
--
-- MUDANÇA RESTRITIVA. Duas portas fechadas na mesma migration porque fechar só
-- uma daria uma garantia que PARECE mais forte do que é — e é justamente esse
-- tipo de frase plausível-e-falsa que a §9 do CLAUDE.md manda não deixar de pé.
--
-- ────────────────────────────────────────────────────────────────────────────
-- PORTA 1: a policy
--
-- Até aqui `admin_barbearia` escrevia `availability` de QUALQUER profissional
-- do tenant — INSERT, UPDATE e DELETE, sem restrição de `barber_id`. Era
-- assimétrico com as duas tabelas vizinhas:
--
--     weekly_schedule   admin NÃO escreve (só o dono ou super_admin)
--     schedule_blocks   admin NÃO escreve (idem)
--     availability      admin escrevia TUDO           ← esta
--
-- A decisão de produto que fecha a assimetria é a mesma da 20260805200000: o
-- admin administra, não atende. Grade, bloqueio e disponibilidade são o
-- instrumento de trabalho de quem atende; ele coordena com visibilidade, sem
-- posse. A "Agenda da equipe" já é somente leitura na interface — esta
-- migration transforma isso em garantia de banco, e não de tela.
--
-- ────────────────────────────────────────────────────────────────────────────
-- PORTA 2: `generate_availability_from_schedule`
--
-- A função é SECURITY DEFINER e o INSERT dela roda como o dono, IGNORANDO a
-- RLS do chamador. Ela recebia `_barber_id` como parâmetro e não verificava
-- nada: `authenticated` tem EXECUTE, então qualquer usuário autenticado podia
-- gerar disponibilidade para qualquer profissional de qualquer barbearia.
--
-- Na prática ninguém exercia isso — a única tela que a chama passa o próprio
-- id. Mas fechar a policy sem fechar esta deixaria a porta lateral aberta com
-- cara de porta fechada.
--
-- QUEM PASSA A PODER CHAMAR: o próprio `_barber_id`, a administração daquele
-- tenant, ou o super_admin.
--
-- E SIM, O ADMIN CONTINUA PODENDO GERAR — é assimetria deliberada, não
-- descuido. Gerar não é editar: a função deriva ESTRITAMENTE de
-- `weekly_schedule` do profissional, respeitando `schedule_blocks`, e não
-- consegue inventar faixa que a grade dele não tenha. É a diferença entre
-- "materializar o que a pessoa já declarou" e "escrever na agenda dela".
--
-- ────────────────────────────────────────────────────────────────────────────
-- SOBRE OS NOMES DAS POLICIES
--
-- "Barbers and admins can insert/update availability" e "Admins can delete
-- availability" passam a descrever mal — a segunda fica francamente errada.
-- Mantidos assim de propósito: renomear exige DROP/CREATE num arquivo que já
-- faz exatamente isso por outro motivo, e misturar as duas coisas torna o diff
-- mais difícil de revisar do que o ganho. Os `COMMENT ON POLICY` abaixo
-- carregam a verdade, e a renomeação é um PR de escopo próprio.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE NÃO ENTRA NAS DUAS FASES DA §2.1
--
-- A §2.1 existe para o caso em que o frontend ainda usa o caminho que vai ser
-- revogado — revogar antes de migrar a tela derruba quem está usando. Aqui é o
-- inverso: a tela JÁ não oferece a escrita (a "Agenda da equipe" nasceu
-- somente leitura), e o que esta migration remove é uma capacidade que nenhuma
-- interface exercita. Não há caminho em uso para migrar antes.
--
-- Conferido nos dados do remoto em 06/08/2026, antes de escrever: as únicas
-- linhas de `availability` com dono `admin_barbearia` são 11 em
-- `barbearia-demo-cliente`, todas de 05/08 e todas do PRÓPRIO admin — resíduo
-- de quando ele ainda contava como profissional, antes da 20260805200000.
-- Nenhum registro de admin escrevendo linha de TERCEIRO, nunca.
--
-- Essas 11 linhas são limpeza pontual, FORA desta migration: apagar dado de
-- gente em migration é o "cleanup automático no remoto" que a §2.3 proíbe.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • como admin: INSERT/UPDATE/DELETE em `availability` do tenant → recusado
--     (0 linhas afetadas no UPDATE/DELETE, 42501 no INSERT);
--   • como admin: SELECT continua funcionando — a "Agenda da equipe" não muda;
--   • como barbeiro: criar, editar e apagar a PRÓPRIA linha → aceito;
--   • como barbeiro: `generate_availability_from_schedule` para SI → aceito;
--   • como barbeiro: a mesma função para OUTRO barbeiro → recusado;
--   • como admin e como super_admin: a função para qualquer barbeiro → aceito;
--   • sem sessão: a função recusa antes de olhar qualquer coisa.
--
-- ROLLBACK
--   -- devolve o ramo `admin_barbearia` às três policies (o texto está no
--   -- cabeçalho de 20260806150000 e em 20260722xxxxx) e recria a função sem o
--   -- bloco de autorização, como estava em 20260420123902.
-- ============================================================================

/* ═══════════ 1. escrita em availability: sem o ramo do admin ═══════════ */

DROP POLICY IF EXISTS "Barbers and admins can insert availability" ON public.availability;

CREATE POLICY "Barbers and admins can insert availability"
  ON public.availability
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
      AND barber_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Barbers and admins can insert availability" ON public.availability IS
  'Apesar do nome (mantido para não misturar renomeação com mudança de regra), '
  'desde 20260806160000 a administração do tenant NÃO insere: só o próprio '
  'profissional na própria linha, e o super_admin. Alinha `availability` com '
  '`weekly_schedule` e `schedule_blocks`, onde o admin nunca escreveu.';

DROP POLICY IF EXISTS "Barbers and admins can update availability" ON public.availability;

CREATE POLICY "Barbers and admins can update availability"
  ON public.availability
  FOR UPDATE
  TO authenticated
  USING (
    (
      public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
      AND barber_id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Barbers and admins can update availability" ON public.availability IS
  'Desde 20260806160000 a administração do tenant não edita: só o dono da linha '
  '(enquanto for `barbeiro` da casa) e o super_admin. O nome é o de origem.';

DROP POLICY IF EXISTS "Admins can delete availability" ON public.availability;

CREATE POLICY "Admins can delete availability"
  ON public.availability
  FOR DELETE
  TO authenticated
  USING (
    (
      barber_id = auth.uid()
      AND public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Admins can delete availability" ON public.availability IS
  'O nome ficou FRANCAMENTE errado e é o de origem: desde 20260806160000 a '
  'administração do tenant NÃO apaga. Só o dono da linha (enquanto for '
  '`barbeiro` da casa) e o super_admin. Renomear é PR à parte, para não '
  'misturar com a mudança de regra.';

-- A policy de SELECT não é tocada: a "Agenda da equipe" depende dela, e ler
-- nunca foi o problema.

/* ═══════════ 2. a função geradora ganha autorização ═══════════════════ */

CREATE OR REPLACE FUNCTION public.generate_availability_from_schedule(
  _barber_id     uuid,
  _barbershop_id uuid,
  _start_date    date,
  _end_date      date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller       uuid := auth.uid();
  _schedule     RECORD;
  _current_date DATE;
  _inserted     INTEGER := 0;
  _gravadas     INTEGER;
  _is_blocked   BOOLEAN;
BEGIN
  -- A função é SECURITY DEFINER: o INSERT abaixo roda como o dono e NÃO passa
  -- pela RLS de quem chamou. Sem esta verificação, `authenticated` gerava
  -- disponibilidade para qualquer profissional de qualquer barbearia — e a
  -- policy restritiva acima não alcançaria isso.
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT (
    _caller = _barber_id
    OR public.has_role_in_barbershop(_caller, _barbershop_id, 'admin_barbearia'::public.app_role)
    OR public.has_role(_caller, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION
      'Você só pode gerar horários da sua própria agenda.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  _current_date := _start_date;

  WHILE _current_date <= _end_date LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.schedule_blocks
      WHERE barber_id = _barber_id
        AND barbershop_id = _barbershop_id
        AND block_date = _current_date
    ) INTO _is_blocked;

    IF NOT _is_blocked THEN
      FOR _schedule IN
        SELECT * FROM public.weekly_schedule
        WHERE barber_id = _barber_id
          AND barbershop_id = _barbershop_id
          AND day_of_week = EXTRACT(DOW FROM _current_date)
          AND is_active = true
      LOOP
        INSERT INTO public.availability
          (barber_id, barbershop_id, date, start_time, end_time, status)
        VALUES
          (_barber_id, _barbershop_id, _current_date,
           _schedule.start_time, _schedule.end_time, 'livre')
        ON CONFLICT ON CONSTRAINT availability_janela_unica DO NOTHING;

        GET DIAGNOSTICS _gravadas = ROW_COUNT;
        _inserted := _inserted + _gravadas;
      END LOOP;
    END IF;

    _current_date := _current_date + 1;
  END LOOP;

  RETURN _inserted;
END;
$$;

COMMENT ON FUNCTION public.generate_availability_from_schedule(uuid, uuid, date, date) IS
  'Materializa `availability` a partir da grade semanal do profissional, '
  'pulando dias bloqueados. SECURITY DEFINER, então o INSERT ignora a RLS de '
  'quem chama — por isso, desde 20260806160000, ela AUTORIZA: o próprio '
  '`_barber_id`, a administração daquele tenant, ou o super_admin. O admin '
  'segue podendo gerar mesmo sem poder editar `availability`, e a assimetria é '
  'deliberada: gerar deriva estritamente do que o profissional já declarou em '
  '`weekly_schedule` e não inventa faixa nenhuma.';
