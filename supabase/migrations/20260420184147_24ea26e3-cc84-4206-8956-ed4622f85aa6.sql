-- Table for manual client blocks
CREATE TABLE public.client_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL,
  client_id UUID NOT NULL,
  blocked_until TIMESTAMPTZ NOT NULL,
  reason TEXT,
  blocked_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_blocks_barbershop_client ON public.client_blocks(barbershop_id, client_id);
CREATE INDEX idx_client_blocks_active ON public.client_blocks(barbershop_id, blocked_until);

ALTER TABLE public.client_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view client blocks"
ON public.client_blocks FOR SELECT TO authenticated
USING (has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can insert client blocks"
ON public.client_blocks FOR INSERT TO authenticated
WITH CHECK (
  (has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  AND blocked_by = auth.uid()
);

CREATE POLICY "Admins can update client blocks"
ON public.client_blocks FOR UPDATE TO authenticated
USING (has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Admins can delete client blocks"
ON public.client_blocks FOR DELETE TO authenticated
USING (has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- Allow the blocked client themselves to see their active block (so they understand why bookings fail)
CREATE POLICY "Clients can view their own active blocks"
ON public.client_blocks FOR SELECT TO authenticated
USING (client_id = auth.uid() AND blocked_until > now());

CREATE TRIGGER trg_client_blocks_updated_at
BEFORE UPDATE ON public.client_blocks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Update check_client_noshow_block to also honor manual blocks
CREATE OR REPLACE FUNCTION public.check_client_noshow_block(_client_id uuid, _barbershop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _enabled boolean;
  _max integer;
  _days integer;
  _count integer;
  _last_noshow timestamptz;
  _unblock_at timestamptz;
  _blocked boolean := false;
  _manual_until timestamptz;
  _manual_reason text;
BEGIN
  -- Manual block takes precedence
  SELECT MAX(blocked_until) INTO _manual_until
  FROM public.client_blocks
  WHERE client_id = _client_id
    AND barbershop_id = _barbershop_id
    AND blocked_until > now();

  IF _manual_until IS NOT NULL THEN
    SELECT reason INTO _manual_reason
    FROM public.client_blocks
    WHERE client_id = _client_id AND barbershop_id = _barbershop_id AND blocked_until = _manual_until
    ORDER BY created_at DESC LIMIT 1;

    RETURN jsonb_build_object(
      'blocked', true,
      'manual', true,
      'reason', _manual_reason,
      'unblock_at', _manual_until,
      'noshow_count', 0
    );
  END IF;

  SELECT noshow_policy_enabled, noshow_max_count, noshow_block_days
    INTO _enabled, _max, _days
  FROM public.barbershops
  WHERE id = _barbershop_id;

  IF NOT COALESCE(_enabled, false) OR COALESCE(_max, 0) <= 0 OR COALESCE(_days, 0) <= 0 THEN
    RETURN jsonb_build_object('blocked', false);
  END IF;

  SELECT COUNT(*), MAX(updated_at)
    INTO _count, _last_noshow
  FROM public.appointments
  WHERE client_id = _client_id
    AND barbershop_id = _barbershop_id
    AND status = 'no_show'
    AND updated_at >= now() - interval '30 days';

  IF _count >= _max AND _last_noshow IS NOT NULL THEN
    _unblock_at := _last_noshow + (_days || ' days')::interval;
    IF _unblock_at > now() THEN
      _blocked := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'blocked', _blocked,
    'manual', false,
    'noshow_count', COALESCE(_count, 0),
    'max_count', _max,
    'block_days', _days,
    'last_noshow_at', _last_noshow,
    'unblock_at', CASE WHEN _blocked THEN _unblock_at ELSE NULL END
  );
END;
$$;

-- RPC: aggregate top no-show clients for the admin report
CREATE OR REPLACE FUNCTION public.get_noshow_report(_barbershop_id uuid, _days integer DEFAULT 30)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_avatar text,
  noshow_count bigint,
  total_appointments bigint,
  last_noshow_at timestamptz,
  manual_blocked_until timestamptz,
  manual_block_reason text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (has_role_in_barbershop(auth.uid(), _barbershop_id, 'admin_barbearia'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT
      a.client_id,
      COUNT(*) FILTER (WHERE a.status = 'no_show') AS noshow_count,
      COUNT(*) AS total_appointments,
      MAX(a.updated_at) FILTER (WHERE a.status = 'no_show') AS last_noshow_at
    FROM public.appointments a
    WHERE a.barbershop_id = _barbershop_id
      AND a.date >= (CURRENT_DATE - _days)
    GROUP BY a.client_id
    HAVING COUNT(*) FILTER (WHERE a.status = 'no_show') > 0
  ),
  manual AS (
    SELECT DISTINCT ON (cb.client_id)
      cb.client_id, cb.blocked_until, cb.reason
    FROM public.client_blocks cb
    WHERE cb.barbershop_id = _barbershop_id AND cb.blocked_until > now()
    ORDER BY cb.client_id, cb.blocked_until DESC
  )
  SELECT
    s.client_id,
    COALESCE(NULLIF(TRIM(p.full_name), ''), INITCAP(SPLIT_PART(u.email, '@', 1)), 'Cliente') AS client_name,
    p.avatar_url,
    s.noshow_count,
    s.total_appointments,
    s.last_noshow_at,
    m.blocked_until,
    m.reason
  FROM stats s
  LEFT JOIN auth.users u ON u.id = s.client_id
  LEFT JOIN public.profiles p ON p.user_id = s.client_id
  LEFT JOIN manual m ON m.client_id = s.client_id
  ORDER BY s.noshow_count DESC, s.last_noshow_at DESC;
END;
$$;