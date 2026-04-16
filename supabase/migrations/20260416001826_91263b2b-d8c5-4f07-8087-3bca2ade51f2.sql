
-- Create notifications table
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'appointment',
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE CASCADE,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can update (mark as read) their own notifications
CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
ON public.notifications FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- System (triggers) can insert notifications via security definer function
CREATE POLICY "Service role can insert notifications"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Index for fast lookups
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read) WHERE read = false;

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Function to create notifications when appointments change
CREATE OR REPLACE FUNCTION public.notify_appointment_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _barbershop_name TEXT;
  _service_name TEXT;
  _client_name TEXT;
  _barber_roles RECORD;
  _admin_roles RECORD;
BEGIN
  -- Get barbershop name
  SELECT name INTO _barbershop_name FROM barbershops WHERE id = NEW.barbershop_id;
  
  -- Get service name
  SELECT name INTO _service_name FROM services WHERE id = NEW.service_id;
  
  -- Get client name
  SELECT full_name INTO _client_name FROM profiles WHERE user_id = NEW.client_id;
  
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
$$;

-- Create trigger
CREATE TRIGGER on_appointment_change
AFTER INSERT OR UPDATE ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.notify_appointment_change();
