/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD OPERACIONAL — resumo do dia em uma única consulta
   ---------------------------------------------------------------------------
   Uma RPC de contagens do dia (agendamentos por status + comandas abertas),
   em vez de várias consultas e reduções no frontend. Ganhos:
     • isolamento: reusa report_barber_scope (barbeiro preso ao próprio escopo,
       admin/super veem a barbearia; cliente/anon recusados);
     • desempenho: um round-trip, devolve só CONTAGENS (não linhas);
     • consistência: mesma regra de fuso dos relatórios;
     • menos consultas: some as N chamadas por card.

   O faturamento NÃO entra aqui — o dashboard reusa report_sales_summary
   (fonte única do financeiro). Aqui só o operacional do dia.

   Migration posterior a 20260724120000; não altera nada anterior.
   ═══════════════════════════════════════════════════════════════════════════ */

CREATE OR REPLACE FUNCTION public.get_dashboard_summary(
  _barbershop_id uuid,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  appointments_today integer,
  scheduled_today    integer,
  completed_today    integer,
  cancelled_today    integer,
  no_show_today      integer,
  open_tickets       integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Reusa a autorização dos relatórios: barbeiro → próprio id; admin/super →
  -- toda a barbearia (ou drill-down); cliente/anon → EXCEPTION.
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
  _tz    text;
  _today date;
BEGIN
  SELECT COALESCE(b.timezone, 'America/Sao_Paulo') INTO _tz
  FROM public.barbershops b WHERE b.id = _barbershop_id;
  _tz := COALESCE(_tz, 'America/Sao_Paulo');
  -- "Hoje" no fuso da barbearia (appointments.date é DATE de calendário).
  _today := (now() AT TIME ZONE _tz)::date;

  RETURN QUERY
  WITH appt AS (
    SELECT a.status
    FROM public.appointments a
    WHERE a.barbershop_id = _barbershop_id
      AND a.date = _today
      AND (_scope IS NULL OR a.barber_id = _scope)
  ),
  tk AS (
    SELECT 1
    FROM public.tickets t
    WHERE t.barbershop_id = _barbershop_id
      AND t.status = 'aberta'
      AND (_scope IS NULL OR t.barber_id = _scope)
  )
  SELECT
    (SELECT count(*) FROM appt)::int,
    (SELECT count(*) FROM appt WHERE status = 'scheduled')::int,
    (SELECT count(*) FROM appt WHERE status = 'completed')::int,
    (SELECT count(*) FROM appt WHERE status = 'cancelled')::int,
    (SELECT count(*) FROM appt WHERE status = 'no_show')::int,
    (SELECT count(*) FROM tk)::int;
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_summary(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid, uuid) TO authenticated;
