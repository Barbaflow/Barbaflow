
-- Weekly recurring schedule per barber
CREATE TABLE public.weekly_schedule (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barber_id UUID NOT NULL,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (barber_id, barbershop_id, day_of_week, start_time)
);

-- Enable RLS
ALTER TABLE public.weekly_schedule ENABLE ROW LEVEL SECURITY;

-- Barbers can view their own schedule
CREATE POLICY "Barbers can view own schedule"
ON public.weekly_schedule
FOR SELECT
TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
);

-- Barbers can create their own schedule
CREATE POLICY "Barbers can create own schedule"
ON public.weekly_schedule
FOR INSERT
TO authenticated
WITH CHECK (
  barber_id = auth.uid()
  AND (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  )
);

-- Barbers can update their own schedule
CREATE POLICY "Barbers can update own schedule"
ON public.weekly_schedule
FOR UPDATE
TO authenticated
USING (barber_id = auth.uid());

-- Barbers can delete their own schedule
CREATE POLICY "Barbers can delete own schedule"
ON public.weekly_schedule
FOR DELETE
TO authenticated
USING (barber_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER update_weekly_schedule_updated_at
BEFORE UPDATE ON public.weekly_schedule
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to generate availability slots from weekly schedule for a date range
CREATE OR REPLACE FUNCTION public.generate_availability_from_schedule(
  _barber_id UUID,
  _barbershop_id UUID,
  _start_date DATE,
  _end_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _schedule RECORD;
  _current_date DATE;
  _inserted INTEGER := 0;
BEGIN
  _current_date := _start_date;
  
  WHILE _current_date <= _end_date LOOP
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
    
    _current_date := _current_date + 1;
  END LOOP;
  
  RETURN _inserted;
END;
$$;
