-- Internal notes about clients, visible only to barbershop staff
CREATE TABLE public.client_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL,
  client_id UUID NOT NULL,
  note TEXT NOT NULL,
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_notes_barbershop_client
  ON public.client_notes (barbershop_id, client_id, created_at DESC);

ALTER TABLE public.client_notes ENABLE ROW LEVEL SECURITY;

-- SELECT: only staff of the barbershop (or super admin)
CREATE POLICY "Staff can view client notes"
  ON public.client_notes
  FOR SELECT
  TO authenticated
  USING (
    has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- INSERT: staff only, and must record themselves as the author
CREATE POLICY "Staff can insert client notes"
  ON public.client_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
      OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- UPDATE: staff only
CREATE POLICY "Staff can update client notes"
  ON public.client_notes
  FOR UPDATE
  TO authenticated
  USING (
    has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- DELETE: staff only
CREATE POLICY "Staff can delete client notes"
  ON public.client_notes
  FOR DELETE
  TO authenticated
  USING (
    has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

-- Auto-update updated_at
CREATE TRIGGER update_client_notes_updated_at
  BEFORE UPDATE ON public.client_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();