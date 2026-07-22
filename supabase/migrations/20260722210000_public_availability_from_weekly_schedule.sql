-- Disponibilidade pública derivada da grade semanal.
--
-- Problema: existiam DUAS fontes de disponibilidade.
--   * a agenda interna lê `weekly_schedule` direto;
--   * o fluxo público lia a tabela `availability`, que só é preenchida quando
--     alguém clica em "Gerar Agenda" (`generate_availability_from_schedule`).
-- Consequência: uma barbearia recém-configurada tem a agenda interna
-- funcionando e a página pública mostrando ZERO horários — sem nenhum aviso.
-- E, mesmo depois de gerar, a materialização tem horizonte fixo (14 dias):
-- passado esse prazo o público voltava a ficar vazio até alguém clicar de novo.
--
-- Solução: o público passa a DERIVAR as janelas de `weekly_schedule`, que é a
-- mesma fonte da agenda interna. Salvar a grade já basta — não há passo manual,
-- não há horizonte, não há duplicata possível e vale imediatamente para os
-- dados que já existem.
--
-- `availability` continua existindo e continua sendo respeitada, mas com um
-- papel único e claro: EXCEÇÕES pontuais de um dia (`folga`, `ocupado`)
-- lançadas na tela de agenda. As linhas `livre` viram apenas uma materialização
-- opcional da grade e são ignoradas aqui — é o que elimina a divergência.
--
-- Uma RPC SECURITY DEFINER, e não um afrouxamento de RLS: `weekly_schedule` é
-- fechada para anônimo e continua fechada. A função devolve somente intervalos
-- de uma barbearia aprovada — nenhum dado de pessoa.

CREATE OR REPLACE FUNCTION public.get_public_availability_windows(
  _barbershop_id uuid,
  _barber_id uuid,
  _date date
)
RETURNS TABLE (start_time time, end_time time, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Base: turnos ativos do profissional naquele dia da semana.
  -- `EXTRACT(DOW …)` devolve 0=domingo, a mesma convenção de
  -- `weekly_schedule.day_of_week` usada por generate_availability_from_schedule.
  SELECT w.start_time, w.end_time, 'livre'::text
  FROM public.weekly_schedule w
  JOIN public.barbershops b ON b.id = w.barbershop_id
  WHERE w.barbershop_id = _barbershop_id
    AND w.barber_id     = _barber_id
    AND w.is_active
    AND w.day_of_week = EXTRACT(DOW FROM _date)
    AND b.status = 'approved'
    AND NOT public.barbershop_is_system_sentinel(b.id)
    -- Dia inteiro bloqueado: nenhuma janela.
    AND NOT EXISTS (
      SELECT 1 FROM public.schedule_blocks sb
      WHERE sb.barbershop_id = _barbershop_id
        AND sb.barber_id     = _barber_id
        AND sb.block_date    = _date
    )

  UNION ALL

  -- Exceções do dia lançadas na agenda (folga/ocupado). O consumidor usa estas
  -- para mascarar intervalos dentro dos turnos acima.
  SELECT a.start_time, a.end_time, a.status::text
  FROM public.availability a
  JOIN public.barbershops b ON b.id = a.barbershop_id
  WHERE a.barbershop_id = _barbershop_id
    AND a.barber_id     = _barber_id
    AND a.date          = _date
    AND a.status <> 'livre'
    AND b.status = 'approved'
    AND NOT public.barbershop_is_system_sentinel(b.id);
$$;

COMMENT ON FUNCTION public.get_public_availability_windows(uuid, uuid, date) IS
  'Janelas de atendimento de um profissional em uma data, para o fluxo público. '
  'Deriva de weekly_schedule (menos schedule_blocks) e soma as exceções '
  'não-livres de availability. Não depende de "Gerar Agenda". Só intervalos.';

REVOKE ALL ON FUNCTION public.get_public_availability_windows(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_availability_windows(uuid, uuid, date)
  TO anon, authenticated;
