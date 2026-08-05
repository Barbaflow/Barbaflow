-- Expediente: resolução de conflito em uma transação, e correção do comentário.
--
-- Duas coisas pequenas e independentes, as duas exigidas pela tela do PR 2.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. POR QUE PRECISA DE RPC: O ADMIN NÃO PODE DESATIVAR TURNO ALHEIO
--
-- O fluxo desenhado para o conflito é: ao apertar o expediente, a tela lista os
-- turnos que ficariam de fora e oferece um botão explícito para desativá-los e
-- salvar. Só que a policy de UPDATE de `weekly_schedule` (20260415174831) é:
--
--     USING (barber_id = auth.uid() OR has_role(auth.uid(), 'super_admin'))
--
-- `admin_barbearia` NÃO está ali. Ele VÊ a grade do tenant (a policy de SELECT
-- inclui admin) mas não altera a de ninguém. Ou seja: o botão simplesmente não
-- funcionaria para o papel que ele foi desenhado para atender — só para o
-- super_admin.
--
-- Descartado ampliar a policy de UPDATE para admins: isso os deixaria editar
-- livremente a grade de qualquer profissional, o tempo todo. É muito mais poder
-- do que este fluxo precisa, e permanente.
--
-- Esta RPC faz o oposto: concentra a exceção num caminho único, nomeado e
-- auditável, que só sabe fazer uma coisa — DESATIVAR turnos que conflitam com o
-- expediente sendo salvo, e salvar o expediente. Não edita horário, não apaga,
-- não reativa.
--
-- E resolve a atomicidade: a função é uma transação, então ou os turnos são
-- desativados E o expediente entra, ou nada acontece. Duas chamadas separadas
-- pelo PostgREST deixariam a janela em que a grade de terceiros já foi mexida e
-- o expediente não entrou.
--
-- ORDEM IMPORTA: os turnos são desativados ANTES do upsert do expediente. O
-- trigger `enforce_business_hours_fit_shifts` só conta turno ATIVO, então
-- quando o expediente é gravado já não há conflito. E o trigger
-- `enforce_shift_within_business_hours` ignora turno inativo, então a
-- desativação em si não é barrada — foi exatamente para isto que aquela
-- exceção existe (ver o cabeçalho de 20260805170000).
--
-- ────────────────────────────────────────────────────────────────────────────
-- 2. O `;` DENTRO DO COMENTÁRIO
--
-- O COMMENT ON TABLE gravado por 20260805170000 tem um `;` dentro da string:
--
--     '… LINHA AUSENTE = SEM RESTRIÇÃO (não é "fechado"); is_closed = true …'
--
-- Não afeta o banco — está entre aspas, o Postgres não se confunde. Mas as
-- ferramentas deste repositório dividem SQL por `;` para contar comandos
-- (harnesses de migration, e a trava do script de aplicação), e ali ele produz
-- um "comando" inexistente. Foi o que aconteceu na hora de aplicar aquela
-- migration. Aqui o texto é regravado com `.` no lugar do `;`.
--
-- O schema NÃO é tocado: `COMMENT ON` só reescreve metadado.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • `obj_description('public.business_hours'::regclass)` não contém `;`;
--   • como admin_barbearia, apertar o expediente com turno ativo fora continua
--     sendo RECUSADO pelo caminho normal (a RPC é o caminho deliberado, não o
--     padrão);
--   • como admin_barbearia, chamar a RPC com `_deactivate_conflicts => true`
--     desativa só os turnos daquele dia que ficariam fora, e grava o
--     expediente;
--   • os turnos desativados continuam existindo, com `is_active = false` —
--     nenhum é apagado;
--   • como barbeiro comum, a RPC é recusada;
--   • como super_admin, funciona em qualquer barbearia.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.apply_business_hours(uuid, smallint, time, time, boolean, boolean);
--   -- e, se quiser o texto antigo de volta, reexecute o COMMENT de 20260805170000.
-- ============================================================================

/* ═══════════ 1. comentário sem `;` ════════════════════════════════════════ */

COMMENT ON TABLE public.business_hours IS
  'Expediente da barbearia: um envelope por dia da semana. LINHA AUSENTE = SEM '
  'RESTRIÇÃO (não é "fechado"). is_closed = true é a afirmação explícita de que '
  'não se abre no dia. Limita weekly_schedule, que é por profissional. Leitura '
  'pública NÃO sai daqui — o PR 3 expõe por RPC SECURITY DEFINER.';

/* ═══════════ 2. salvar expediente, opcionalmente resolvendo conflito ══════ */

CREATE OR REPLACE FUNCTION public.apply_business_hours(
  _barbershop_id        uuid,
  _day_of_week          smallint,
  _open_time            time,
  _close_time           time,
  _is_closed            boolean,
  _deactivate_conflicts boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller       uuid := auth.uid();
  _desativados  integer := 0;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A MESMA autorização da policy de escrita de business_hours. A função é
  -- SECURITY DEFINER só para poder desativar turno alheio; ela não afrouxa
  -- QUEM pode definir o expediente.
  IF NOT (
    public.has_role_in_barbershop(_caller, _barbershop_id, 'admin_barbearia'::public.app_role)
    OR public.has_role(_caller, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION
      'Apenas a administração desta barbearia pode definir o horário de funcionamento.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _day_of_week IS NULL OR _day_of_week < 0 OR _day_of_week > 6 THEN
    RAISE EXCEPTION 'Dia da semana inválido.' USING ERRCODE = 'check_violation';
  END IF;

  -- Desativa ANTES de gravar: o trigger de conflito só conta turno ativo, e o
  -- trigger da grade ignora turno inativo. Só mexe em `is_active` — nunca em
  -- horário, e nunca apaga.
  IF _deactivate_conflicts THEN
    UPDATE public.weekly_schedule w
       SET is_active = false,
           updated_at = now()
     WHERE w.barbershop_id = _barbershop_id
       AND w.day_of_week   = _day_of_week
       AND w.is_active
       AND (
         _is_closed
         OR w.start_time < _open_time
         OR w.end_time   > _close_time
       );
    GET DIAGNOSTICS _desativados = ROW_COUNT;
  END IF;

  -- Upsert do envelope. Os triggers continuam valendo: se ainda houver
  -- conflito (porque `_deactivate_conflicts` era false), a exceção do
  -- `enforce_business_hours_fit_shifts` sobe daqui com a mensagem dele.
  INSERT INTO public.business_hours AS bh
    (barbershop_id, day_of_week, open_time, close_time, is_closed)
  VALUES
    (_barbershop_id, _day_of_week,
     CASE WHEN _is_closed THEN NULL ELSE _open_time END,
     CASE WHEN _is_closed THEN NULL ELSE _close_time END,
     COALESCE(_is_closed, false))
  ON CONFLICT (barbershop_id, day_of_week) DO UPDATE
    SET open_time  = EXCLUDED.open_time,
        close_time = EXCLUDED.close_time,
        is_closed  = EXCLUDED.is_closed,
        updated_at = now();

  RETURN jsonb_build_object('ok', true, 'deactivated', _desativados);
END;
$$;

COMMENT ON FUNCTION public.apply_business_hours(uuid, smallint, time, time, boolean, boolean) IS
  'Salva o expediente de um dia e, com _deactivate_conflicts, desativa na mesma '
  'transação os turnos ativos que ficariam fora. Existe porque a policy de '
  'UPDATE de weekly_schedule não inclui admin_barbearia — sem esta função o '
  'botão de resolver conflito só funcionaria para super_admin. SECURITY DEFINER '
  'apenas para alcançar a grade alheia: a autorização de QUEM pode salvar é a '
  'mesma da policy da tabela, e a função só altera is_active, nunca horário e '
  'nunca apaga.';

REVOKE ALL ON FUNCTION public.apply_business_hours(uuid, smallint, time, time, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_business_hours(uuid, smallint, time, time, boolean, boolean) TO authenticated;
