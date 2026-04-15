
-- Create plan_name enum
CREATE TYPE public.plan_name AS ENUM ('free', 'pro', 'enterprise');

-- Create plans table
CREATE TABLE public.plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name plan_name NOT NULL UNIQUE,
  appointment_limit INTEGER, -- NULL means unlimited
  has_subscriptions BOOLEAN NOT NULL DEFAULT false,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

-- Everyone can read plans
CREATE POLICY "Anyone can view plans" ON public.plans
  FOR SELECT USING (true);

-- Only super_admins can modify plans
CREATE POLICY "Super admins can manage plans" ON public.plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Seed plans
INSERT INTO public.plans (name, appointment_limit, has_subscriptions, price) VALUES
  ('free', 50, false, 0),
  ('pro', NULL, true, 99.00),
  ('enterprise', NULL, true, 299.00);

-- Add plan columns to barbershops
ALTER TABLE public.barbershops
  ADD COLUMN plan_id UUID REFERENCES public.plans(id),
  ADD COLUMN appointments_this_month INTEGER NOT NULL DEFAULT 0;

-- Set default plan to free for all existing barbershops
UPDATE public.barbershops 
SET plan_id = (SELECT id FROM public.plans WHERE name = 'free');

-- Security definer function to check appointment limit
CREATE OR REPLACE FUNCTION public.check_appointment_limit(_barbershop_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.appointment_limit IS NULL THEN true
    WHEN b.appointments_this_month < p.appointment_limit THEN true
    ELSE false
  END
  FROM barbershops b
  JOIN plans p ON b.plan_id = p.id
  WHERE b.id = _barbershop_id
$$;

-- Function to increment appointment counter
CREATE OR REPLACE FUNCTION public.increment_appointment_counter()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE barbershops
  SET appointments_this_month = appointments_this_month + 1
  WHERE id = NEW.barbershop_id;
  RETURN NEW;
END;
$$;

-- Trigger after appointment insert
CREATE TRIGGER after_appointment_insert
AFTER INSERT ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.increment_appointment_counter();

-- Update the existing insert policy to also check plan limits
DROP POLICY IF EXISTS "Authenticated users can create appointments" ON public.appointments;

CREATE POLICY "Authenticated users can create appointments" 
ON public.appointments 
FOR INSERT 
TO authenticated
WITH CHECK (
  (
    (client_id = auth.uid()) 
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role) 
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  AND public.check_appointment_limit(barbershop_id)
);

-- Enable realtime for barbershops (for appointment counter updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.barbershops;
