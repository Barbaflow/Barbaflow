-- Trigger to notify client when staff replies to their review
CREATE OR REPLACE FUNCTION public.notify_review_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _barbershop_name TEXT;
BEGIN
  -- Only notify when reply is newly added or actually changed (and not removed)
  IF NEW.reply IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.reply IS NOT NULL AND OLD.reply = NEW.reply THEN
    RETURN NEW;
  END IF;

  -- Don't notify if the replier is the same as the review author
  IF NEW.replied_by IS NOT NULL AND NEW.replied_by = NEW.client_id THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _barbershop_name FROM public.barbershops WHERE id = NEW.barbershop_id;

  INSERT INTO public.notifications (user_id, barbershop_id, title, message, type, appointment_id)
  VALUES (
    NEW.client_id,
    NEW.barbershop_id,
    CASE WHEN OLD.reply IS NULL THEN 'Resposta à sua avaliação' ELSE 'Resposta atualizada' END,
    COALESCE(_barbershop_name, 'A barbearia') || ' respondeu à sua avaliação: "' ||
      CASE WHEN length(NEW.reply) > 120 THEN substring(NEW.reply from 1 for 117) || '...' ELSE NEW.reply END
      || '"',
    'review_reply',
    NEW.appointment_id
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_review_reply ON public.reviews;
CREATE TRIGGER trg_notify_review_reply
AFTER UPDATE OF reply ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION public.notify_review_reply();

-- The notifications INSERT policy requires user_id = auth.uid(); since this trigger is
-- SECURITY DEFINER and inserts directly, it bypasses RLS. No policy change needed.