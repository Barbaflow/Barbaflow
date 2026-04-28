ALTER TABLE public.barbershops
  ADD COLUMN IF NOT EXISTS receipt_title text,
  ADD COLUMN IF NOT EXISTS receipt_subtitle text,
  ADD COLUMN IF NOT EXISTS receipt_footer text,
  ADD COLUMN IF NOT EXISTS receipt_thank_you_message text,
  ADD COLUMN IF NOT EXISTS receipt_whatsapp_intro text;