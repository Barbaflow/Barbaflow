-- O conflito de expediente passa a ser medido contra AGENDAMENTOS, não contra a
-- grade recorrente.
--
-- PASSO 2 DE 2. PRÉ-CONDIÇÃO: a 20260806130000 precisa estar APLICADA e em uso
-- real antes desta. Aplicar as duas juntas abre uma janela em que a barbearia
-- pode estar "fechada" na sexta e o assistente público continuar oferecendo
-- sexta — porque até a 20260806130000 a leitura não olhava `business_hours`.
-- Ver o cabeçalho dela, e a §2.1 do CLAUDE.md.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A MUDANÇA DE CONCEITO
--
-- `weekly_schedule` é INTENÇÃO recorrente: "trabalho às sextas". Não é
-- compromisso com ninguém. Bloquear o fechamento da sexta por causa dela
-- obrigava o admin a desativar a grade dos outros — mexer no dado alheio para
-- exercer uma decisão que é dele.
--
-- `appointments` é COMPROMISSO: tem cliente do outro lado. Fechar a sexta com
-- cliente marcado tem de doer, porque alguém precisa avisar essa pessoa.
--
-- Desde a 20260806130000 o expediente já filtra a leitura pública, então a
-- grade recorrente que "sobra" fora do envelope não vaza para lugar nenhum: ela
-- simplesmente não gera janela. Deixar de bloqueá-la deixou de ter custo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- 1. `enforce_business_hours_fit_shifts` — o nome fica, o alvo muda
--
-- O nome e o do trigger (`trg_business_hours_fit_shifts`) passam a descrever
-- mal o que a função faz. Renomear os dois é um passo separado, de propósito:
-- exigiria DROP/CREATE de trigger e função no mesmo arquivo que muda a regra, e
-- misturar as duas coisas torna o diff mais difícil de revisar do que o ganho.
-- O `COMMENT ON FUNCTION` abaixo carrega a verdade até lá.
--
-- CRITÉRIO, como decidido:
--   • só `status = 'scheduled'`. `completed`, `no_show` e `cancelled` são
--     histórico e não podem bloquear decisão futura;
--   • `date >= hoje` e `date <= hoje + 90`, com HOJE NO FUSO DO TENANT
--     (`barbershops.timezone`), não no do servidor — a sessão do banco roda em
--     UTC, e em America/Sao_Paulo (UTC−3) qualquer instante a partir das 21:00
--     locais já é o dia seguinte em UTC. É a mesma armadilha que
--     `todayISOInTenantTZ()` resolve no frontend;
--   • o dia da semana da DATA do agendamento tem de bater com o dia sendo
--     editado — a regra é recorrente, então varre todas as datas futuras
--     daquele dia da semana dentro da janela de 90 dias;
--   • fechando: qualquer agendamento futuro naquele dia da semana conflita.
--     Reduzindo: só o que cai FORA do novo envelope.
--
-- CONSEQUÊNCIA ACEITA DE `date >= hoje`: um agendamento de hoje mais cedo, que
-- já aconteceu mas continua `scheduled` porque ninguém marcou como concluído,
-- ainda bloqueia. É conservador de propósito — o banco não tem como saber se
-- aquilo foi atendido, e recusar é mais barato de corrigir do que fechar um dia
-- por cima de um atendimento real.
--
-- 2. `enforce_shift_within_business_hours` — FICA, mas para de prender
--
-- Ele continua recusando CRIAÇÃO de turno fora do expediente: é orientação boa
-- ao profissional, e desde a 20260806130000 não tem efeito público nenhum
-- (janela fora do envelope já não é oferecida).
--
-- O que muda é a armadilha. Com o passo 1, um turno preexistente pode
-- legitimamente ficar fora do envelope — o admin apertou o expediente e a grade
-- não foi desativada, porque não precisa mais ser. Pela regra antiga esse turno
-- ficava CONGELADO: qualquer UPDATE com `is_active = true` era recusado, e o
-- dono não conseguia nem encurtá-lo para dentro do expediente. Só desativar
-- passava.
--
-- A regra nova é geométrica e só aperta: um UPDATE que viole o envelope é
-- aceito enquanto a janela nova estiver CONTIDA na antiga
-- (`NEW.start_time >= OLD.start_time AND NEW.end_time <= OLD.end_time`), no
-- mesmo dia e na mesma barbearia. Ou seja:
--
--     encurtar . . . . . . . . . . . . aceito
--     mover para dentro . . . . . . . . aceito
--     reativar sem mudar horário . . . . aceito
--     AMPLIAR para fora . . . . . . . . RECUSADO
--     trocar de dia / de barbearia . . . RECUSADO (é turno novo)
--     INSERT fora do expediente . . . . RECUSADO (inalterado)
--
-- Não há como "lavar" um turno largo: INSERT segue estrito, então turno fora do
-- envelope só existe se for anterior ao envelope, e a partir daí a regra é uma
-- catraca que só fecha.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTA MIGRATION NÃO FAZ
--
--   • não apaga, não desativa e não reativa turno nenhum. Os turnos que já
--     foram desativados por `apply_business_hours(_deactivate_conflicts => true)`
--     continuam desativados: reativá-los é migração de dados, decisão de quem
--     opera, e não cabe aqui;
--   • não altera `apply_business_hours`. O parâmetro `_deactivate_conflicts`
--     deixa de ser necessário, mas continua funcionando e continua sendo
--     inofensivo quando `false` (o default). Aposentá-lo é passo à parte;
--   • não altera `generate_availability_from_schedule` nem
--     `get_public_availability_windows` (esta última é o passo 1).
--
-- VERIFICAÇÕES APÓS APLICAR
--   • fechar um dia SEM agendamento futuro naquele dia da semana: ACEITO, e a
--     RPC pública passa a devolver zero janelas nesse dia;
--   • fechar um dia COM agendamento `scheduled` futuro: RECUSADO, e a mensagem
--     lista cliente, data e hora;
--   • reduzir 09–18 para 09–12 com agendamento às 16:00 na semana que vem:
--     RECUSADO. Com agendamento às 10:00: ACEITO;
--   • agendamento `cancelled`/`completed`/`no_show` no dia: NÃO bloqueia;
--   • agendamento a mais de 90 dias: NÃO bloqueia;
--   • turno novo fora do expediente: ainda RECUSADO;
--   • turno preexistente fora do expediente: UPDATE que encurta é ACEITO,
--     UPDATE que amplia é RECUSADO.
--
-- ROLLBACK
--   -- restaura as duas funções como estavam em 20260805170000. Nenhum dado
--   -- precisa ser mexido para reverter.
-- ============================================================================

/* ═══════════ 1. conflito medido contra agendamentos ═══════════════════════ */

CREATE OR REPLACE FUNCTION public.enforce_business_hours_fit_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tz        text;
  _hoje      date;
  _limite    date;
  _total     integer;
  _conflitos text;
BEGIN
  -- HOJE no fuso do tenant. A sessão do banco roda em UTC; usar `current_date`
  -- aqui erraria o dia inteiro toda noite em qualquer fuso negativo.
  SELECT b.timezone INTO _tz
    FROM public.barbershops b
   WHERE b.id = NEW.barbershop_id;

  _tz    := COALESCE(NULLIF(btrim(_tz), ''), 'America/Sao_Paulo');
  _hoje  := (now() AT TIME ZONE _tz)::date;
  _limite := _hoje + 90;

  SELECT count(*),
         string_agg(
           format('%s em %s às %s',
                  COALESCE(NULLIF(btrim(p.full_name), ''), 'cliente'),
                  to_char(ap.date, 'DD/MM'),
                  to_char(ap.start_time, 'HH24:MI')),
           ', ' ORDER BY ap.date, ap.start_time)
    INTO _total, _conflitos
    FROM public.appointments ap
    LEFT JOIN public.profiles p ON p.user_id = ap.client_id
   WHERE ap.barbershop_id = NEW.barbershop_id
     AND ap.status = 'scheduled'::public.appointment_status
     AND ap.date >= _hoje
     AND ap.date <= _limite
     AND EXTRACT(DOW FROM ap.date) = NEW.day_of_week
     AND (
       NEW.is_closed
       OR ap.start_time < NEW.open_time
       OR ap.end_time   > NEW.close_time
     );

  IF COALESCE(_total, 0) = 0 THEN
    RETURN NEW;
  END IF;

  -- Nunca cancela nem remarca nada: recusa e diz exatamente quais são. Quem
  -- avisa o cliente é gente, não o banco.
  IF NEW.is_closed THEN
    RAISE EXCEPTION
      'Não dá para marcar % como fechado: % agendamento(s) já marcado(s) — %. Remarque ou cancele antes.',
      public.weekday_pt(NEW.day_of_week), _total, _conflitos
      USING ERRCODE = 'check_violation';
  ELSE
    RAISE EXCEPTION
      'Este expediente (%–%) deixaria % agendamento(s) de fora %: %. Amplie o horário ou remarque antes de salvar.',
      to_char(NEW.open_time, 'HH24:MI'),
      to_char(NEW.close_time, 'HH24:MI'),
      _total,
      public.weekday_pt(NEW.day_of_week),
      _conflitos
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.enforce_business_hours_fit_shifts() IS
  'Apesar do nome (mantido para não misturar renomeação com mudança de regra), '
  'desde 20260806140000 esta função NÃO olha `weekly_schedule`: ela recusa '
  'fechar ou encurtar um dia que tenha AGENDAMENTO `scheduled` nos próximos 90 '
  'dias fora do novo envelope, com HOJE calculado no fuso de '
  '`barbershops.timezone`. A grade recorrente deixou de bloquear porque desde '
  '20260806130000 ela já não gera janela pública fora do expediente.';

/* ═══════════ 2. a grade para de ficar congelada ══════════════════════════ */

CREATE OR REPLACE FUNCTION public.enforce_shift_within_business_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _env   RECORD;
  _viola boolean;
BEGIN
  -- Turno desativado não é oferecido a ninguém.
  IF NOT COALESCE(NEW.is_active, true) THEN
    RETURN NEW;
  END IF;

  SELECT bh.open_time, bh.close_time, bh.is_closed
    INTO _env
    FROM public.business_hours bh
   WHERE bh.barbershop_id = NEW.barbershop_id
     AND bh.day_of_week   = NEW.day_of_week;

  -- Ausência de envelope = sem restrição.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  _viola := _env.is_closed
            OR NEW.start_time < _env.open_time
            OR NEW.end_time   > _env.close_time;

  IF NOT _viola THEN
    RETURN NEW;
  END IF;

  -- Linha PREEXISTENTE que já estava fora: pode ser mexida enquanto não
  -- ampliar. Sem isto o dono ficava congelado — não conseguia nem encurtar o
  -- turno para dentro do expediente, só desativá-lo. A condição é geométrica
  -- (janela nova CONTIDA na antiga) e é uma catraca: só fecha.
  IF TG_OP = 'UPDATE'
     AND NEW.barbershop_id = OLD.barbershop_id
     AND NEW.day_of_week   = OLD.day_of_week
     AND NEW.start_time   >= OLD.start_time
     AND NEW.end_time     <= OLD.end_time
  THEN
    RETURN NEW;
  END IF;

  IF _env.is_closed THEN
    RAISE EXCEPTION
      'A barbearia não abre %. Ajuste o expediente antes de cadastrar turno neste dia.',
      public.weekday_pt(NEW.day_of_week)
      USING ERRCODE = 'check_violation';
  END IF;

  RAISE EXCEPTION
    'A barbearia funciona das % às % %. O turno %–% fica fora do expediente — ajuste o horário ou peça ao administrador para ampliar o funcionamento.',
    to_char(_env.open_time, 'HH24:MI'),
    to_char(_env.close_time, 'HH24:MI'),
    public.weekday_pt(NEW.day_of_week),
    to_char(NEW.start_time, 'HH24:MI'),
    to_char(NEW.end_time, 'HH24:MI')
    USING ERRCODE = 'check_violation';
END;
$$;

COMMENT ON FUNCTION public.enforce_shift_within_business_hours() IS
  'Recusa CRIAR turno ativo fora do expediente — orientação ao profissional; '
  'desde 20260806130000 isso não tem efeito público, porque a janela fora do '
  'envelope já não é oferecida. Desde 20260806140000 um UPDATE de turno que já '
  'estava fora é aceito enquanto a janela nova estiver CONTIDA na antiga, no '
  'mesmo dia e barbearia: sem isso o dono ficava congelado, sem conseguir nem '
  'encurtar o próprio turno para dentro do expediente.';
