CREATE OR REPLACE FUNCTION public.get_client_phone(_client_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _phone text;
  _caller uuid;
  _allowed boolean;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RETURN NULL;
  END IF;

  -- The client can always see their own phone (also covered by RLS, but explicit)
  IF _caller = _client_id THEN
    SELECT phone INTO _phone FROM public.profiles WHERE user_id = _client_id;
    RETURN _phone;
  END IF;

  -- Caller must be barbeiro/admin in a barbershop where the client has appointments
  SELECT EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.user_roles ur
      ON ur.barbershop_id = a.barbershop_id
     AND ur.user_id = _caller
     AND ur.role IN ('barbeiro', 'admin_barbearia')
    WHERE a.client_id = _client_id
  ) INTO _allowed;

  IF NOT _allowed THEN
    RETURN NULL;
  END IF;

  SELECT phone INTO _phone FROM public.profiles WHERE user_id = _client_id;
  RETURN _phone;
END;
$function$;