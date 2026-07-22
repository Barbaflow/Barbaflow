-- `availability` idempotente.
--
-- Motivo: `generate_availability_from_schedule` (o botão "Gerar Agenda") faz
-- `INSERT … ON CONFLICT DO NOTHING`, mas a tabela NUNCA teve constraint única —
-- só a PK sintética em `id`. Sem alvo de conflito, o `ON CONFLICT` nunca
-- dispara: gerar duas vezes duplica todas as janelas, e o contador devolvido
-- pela função soma tudo que TENTOU inserir, informando um número que não
-- corresponde ao que foi gravado.
--
-- Chave lógica escolhida:
--     (barbershop_id, barber_id, date, start_time, end_time, status)
--
-- Por que estes seis campos:
--   * `barbershop_id` e `barber_id` — a agenda é por profissional dentro de um
--     tenant; a mesma janela em barbearias diferentes é outra coisa;
--   * `date` — janela é sempre de um dia concreto;
--   * `start_time` E `end_time` — o par identifica o INTERVALO. Usar só
--     `start_time` colidiria duas janelas legítimas que começam juntas e
--     terminam em horas diferentes (ex.: o turno 09:00–18:00 e uma folga
--     09:00–10:00), apagando informação real;
--   * `status` — `livre`, `ocupado` e `folga` são significados distintos. Uma
--     folga 09:00–18:00 sobre o turno livre 09:00–18:00 é a forma de anular o
--     dia sem apagar a grade, e precisa continuar podendo coexistir.
--
-- A geração sempre insere `status = 'livre'` com os mesmos horários da grade
-- semanal, então repetir a operação passa a ser inofensivo — que é o objetivo.

/* ---------------------- 1. diagnóstico das duplicatas ------------------- */

DO $$
DECLARE
  _grupos INTEGER;
  _linhas INTEGER;
BEGIN
  SELECT count(*), coalesce(sum(n - 1), 0)
    INTO _grupos, _linhas
  FROM (
    SELECT count(*) AS n
    FROM public.availability
    GROUP BY barbershop_id, barber_id, date, start_time, end_time, status
    HAVING count(*) > 1
  ) d;

  IF _grupos > 0 THEN
    RAISE NOTICE
      'availability: % janela(s) duplicada(s) em % grupo(s) serão removidas '
      '(mantendo a linha mais antiga de cada grupo).', _linhas, _grupos;
  ELSE
    RAISE NOTICE 'availability: nenhuma duplicata encontrada.';
  END IF;
END;
$$;

/* ------------------------- 2. limpeza segura --------------------------- */

-- Só remove linhas IDÊNTICAS na chave lógica — mesmo tenant, profissional,
-- dia, intervalo e status. Nada de significado diferente é descartado. A linha
-- preservada é a mais antiga (menor `created_at`, `id` como desempate estável),
-- para manter o histórico e qualquer referência criada primeiro.
WITH ranqueadas AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY barbershop_id, barber_id, date, start_time, end_time, status
           ORDER BY created_at, id
         ) AS posicao
  FROM public.availability
)
DELETE FROM public.availability a
USING ranqueadas r
WHERE a.id = r.id
  AND r.posicao > 1;

/* --------------------------- 3. chave única ---------------------------- */

ALTER TABLE public.availability
  ADD CONSTRAINT availability_janela_unica
  UNIQUE (barbershop_id, barber_id, date, start_time, end_time, status);

COMMENT ON CONSTRAINT availability_janela_unica ON public.availability IS
  'Chave lógica da janela de disponibilidade. É o alvo do ON CONFLICT de '
  'generate_availability_from_schedule, que sem ela nunca disparava.';

/* ------------------ 4. geração de fato idempotente --------------------- */

-- Mesma assinatura e mesmo comportamento externo; duas correções:
--   * `ON CONFLICT … DO NOTHING` agora tem alvo real;
--   * o contador passa a refletir o que foi GRAVADO, não o que foi tentado.
CREATE OR REPLACE FUNCTION public.generate_availability_from_schedule(
  _barber_id uuid, _barbershop_id uuid, _start_date date, _end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _schedule RECORD;
  _current_date DATE;
  _inserted INTEGER := 0;
  _gravadas INTEGER;
  _is_blocked BOOLEAN;
BEGIN
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
