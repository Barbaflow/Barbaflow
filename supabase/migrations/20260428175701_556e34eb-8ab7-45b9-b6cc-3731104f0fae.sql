-- RPC para criar cliente "walk-in" (sem conta de auth) a partir do dashboard do barbeiro/admin.
-- Insere apenas em public.profiles com um user_id UUID gerado (sem FK para auth.users).
-- Apenas barbeiros/admins da barbearia (ou super_admin) podem chamar.
-- Aceita nome obrigatório, telefone opcional. Retorna o user_id criado.

CREATE OR REPLACE FUNCTION public.create_walkin_client(
  _barbershop_id uuid,
  _full_name text,
  _phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid;
  _new_id uuid;
  _trimmed_name text;
  _trimmed_phone text;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT (
    public.has_role_in_barbershop(_caller, _barbershop_id, 'barbeiro'::app_role)
    OR public.has_role_in_barbershop(_caller, _barbershop_id, 'admin_barbearia'::app_role)
    OR public.has_role(_caller, 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  _trimmed_name := NULLIF(TRIM(_full_name), '');
  IF _trimmed_name IS NULL THEN
    RAISE EXCEPTION 'name_required';
  END IF;
  IF char_length(_trimmed_name) > 120 THEN
    RAISE EXCEPTION 'name_too_long';
  END IF;

  _trimmed_phone := NULLIF(TRIM(_phone), '');
  IF _trimmed_phone IS NOT NULL AND char_length(_trimmed_phone) > 20 THEN
    RAISE EXCEPTION 'phone_too_long';
  END IF;

  _new_id := gen_random_uuid();

  INSERT INTO public.profiles (user_id, full_name, phone)
  VALUES (_new_id, _trimmed_name, _trimmed_phone);

  RETURN _new_id;
END;
$$;