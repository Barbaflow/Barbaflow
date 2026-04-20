-- Function to notify the client when an appointment is rescheduled
-- (date, start_time, end_time or barber_id changed)
CREATE OR REPLACE FUNCTION public.notify_appointment_rescheduled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _barbershop_name TEXT;
  _service_name TEXT;
  _client_name TEXT;
  _old_barber_name TEXT;
  _new_barber_name TEXT;
  _date_changed BOOLEAN;
  _time_changed BOOLEAN;
  _barber_changed BOOLEAN;
  _changes TEXT[] := ARRAY[]::TEXT[];
  _message TEXT;
BEGIN
  -- Skip if status is being cancelled/completed (handled by other trigger)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  _date_changed := NEW.date IS DISTINCT FROM OLD.date;
  _time_changed := NEW.start_time IS DISTINCT FROM OLD.start_time
                OR NEW.end_time IS DISTINCT FROM OLD.end_time;
  _barber_changed := NEW.barber_id IS DISTINCT FROM OLD.barber_id;

  -- Nothing relevant changed
  IF NOT (_date_changed OR _time_changed OR _barber_changed) THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _barbershop_name FROM barbershops WHERE id = NEW.barbershop_id;
  SELECT name INTO _service_name FROM services WHERE id = NEW.service_id;

  -- Resolve barber names if changed
  IF _barber_changed THEN
    SELECT COALESCE(
      NULLIF(TRIM(p.full_name), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'name'), ''),
      INITCAP(SPLIT_PART(u.email, '@', 1)),
      'Barbeiro'
    )
    INTO _new_barber_name
    FROM auth.users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = NEW.barber_id;

    SELECT COALESCE(
      NULLIF(TRIM(p.full_name), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'name'), ''),
      INITCAP(SPLIT_PART(u.email, '@', 1)),
      'Barbeiro'
    )
    INTO _old_barber_name
    FROM auth.users u
    LEFT JOIN profiles p ON p.user_id = u.id
    WHERE u.id = OLD.barber_id;
  END IF;

  -- Get client name (for barber notification)
  SELECT COALESCE(
    NULLIF(TRIM(p.full_name), ''),
    NULLIF(TRIM(u.raw_user_meta_data ->> 'full_name'), ''),
    NULLIF(TRIM(u.raw_user_meta_data ->> 'name'), ''),
    INITCAP(SPLIT_PART(u.email, '@', 1)),
    'Cliente'
  )
  INTO _client_name
  FROM auth.users u
  LEFT JOIN profiles p ON p.user_id = u.id
  WHERE u.id = NEW.client_id;

  -- Build human-readable message
  _message := 'Seu agendamento de ' || COALESCE(_service_name, 'serviço')
    || ' em ' || COALESCE(_barbershop_name, 'barbearia')
    || ' foi reagendado para ' || to_char(NEW.date, 'DD/MM/YYYY')
    || ' às ' || to_char(NEW.start_time, 'HH24:MI');

  IF _barber_changed THEN
    _message := _message || ' com ' || COALESCE(_new_barber_name, 'novo profissional');
  END IF;

  _message := _message || '.';

  -- Notify client (skip if client is the one rescheduling themselves — still notify, useful confirmation)
  INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
  VALUES (
    NEW.client_id,
    NEW.barbershop_id,
    'Agendamento reagendado',
    _message,
    'appointment_rescheduled',
    NEW.id
  );

  -- Notify the new barber (if different from client) about the new assignment / change
  IF NEW.barber_id IS NOT NULL AND NEW.barber_id <> NEW.client_id THEN
    INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
    VALUES (
      NEW.barber_id,
      NEW.barbershop_id,
      CASE WHEN _barber_changed THEN 'Agendamento transferido para você' ELSE 'Agendamento reagendado' END,
      COALESCE(_client_name, 'Cliente') || ' — ' || COALESCE(_service_name, 'serviço')
        || ' em ' || to_char(NEW.date, 'DD/MM/YYYY')
        || ' às ' || to_char(NEW.start_time, 'HH24:MI'),
      'appointment_rescheduled',
      NEW.id
    );
  END IF;

  -- If barber changed, notify the OLD barber that they no longer have this appointment
  IF _barber_changed AND OLD.barber_id IS NOT NULL AND OLD.barber_id <> NEW.client_id THEN
    INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
    VALUES (
      OLD.barber_id,
      NEW.barbershop_id,
      'Agendamento transferido',
      COALESCE(_client_name, 'Cliente') || ' foi transferido para '
        || COALESCE(_new_barber_name, 'outro profissional')
        || ' (' || to_char(NEW.date, 'DD/MM') || ' às ' || to_char(NEW.start_time, 'HH24:MI') || ').',
      'appointment_rescheduled',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
DROP TRIGGER IF EXISTS trg_notify_appointment_rescheduled ON public.appointments;
CREATE TRIGGER trg_notify_appointment_rescheduled
AFTER UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.notify_appointment_rescheduled();