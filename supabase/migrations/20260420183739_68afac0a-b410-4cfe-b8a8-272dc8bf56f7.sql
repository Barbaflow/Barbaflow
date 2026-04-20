-- Trigger: notify client when blocked by no-show policy
CREATE OR REPLACE FUNCTION public.notify_client_noshow_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _enabled boolean;
  _max integer;
  _days integer;
  _count integer;
  _last_noshow timestamptz;
  _unblock_at timestamptz;
  _barbershop_name text;
  _already_notified boolean;
BEGIN
  -- Only act when status transitions INTO no_show
  IF NEW.status <> 'no_show' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'no_show' THEN
    RETURN NEW;
  END IF;

  -- Load policy
  SELECT noshow_policy_enabled, noshow_max_count, noshow_block_days, name
    INTO _enabled, _max, _days, _barbershop_name
  FROM public.barbershops
  WHERE id = NEW.barbershop_id;

  IF NOT COALESCE(_enabled, false) OR COALESCE(_max, 0) <= 0 OR COALESCE(_days, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Count no-shows in the last 30 days for this client at this barbershop
  SELECT COUNT(*), MAX(updated_at)
    INTO _count, _last_noshow
  FROM public.appointments
  WHERE client_id = NEW.client_id
    AND barbershop_id = NEW.barbershop_id
    AND status = 'no_show'
    AND updated_at >= now() - interval '30 days';

  IF _count < _max THEN
    RETURN NEW;
  END IF;

  _unblock_at := COALESCE(_last_noshow, now()) + (_days || ' days')::interval;

  -- Avoid spamming: only notify if there isn't already a recent block notification for this client+barbershop
  SELECT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = NEW.client_id
      AND barbershop_id = NEW.barbershop_id
      AND type = 'noshow_blocked'
      AND created_at >= now() - interval '1 day'
  ) INTO _already_notified;

  IF _already_notified THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, barbershop_id, title, message, type, appointment_id)
  VALUES (
    NEW.client_id,
    NEW.barbershop_id,
    'Agendamentos bloqueados temporariamente',
    'Você atingiu ' || _count || ' faltas em ' || COALESCE(_barbershop_name, 'na barbearia')
      || ' nos últimos 30 dias. Por isso, novos agendamentos estão bloqueados até '
      || to_char(_unblock_at, 'DD/MM/YYYY "às" HH24:MI') || '. Após essa data você poderá agendar normalmente.',
    'noshow_blocked',
    NEW.id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_client_noshow_block ON public.appointments;
CREATE TRIGGER trg_notify_client_noshow_block
AFTER INSERT OR UPDATE OF status ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.notify_client_noshow_block();