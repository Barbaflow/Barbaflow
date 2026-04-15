
-- Create enum for block types
CREATE TYPE public.block_type AS ENUM ('feriado', 'ferias', 'pessoal');

-- Create schedule_blocks table
CREATE TABLE public.schedule_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barber_id UUID NOT NULL,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  block_date DATE NOT NULL,
  reason TEXT,
  block_type public.block_type NOT NULL DEFAULT 'pessoal',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (barber_id, barbershop_id, block_date)
);

ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;

-- Barbers can view own blocks + admins can view all in barbershop
CREATE POLICY "Barbers and admins can view blocks"
ON public.schedule_blocks FOR SELECT TO authenticated
USING (
  barber_id = auth.uid()
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
);

CREATE POLICY "Barbers can create own blocks"
ON public.schedule_blocks FOR INSERT TO authenticated
WITH CHECK (
  barber_id = auth.uid()
  AND (
    has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  )
);

CREATE POLICY "Barbers can update own blocks"
ON public.schedule_blocks FOR UPDATE TO authenticated
USING (barber_id = auth.uid());

CREATE POLICY "Barbers can delete own blocks"
ON public.schedule_blocks FOR DELETE TO authenticated
USING (barber_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_schedule_blocks_updated_at
BEFORE UPDATE ON public.schedule_blocks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Update generate function to skip blocked dates
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
  _is_blocked BOOLEAN;
BEGIN
  _current_date := _start_date;
  
  WHILE _current_date <= _end_date LOOP
    -- Check if date is blocked
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
        INSERT INTO public.availability (barber_id, barbershop_id, date, start_time, end_time, status)
        VALUES (_barber_id, _barbershop_id, _current_date, _schedule.start_time, _schedule.end_time, 'livre')
        ON CONFLICT DO NOTHING;
        _inserted := _inserted + 1;
      END LOOP;
    END IF;
    
    _current_date := _current_date + 1;
  END LOOP;
  
  RETURN _inserted;
END;
$$;
