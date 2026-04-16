CREATE OR REPLACE FUNCTION public.cleanup_removed_team_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only act on barber/admin role removals
  IF OLD.role NOT IN ('barbeiro', 'admin_barbearia') THEN
    RETURN OLD;
  END IF;

  -- Skip if user still has another barber/admin role in the same barbershop
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = OLD.user_id
      AND barbershop_id = OLD.barbershop_id
      AND role IN ('barbeiro', 'admin_barbearia')
      AND id <> OLD.id
  ) THEN
    RETURN OLD;
  END IF;

  -- Deactivate services owned by this barber in this barbershop
  UPDATE public.services
  SET active = false, updated_at = now()
  WHERE barber_id = OLD.user_id
    AND barbershop_id = OLD.barbershop_id;

  -- Remove future availability slots
  DELETE FROM public.availability
  WHERE barber_id = OLD.user_id
    AND barbershop_id = OLD.barbershop_id
    AND date >= CURRENT_DATE;

  -- Remove weekly schedule
  DELETE FROM public.weekly_schedule
  WHERE barber_id = OLD.user_id
    AND barbershop_id = OLD.barbershop_id;

  -- Remove future schedule blocks
  DELETE FROM public.schedule_blocks
  WHERE barber_id = OLD.user_id
    AND barbershop_id = OLD.barbershop_id
    AND block_date >= CURRENT_DATE;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_removed_team_member ON public.user_roles;

CREATE TRIGGER trg_cleanup_removed_team_member
AFTER DELETE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.cleanup_removed_team_member();