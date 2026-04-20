CREATE OR REPLACE FUNCTION public.get_barbershop_clients(_barbershop_id uuid)
RETURNS TABLE(
  client_id uuid,
  client_name text,
  client_avatar text,
  client_phone text,
  total_appointments bigint,
  completed_count bigint,
  noshow_count bigint,
  cancelled_count bigint,
  first_appointment_at timestamptz,
  last_appointment_at timestamptz,
  manual_blocked_until timestamptz,
  manual_block_reason text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    has_role_in_barbershop(auth.uid(), _barbershop_id, 'admin_barbearia'::app_role)
    OR has_role_in_barbershop(auth.uid(), _barbershop_id, 'barbeiro'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  WITH stats AS (
    SELECT
      a.client_id,
      COUNT(*) AS total_appointments,
      COUNT(*) FILTER (WHERE a.status = 'completed') AS completed_count,
      COUNT(*) FILTER (WHERE a.status = 'no_show') AS noshow_count,
      COUNT(*) FILTER (WHERE a.status = 'cancelled') AS cancelled_count,
      MIN(a.created_at) AS first_appointment_at,
      MAX(a.date::timestamptz + a.start_time::interval) AS last_appointment_at
    FROM public.appointments a
    WHERE a.barbershop_id = _barbershop_id
    GROUP BY a.client_id
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
    COALESCE(
      NULLIF(TRIM(p.full_name), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'name'), ''),
      INITCAP(SPLIT_PART(u.email, '@', 1)),
      'Cliente'
    ) AS client_name,
    p.avatar_url AS client_avatar,
    p.phone AS client_phone,
    s.total_appointments,
    s.completed_count,
    s.noshow_count,
    s.cancelled_count,
    s.first_appointment_at,
    s.last_appointment_at,
    m.blocked_until,
    m.reason
  FROM stats s
  LEFT JOIN auth.users u ON u.id = s.client_id
  LEFT JOIN public.profiles p ON p.user_id = s.client_id
  LEFT JOIN manual m ON m.client_id = s.client_id
  ORDER BY s.last_appointment_at DESC NULLS LAST;
END;
$function$;