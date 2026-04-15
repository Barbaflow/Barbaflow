
CREATE OR REPLACE FUNCTION public.has_active_subscription(
  user_uuid UUID,
  check_env TEXT DEFAULT 'live'
)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = user_uuid
    AND environment = check_env
    AND status IN ('active', 'trialing')
    AND (current_period_end IS NULL OR current_period_end > now())
  );
$$;
