-- Add reply fields to reviews
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reply text,
  ADD COLUMN IF NOT EXISTS reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by uuid;

-- Allow barbers/admins of the barbershop (or super_admin) to update reviews
-- (for adding/editing the reply). Existing policy allowed only the author.
DROP POLICY IF EXISTS "Barbers and admins can reply to reviews" ON public.reviews;
CREATE POLICY "Barbers and admins can reply to reviews"
ON public.reviews
FOR UPDATE
TO authenticated
USING (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

-- Allow barbers/admins of the barbershop to delete reviews (moderation)
DROP POLICY IF EXISTS "Barbers and admins can delete reviews" ON public.reviews;
CREATE POLICY "Barbers and admins can delete reviews"
ON public.reviews
FOR DELETE
TO authenticated
USING (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
);