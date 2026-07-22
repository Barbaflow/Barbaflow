-- Limita o que o CLIENTE pode alterar no próprio agendamento.
--
-- Falha comprovada: a policy de UPDATE de `appointments` é
--
--   USING (client_id = auth.uid() OR barbeiro OR admin OR super_admin)
--
-- sem `WITH CHECK` próprio. Em Postgres, UPDATE sem WITH CHECK reaproveita o
-- USING para a linha nova — o que impede transferir a reserva para outra
-- pessoa, mas NÃO impede o dono de reescrever qualquer outra coluna. Medido
-- com `SET LOCAL ROLE authenticated` + claims de JWT, um cliente comum
-- conseguia, sobre a PRÓPRIA reserva:
--
--   status  -> 'completed'      (forjar atendimento concluído; libera avaliação)
--   status  -> 'no_show'        (mexer no histórico de faltas)
--   service_id -> outro serviço (trocar Corte R$40 por Premium R$200)
--   barbershop_id -> outra barbearia
--   barber_id  -> outro profissional
--   date/start_time/end_time    (reagendar para 25/12 às 03:00, fora de
--                                qualquer grade, sem antecedência nenhuma)
--
-- RLS sozinha não resolve: `WITH CHECK` enxerga apenas a linha NOVA, então não
-- há como expressar "só estas colunas podem mudar". A regra depende de comparar
-- OLD com NEW, e o lugar certo para isso é um trigger BEFORE UPDATE.
--
-- O que este trigger faz — e apenas isto:
--   * age somente quando quem edita NÃO é da equipe daquela barbearia. Admin,
--     barbeiro e super_admin continuam com o comportamento de hoje, intacto;
--   * age somente quando há um usuário autenticado. `service_role`, cron e
--     manutenção via SQL seguem livres (auth.uid() é NULL);
--   * congela client_id, barbershop_id, barber_id e service_id;
--   * permite exatamente duas transições:
--       1. CANCELAR   — 'scheduled' -> 'cancelled', respeitando a antecedência
--                       mínima configurada pela barbearia;
--       2. REAGENDAR  — mantém 'scheduled' e muda data/horário, revalidando no
--                       banco a grade semanal, os bloqueios do dia, a duração
--                       do serviço e a antecedência.
--
-- A proteção contra sobreposição continua sendo a constraint
-- `appointments_no_overlap_per_barber` (migration 20260722180000): este trigger
-- não a substitui, complementa.

CREATE OR REPLACE FUNCTION public.enforce_client_appointment_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid            uuid := auth.uid();
  _tz             text;
  _cancel_min     integer;
  _resched_min    integer;
  _duracao        integer;
  _horas_ate      numeric;
  _dia_bloqueado  boolean;
  _cabe_na_grade  boolean;
BEGIN
  -- Sem usuário autenticado (service_role, cron, manutenção): não é o caso de uso.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Equipe da barbearia e super_admin mantêm o comportamento atual.
  IF public.has_role_in_barbershop(_uid, OLD.barbershop_id, 'barbeiro')
     OR public.has_role_in_barbershop(_uid, OLD.barbershop_id, 'admin_barbearia')
     OR public.has_role(_uid, 'super_admin')
  THEN
    RETURN NEW;
  END IF;

  -- Daqui para baixo: alguém que não é da equipe. A RLS já garante que só o
  -- próprio cliente chega aqui; a checagem explícita evita depender disso.
  IF OLD.client_id IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'appointment_forbidden'
      USING HINT = 'Você só pode alterar os seus próprios agendamentos.';
  END IF;

  -- Colunas administrativas são imutáveis para o cliente.
  IF NEW.client_id     IS DISTINCT FROM OLD.client_id
     OR NEW.barbershop_id IS DISTINCT FROM OLD.barbershop_id
     OR NEW.barber_id     IS DISTINCT FROM OLD.barber_id
     OR NEW.service_id    IS DISTINCT FROM OLD.service_id
  THEN
    RAISE EXCEPTION 'appointment_field_locked'
      USING HINT = 'Cliente não altera barbearia, profissional, serviço nem titular.';
  END IF;

  SELECT coalesce(b.timezone, 'America/Sao_Paulo'),
         coalesce(b.cancel_min_hours, 2),
         coalesce(b.reschedule_min_hours, 2)
    INTO _tz, _cancel_min, _resched_min
  FROM public.barbershops b
  WHERE b.id = OLD.barbershop_id;

  -- Quanto falta para o horário ORIGINAL, no fuso da barbearia da reserva.
  _horas_ate := EXTRACT(EPOCH FROM (
                  ((OLD.date + OLD.start_time) AT TIME ZONE _tz) - now()
                )) / 3600.0;

  /* ------------------------------ CANCELAR ----------------------------- */
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF OLD.status <> 'scheduled' THEN
      RAISE EXCEPTION 'appointment_not_cancellable'
        USING HINT = 'Só um agendamento ainda ativo pode ser cancelado.';
    END IF;
    IF _cancel_min > 0 AND _horas_ate < _cancel_min THEN
      RAISE EXCEPTION 'appointment_cancel_too_late'
        USING HINT = 'O prazo de cancelamento desta barbearia já passou.';
    END IF;
    -- Cancelar não pode vir acompanhado de remarcação.
    IF NEW.date IS DISTINCT FROM OLD.date
       OR NEW.start_time IS DISTINCT FROM OLD.start_time
       OR NEW.end_time IS DISTINCT FROM OLD.end_time
    THEN
      RAISE EXCEPTION 'appointment_field_locked'
        USING HINT = 'Cancelamento não altera data nem horário.';
    END IF;
    RETURN NEW;
  END IF;

  -- Qualquer outra mudança de status está fora do alcance do cliente.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'appointment_status_forbidden'
      USING HINT = 'Cliente só pode cancelar; concluir e marcar falta são da barbearia.';
  END IF;

  /* ----------------------------- REAGENDAR ----------------------------- */
  IF NEW.date IS DISTINCT FROM OLD.date
     OR NEW.start_time IS DISTINCT FROM OLD.start_time
     OR NEW.end_time IS DISTINCT FROM OLD.end_time
  THEN
    IF OLD.status <> 'scheduled' THEN
      RAISE EXCEPTION 'appointment_not_reschedulable'
        USING HINT = 'Só um agendamento ainda ativo pode ser reagendado.';
    END IF;

    IF _resched_min > 0 AND _horas_ate < _resched_min THEN
      RAISE EXCEPTION 'appointment_reschedule_too_late'
        USING HINT = 'O prazo de reagendamento desta barbearia já passou.';
    END IF;

    -- A duração é a do serviço contratado: o cliente não estica o atendimento.
    SELECT s.duration_minutes INTO _duracao
    FROM public.services s WHERE s.id = OLD.service_id;

    IF _duracao IS NULL
       OR NEW.end_time <> NEW.start_time + make_interval(mins => _duracao)
    THEN
      RAISE EXCEPTION 'appointment_duration_mismatch'
        USING HINT = 'A duração precisa ser a do serviço contratado.';
    END IF;

    -- O novo horário não pode estar no passado.
    IF ((NEW.date + NEW.start_time) AT TIME ZONE _tz) <= now() THEN
      RAISE EXCEPTION 'appointment_reschedule_past'
        USING HINT = 'Escolha um horário futuro.';
    END IF;

    -- Dia inteiro bloqueado pelo profissional.
    SELECT EXISTS (
      SELECT 1 FROM public.schedule_blocks sb
      WHERE sb.barbershop_id = OLD.barbershop_id
        AND sb.barber_id     = OLD.barber_id
        AND sb.block_date    = NEW.date
    ) INTO _dia_bloqueado;

    IF _dia_bloqueado THEN
      RAISE EXCEPTION 'appointment_slot_unavailable'
        USING HINT = 'O profissional não atende nesse dia.';
    END IF;

    -- O intervalo inteiro precisa caber numa janela ativa da grade semanal —
    -- a mesma fonte que o fluxo público usa desde a migration 20260722210000.
    SELECT EXISTS (
      SELECT 1 FROM public.weekly_schedule w
      WHERE w.barbershop_id = OLD.barbershop_id
        AND w.barber_id     = OLD.barber_id
        AND w.is_active
        AND w.day_of_week   = EXTRACT(DOW FROM NEW.date)
        AND NEW.start_time >= w.start_time
        AND NEW.end_time   <= w.end_time
    ) INTO _cabe_na_grade;

    IF NOT _cabe_na_grade THEN
      RAISE EXCEPTION 'appointment_slot_unavailable'
        USING HINT = 'Esse horário está fora da agenda do profissional.';
    END IF;

    -- Uma janela `folga`/`ocupado` lançada na agenda também bloqueia.
    IF EXISTS (
      SELECT 1 FROM public.availability a
      WHERE a.barbershop_id = OLD.barbershop_id
        AND a.barber_id     = OLD.barber_id
        AND a.date          = NEW.date
        AND a.status <> 'livre'
        AND NEW.start_time < a.end_time
        AND NEW.end_time   > a.start_time
    ) THEN
      RAISE EXCEPTION 'appointment_slot_unavailable'
        USING HINT = 'Esse horário está indisponível.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_client_appointment_transition() IS
  'Restringe o UPDATE de appointments feito pelo próprio cliente às transições '
  'de cancelar e reagendar, revalidando grade, bloqueios, duração e '
  'antecedência no banco. Equipe e super_admin não são afetados.';

DROP TRIGGER IF EXISTS trg_enforce_client_appointment_transition ON public.appointments;
CREATE TRIGGER trg_enforce_client_appointment_transition
BEFORE UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_appointment_transition();
