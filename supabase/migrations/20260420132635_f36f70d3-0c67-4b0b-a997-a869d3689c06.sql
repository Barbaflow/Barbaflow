-- Normalize existing phone numbers in profiles: prefix '55' when missing
-- Strategy: keep only digits, then prefix '55' for 10-11 digit local BR numbers
UPDATE public.profiles
SET phone = '55' || regexp_replace(phone, '\D', '', 'g'),
    updated_at = now()
WHERE phone IS NOT NULL
  AND phone <> ''
  AND length(regexp_replace(phone, '\D', '', 'g')) IN (10, 11);

-- Also clean up phones that already have 55 prefix but contain non-digit symbols
UPDATE public.profiles
SET phone = regexp_replace(phone, '\D', '', 'g'),
    updated_at = now()
WHERE phone IS NOT NULL
  AND phone <> ''
  AND length(regexp_replace(phone, '\D', '', 'g')) IN (12, 13)
  AND regexp_replace(phone, '\D', '', 'g') LIKE '55%'
  AND phone <> regexp_replace(phone, '\D', '', 'g');