CREATE TABLE public.account_deletions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  reason TEXT,
  details TEXT,
  cancelled_at TIMESTAMP WITH TIME ZONE,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own deletion request"
ON public.account_deletions
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can cancel their own deletion request"
ON public.account_deletions
FOR UPDATE
TO authenticated
USING (user_id = auth.uid() AND cancelled_at IS NULL AND processed_at IS NULL)
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Super admins can view all deletion requests"
ON public.account_deletions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_admin'::app_role));

CREATE INDEX idx_account_deletions_scheduled_for
ON public.account_deletions (scheduled_for)
WHERE cancelled_at IS NULL AND processed_at IS NULL;

CREATE TRIGGER trg_account_deletions_updated_at
BEFORE UPDATE ON public.account_deletions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();