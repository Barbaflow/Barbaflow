-- Returns display name for a list of barbers (profile full_name, fallback to auth email local-part)
CREATE OR REPLACE FUNCTION public.get_barber_display_names(_user_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id AS user_id,
    COALESCE(
      NULLIF(TRIM(p.full_name), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(TRIM(u.raw_user_meta_data ->> 'name'), ''),
      INITCAP(SPLIT_PART(u.email, '@', 1)),
      'Barbeiro'
    ) AS display_name,
    COALESCE(p.avatar_url, u.raw_user_meta_data ->> 'avatar_url') AS avatar_url
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = ANY(_user_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_barber_display_names(uuid[]) TO anon, authenticated;