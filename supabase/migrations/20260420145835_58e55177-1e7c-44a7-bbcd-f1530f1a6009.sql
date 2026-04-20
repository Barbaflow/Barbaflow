ALTER TABLE public.barbershops
ADD COLUMN IF NOT EXISTS pdf_template text DEFAULT 'minimal',
ADD COLUMN IF NOT EXISTS pdf_slogan text,
ADD COLUMN IF NOT EXISTS qr_size text DEFAULT 'medium';