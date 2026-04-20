CREATE TABLE public.account_deletion_feedback (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reason TEXT NOT NULL,
  details TEXT,
  had_barbershop_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can insert deletion feedback"
ON public.account_deletion_feedback
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Super admins can view deletion feedback"
ON public.account_deletion_feedback
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE INDEX idx_account_deletion_feedback_created_at
ON public.account_deletion_feedback (created_at DESC);

CREATE INDEX idx_account_deletion_feedback_reason
ON public.account_deletion_feedback (reason);