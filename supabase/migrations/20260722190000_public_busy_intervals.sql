-- Disponibilidade correta para quem ainda não entrou.
--
-- Motivo: `availability` tem SELECT público ("Anyone can view availability of
-- approved barbershops"), mas `appointments` só tem policy `TO authenticated`.
-- O wizard público monta os horários subtraindo os agendamentos das janelas —
-- e, para um visitante anônimo, a consulta de agendamentos volta VAZIA. Ou
-- seja: quem não estava logado via TODOS os horários como livres, inclusive os
-- já reservados, escolhia um deles e só descobria o problema ao confirmar.
--
-- A correção não afrouxa nenhuma policy: `appointments` continua fechada para
-- anônimo. Esta função devolve apenas os INTERVALOS ocupados — hora de início e
-- fim — sem cliente, sem serviço, sem observação. É estritamente o mesmo tipo
-- de informação que a tabela `availability` já publica.

CREATE OR REPLACE FUNCTION public.get_public_busy_intervals(
  _barbershop_id uuid,
  _barber_id uuid,
  _date date
)
RETURNS TABLE (start_time time, end_time time)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT a.start_time, a.end_time
  FROM public.appointments a
  JOIN public.barbershops b ON b.id = a.barbershop_id
  WHERE a.barbershop_id = _barbershop_id
    AND a.barber_id     = _barber_id
    AND a.date          = _date
    AND a.status <> 'cancelled'
    -- Só barbearia aprovada tem página pública; a sentinela nunca é publicada.
    AND b.status = 'approved'
    AND NOT public.barbershop_is_system_sentinel(b.id);
$$;

COMMENT ON FUNCTION public.get_public_busy_intervals(uuid, uuid, date) IS
  'Intervalos ocupados de um profissional em uma data, para o fluxo público de '
  'agendamento. Devolve apenas horários — nenhum dado de cliente.';

REVOKE ALL ON FUNCTION public.get_public_busy_intervals(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_busy_intervals(uuid, uuid, date) TO anon, authenticated;
