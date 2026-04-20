-- Public function to list barbers of an approved barbershop
-- Bypasses user_roles RLS safely (only exposes user_ids of barbers in approved shops)
CREATE OR REPLACE FUNCTION public.get_public_barbers(_barbershop_id uuid)
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ur.user_id
  FROM public.user_roles ur
  JOIN public.barbershops b ON b.id = ur.barbershop_id
  WHERE ur.barbershop_id = _barbershop_id
    AND b.status = 'approved'
    AND ur.role IN ('barbeiro', 'admin_barbearia');
$$;

-- Allow anonymous and authenticated to call it
GRANT EXECUTE ON FUNCTION public.get_public_barbers(uuid) TO anon, authenticated;