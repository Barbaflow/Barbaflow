
-- 1. Add rating cache columns to barbershops
ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

-- 2. Create reviews table
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  rating smallint NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_unique_per_appointment UNIQUE (client_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_barbershop ON public.reviews(barbershop_id);
CREATE INDEX IF NOT EXISTS idx_reviews_client ON public.reviews(client_id);

-- updated_at trigger
DROP TRIGGER IF EXISTS reviews_set_updated_at ON public.reviews;
CREATE TRIGGER reviews_set_updated_at
BEFORE UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Enable RLS
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- SELECT: público para barbearias aprovadas
CREATE POLICY "Anyone can view reviews of approved barbershops"
ON public.reviews FOR SELECT
TO public
USING (
  EXISTS (
    SELECT 1 FROM public.barbershops b
    WHERE b.id = reviews.barbershop_id AND b.status = 'approved'
  )
);

-- INSERT: cliente autenticado que tem appointment completed na barbearia
CREATE POLICY "Clients can create reviews for completed appointments"
ON public.reviews FOR INSERT
TO authenticated
WITH CHECK (
  client_id = auth.uid()
  AND (
    appointment_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = reviews.appointment_id
        AND a.client_id = auth.uid()
        AND a.barbershop_id = reviews.barbershop_id
        AND a.status = 'completed'
    )
  )
);

-- UPDATE: só o autor
CREATE POLICY "Authors can update their reviews"
ON public.reviews FOR UPDATE
TO authenticated
USING (client_id = auth.uid())
WITH CHECK (client_id = auth.uid());

-- DELETE: autor ou super_admin
CREATE POLICY "Authors or super admins can delete reviews"
ON public.reviews FOR DELETE
TO authenticated
USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

-- 4. Trigger para recalcular rating_avg/count
CREATE OR REPLACE FUNCTION public.recalc_barbershop_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _barbershop_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _barbershop_id := OLD.barbershop_id;
  ELSE
    _barbershop_id := NEW.barbershop_id;
  END IF;

  UPDATE public.barbershops b
  SET
    rating_avg = COALESCE((
      SELECT ROUND(AVG(rating)::numeric, 2)
      FROM public.reviews r
      WHERE r.barbershop_id = _barbershop_id
    ), 0),
    rating_count = (
      SELECT COUNT(*)
      FROM public.reviews r
      WHERE r.barbershop_id = _barbershop_id
    ),
    updated_at = now()
  WHERE b.id = _barbershop_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS reviews_recalc_rating ON public.reviews;
CREATE TRIGGER reviews_recalc_rating
AFTER INSERT OR UPDATE OR DELETE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.recalc_barbershop_rating();

-- 5. View pública de barbearias
DROP VIEW IF EXISTS public.barbearias_publicas;
CREATE VIEW public.barbearias_publicas
WITH (security_invoker = on) AS
SELECT
  id,
  name,
  subdomain,
  logo_url,
  primary_color,
  secondary_color,
  rating_avg,
  rating_count,
  created_at
FROM public.barbershops
WHERE status = 'approved';

GRANT SELECT ON public.barbearias_publicas TO anon, authenticated;
