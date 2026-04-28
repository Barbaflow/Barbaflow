ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS number text,
  ADD COLUMN IF NOT EXISTS complement text;

CREATE INDEX IF NOT EXISTS idx_barbershops_state ON public.barbershops (state);
CREATE INDEX IF NOT EXISTS idx_barbershops_city ON public.barbershops (city);
CREATE INDEX IF NOT EXISTS idx_barbershops_neighborhood ON public.barbershops (neighborhood);