UPDATE public.services s
SET active = false
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = s.barber_id
    AND ur.barbershop_id = s.barbershop_id
    AND ur.role IN ('barbeiro','admin_barbearia')
);