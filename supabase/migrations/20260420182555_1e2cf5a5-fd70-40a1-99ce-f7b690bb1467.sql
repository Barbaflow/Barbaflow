-- 1) Add no-show policy columns to barbershops
ALTER TABLE public.barbershops
ADD COLUMN IF NOT EXISTS noshow_policy_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS noshow_max_count integer NOT NULL DEFAULT 3,
ADD COLUMN IF NOT EXISTS noshow_block_days integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.barbershops.noshow_policy_enabled IS 'When true, clients with too many recent no-shows are blocked from self-booking.';
COMMENT ON COLUMN public.barbershops.noshow_max_count IS 'Number of no-shows in the last 30 days that triggers a block.';
COMMENT ON COLUMN public.barbershops.noshow_block_days IS 'How many days the block lasts after the most recent no-show.';

-- 2) Security definer function to check if a client is blocked at a given barbershop.
-- Returns jsonb { blocked, noshow_count, max_count, block_days, unblock_at, last_noshow_at }
-- so the UI can show a friendly message; SQL policies just read .blocked.
CREATE OR REPLACE FUNCTION public.check_client_noshow_block(
  _client_id uuid,
  _barbershop_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _enabled boolean;
  _max integer;
  _days integer;
  _count integer;
  _last_noshow timestamp with time zone;
  _unblock_at timestamp with time zone;
  _blocked boolean := false;
BEGIN
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
    'noshow_count', COALESCE(_count, 0),
    'max_count', _max,
    'block_days', _days,
    'last_noshow_at', _last_noshow,
    'unblock_at', CASE WHEN _blocked THEN _unblock_at ELSE NULL END
  );
END;
$$;

-- 3) Replace the INSERT policy on appointments to also block self-bookings from blocked clients.
-- Admin/barber/super_admin manual bookings remain allowed (override).
DROP POLICY IF EXISTS "Authenticated users can create appointments" ON public.appointments;

CREATE POLICY "Authenticated users can create appointments"
ON public.appointments
FOR INSERT
TO authenticated
WITH CHECK (
  (
    -- Self-booking by the client: blocked if no-show policy applies
    (
      client_id = auth.uid()
      AND NOT (public.check_client_noshow_block(auth.uid(), barbershop_id) ->> 'blocked')::boolean
    )
    -- Manual booking by team members or super admin: bypass the no-show check
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
  AND check_appointment_limit(barbershop_id)
);