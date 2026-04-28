CREATE OR REPLACE VIEW public.barbearias_publicas AS
SELECT
  id,
  name,
  subdomain,
  logo_url,
  primary_color,
  secondary_color,
  rating_avg,
  rating_count,
  created_at,
  cep,
  state,
  city,
  neighborhood,
  street,
  number,
  complement
FROM public.barbershops
WHERE status = 'approved'::approval_status;