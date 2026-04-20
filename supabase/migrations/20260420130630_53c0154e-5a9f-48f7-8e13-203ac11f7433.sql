CREATE OR REPLACE FUNCTION public.notify_appointment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _barbershop_name TEXT;
  _service_name TEXT;
  _client_name TEXT;
  _admin_roles RECORD;
BEGIN
  -- Get barbershop name
  SELECT name INTO _barbershop_name FROM barbershops WHERE id = NEW.barbershop_id;
  
  -- Get service name
  SELECT name INTO _service_name FROM services WHERE id = NEW.service_id;
  
  -- Get client name with fallback: profile.full_name -> auth metadata -> email prefix
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
  
  IF TG_OP = 'INSERT' THEN
    -- Notify barber
    IF NEW.barber_id IS NOT NULL AND NEW.barber_id != NEW.client_id THEN
      INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
      VALUES (
        NEW.barber_id, NEW.barbershop_id,
        'Novo agendamento',
        COALESCE(_client_name, 'Cliente') || ' agendou ' || COALESCE(_service_name, 'serviço') || ' para ' || to_char(NEW.date, 'DD/MM') || ' às ' || to_char(NEW.start_time, 'HH24:MI'),
        'new_appointment', NEW.id
      );
    END IF;
    
    -- Notify admins
    FOR _admin_roles IN
      SELECT user_id FROM user_roles
      WHERE barbershop_id = NEW.barbershop_id AND role = 'admin_barbearia' AND user_id != NEW.client_id AND user_id != NEW.barber_id
    LOOP
      INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
      VALUES (
        _admin_roles.user_id, NEW.barbershop_id,
        'Novo agendamento',
        COALESCE(_client_name, 'Cliente') || ' agendou ' || COALESCE(_service_name, 'serviço') || ' para ' || to_char(NEW.date, 'DD/MM') || ' às ' || to_char(NEW.start_time, 'HH24:MI'),
        'new_appointment', NEW.id
      );
    END LOOP;
    
    -- Notify client (confirmation)
    INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
    VALUES (
      NEW.client_id, NEW.barbershop_id,
      'Agendamento confirmado',
      'Seu agendamento de ' || COALESCE(_service_name, 'serviço') || ' em ' || COALESCE(_barbershop_name, '') || ' foi confirmado para ' || to_char(NEW.date, 'DD/MM') || ' às ' || to_char(NEW.start_time, 'HH24:MI'),
      'appointment_confirmed', NEW.id
    );
    
  ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
    -- Notify client about status changes
    IF NEW.status = 'cancelled' THEN
      INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
      VALUES (
        NEW.client_id, NEW.barbershop_id,
        'Agendamento cancelado',
        'Seu agendamento de ' || COALESCE(_service_name, 'serviço') || ' em ' || to_char(NEW.date, 'DD/MM') || ' às ' || to_char(NEW.start_time, 'HH24:MI') || ' foi cancelado.',
        'appointment_cancelled', NEW.id
      );
      
      -- Also notify barber
      IF NEW.barber_id IS NOT NULL THEN
        INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
        VALUES (
          NEW.barber_id, NEW.barbershop_id,
          'Agendamento cancelado',
          COALESCE(_client_name, 'Cliente') || ' cancelou o agendamento de ' || COALESCE(_service_name, 'serviço') || ' em ' || to_char(NEW.date, 'DD/MM') || ' às ' || to_char(NEW.start_time, 'HH24:MI'),
          'appointment_cancelled', NEW.id
        );
      END IF;
      
    ELSIF NEW.status = 'completed' THEN
      INSERT INTO notifications (user_id, barbershop_id, title, message, type, appointment_id)
      VALUES (
        NEW.client_id, NEW.barbershop_id,
        'Serviço concluído',
        'Seu ' || COALESCE(_service_name, 'serviço') || ' em ' || COALESCE(_barbershop_name, '') || ' foi concluído. Obrigado!',
        'appointment_completed', NEW.id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;