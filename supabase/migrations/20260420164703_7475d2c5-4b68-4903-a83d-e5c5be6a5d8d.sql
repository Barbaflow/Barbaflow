DROP POLICY IF EXISTS "Authenticated users can create appointments" ON public.appointments;

CREATE POLICY "Authenticated users can create appointments"
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (
  (
    (client_id = auth.uid())
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  AND check_appointment_limit(barbershop_id)
);