ALTER TABLE public.plans ADD COLUMN barber_limit integer DEFAULT NULL;

UPDATE public.plans SET barber_limit = 1 WHERE name = 'free';

CREATE OR REPLACE FUNCTION public.check_barber_limit(_barbershop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN p.barber_limit IS NULL THEN true
    WHEN (SELECT count(*) FROM user_roles ur WHERE ur.barbershop_id = _barbershop_id AND ur.role IN ('barbeiro', 'admin_barbearia')) < p.barber_limit THEN true
    ELSE false
  END
  FROM barbershops b
  JOIN plans p ON b.plan_id = p.id
  WHERE b.id = _barbershop_id
$$;