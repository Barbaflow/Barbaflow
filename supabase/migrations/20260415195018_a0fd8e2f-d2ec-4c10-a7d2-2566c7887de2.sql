
CREATE TABLE public.plan_change_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  old_plan_id uuid REFERENCES public.plans(id),
  new_plan_id uuid NOT NULL REFERENCES public.plans(id),
  changed_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_change_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view plan change logs"
  ON public.plan_change_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Super admins can insert plan change logs"
  ON public.plan_change_logs FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));
