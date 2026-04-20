
-- Function: notify clients whose blocks (manual or automatic) have expired in the last hour
CREATE OR REPLACE FUNCTION public.notify_expired_client_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row RECORD;
  _inserted integer := 0;
  _barbershop_name text;
  _already boolean;
BEGIN
  -- 1) Manual blocks that expired in the last hour
  FOR _row IN
    SELECT DISTINCT ON (cb.client_id, cb.barbershop_id)
      cb.client_id, cb.barbershop_id, cb.blocked_until
    FROM public.client_blocks cb
    WHERE cb.blocked_until <= now()
      AND cb.blocked_until > now() - interval '1 hour 5 minutes'
    ORDER BY cb.client_id, cb.barbershop_id, cb.blocked_until DESC
  LOOP
    -- Skip if there's still an active block (manual)
    IF EXISTS (
      SELECT 1 FROM public.client_blocks
      WHERE client_id = _row.client_id
        AND barbershop_id = _row.barbershop_id
        AND blocked_until > now()
    ) THEN
      CONTINUE;
    END IF;

    -- Skip if there's still an active automatic block
    IF ((public.check_client_noshow_block(_row.client_id, _row.barbershop_id) ->> 'blocked')::boolean) THEN
      CONTINUE;
    END IF;

    -- Anti-duplicate (24h window for unblock notifications)
    SELECT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = _row.client_id
        AND barbershop_id = _row.barbershop_id
        AND type = 'noshow_unblocked'
        AND created_at >= now() - interval '1 day'
    ) INTO _already;
    IF _already THEN CONTINUE; END IF;

    SELECT name INTO _barbershop_name FROM public.barbershops WHERE id = _row.barbershop_id;

    INSERT INTO public.notifications (user_id, barbershop_id, title, message, type)
    VALUES (
      _row.client_id,
      _row.barbershop_id,
      'Você já pode agendar novamente',
      'Seu bloqueio em ' || COALESCE(_barbershop_name, 'na barbearia')
        || ' foi liberado. Você já pode fazer novos agendamentos normalmente.',
      'noshow_unblocked'
    );
    _inserted := _inserted + 1;
  END LOOP;

  -- 2) Automatic blocks: clients who had a 'noshow_blocked' notification but are no longer blocked
  FOR _row IN
    SELECT DISTINCT n.user_id AS client_id, n.barbershop_id
    FROM public.notifications n
    WHERE n.type = 'noshow_blocked'
      AND n.created_at >= now() - interval '60 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.notifications n2
        WHERE n2.user_id = n.user_id
          AND n2.barbershop_id = n.barbershop_id
          AND n2.type = 'noshow_unblocked'
          AND n2.created_at > n.created_at
      )
  LOOP
    -- Skip if still blocked (manual or automatic)
    IF ((public.check_client_noshow_block(_row.client_id, _row.barbershop_id) ->> 'blocked')::boolean) THEN
      CONTINUE;
    END IF;

    SELECT name INTO _barbershop_name FROM public.barbershops WHERE id = _row.barbershop_id;

    INSERT INTO public.notifications (user_id, barbershop_id, title, message, type)
    VALUES (
      _row.client_id,
      _row.barbershop_id,
      'Você já pode agendar novamente',
      'Seu bloqueio em ' || COALESCE(_barbershop_name, 'na barbearia')
        || ' foi liberado. Você já pode fazer novos agendamentos normalmente.',
      'noshow_unblocked'
    );
    _inserted := _inserted + 1;
  END LOOP;

  RETURN _inserted;
END;
$$;

-- Schedule hourly via pg_cron (extension already enabled in this project)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Unschedule prior version if any
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notify-expired-client-blocks';
    PERFORM cron.schedule(
      'notify-expired-client-blocks',
      '5 * * * *',
      $cron$ SELECT public.notify_expired_client_blocks(); $cron$
    );
  END IF;
END $$;
