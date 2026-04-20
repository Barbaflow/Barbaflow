CREATE OR REPLACE FUNCTION public.enforce_pinned_notes_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  IF NEW.pinned IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- Skip if pinned was already true and this is an UPDATE that didn't change pinned
  IF TG_OP = 'UPDATE' AND OLD.pinned IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO _count
  FROM public.client_notes
  WHERE barbershop_id = NEW.barbershop_id
    AND client_id = NEW.client_id
    AND pinned = true
    AND id <> NEW.id;

  IF _count >= 3 THEN
    RAISE EXCEPTION 'PINNED_LIMIT_REACHED'
      USING HINT = 'Máximo de 3 anotações fixadas por cliente. Desfixe uma para fixar outra.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_pinned_notes_limit_trigger
BEFORE INSERT OR UPDATE OF pinned ON public.client_notes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_pinned_notes_limit();