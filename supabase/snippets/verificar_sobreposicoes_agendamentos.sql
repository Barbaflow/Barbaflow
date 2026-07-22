-- ============================================================================
-- VERIFICAÇÃO REMOTA — somente leitura.  NÃO altera e NÃO apaga nada.
--
-- Rode no SQL Editor do Supabase ANTES de aplicar a migration
-- 20260722180000_prevent_overlapping_appointments.
--
-- A migration cria a constraint:
--
--   ALTER TABLE public.appointments
--     ADD CONSTRAINT appointments_no_overlap_per_barber
--     EXCLUDE USING gist (
--       barber_id WITH =,
--       tsrange(date + start_time, date + end_time, '[)') WITH &&
--     ) WHERE (status <> 'cancelled');
--
-- Se já existir QUALQUER par de atendimentos não cancelados sobrepostos para o
-- mesmo profissional, a criação da constraint falha. As consultas abaixo
-- reproduzem exatamente o mesmo predicado — mesmo intervalo semiaberto '[)',
-- mesmo recorte de status — para você ver o que precisa ser resolvido antes.
--
-- Intervalo '[)': um atendimento que termina 10:00 NÃO conflita com outro que
-- começa 10:00. Só sobreposição real conta.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) DETALHE — um registro por PAR conflitante
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  a.barbershop_id,
  b_shop.name                              AS barbearia,
  a.barber_id,
  a.date,
  a.id                                     AS agendamento_a,
  a.start_time                             AS inicio_a,
  a.end_time                               AS fim_a,
  a.status                                 AS status_a,
  b.id                                     AS agendamento_b,
  b.start_time                             AS inicio_b,
  b.end_time                               AS fim_b,
  b.status                                 AS status_b,
  -- Quanto os dois de fato se sobrepõem, para priorizar a correção.
  (LEAST(a.date + a.end_time, b.date + b.end_time)
   - GREATEST(a.date + a.start_time, b.date + b.start_time)) AS sobreposicao
FROM public.appointments a
JOIN public.appointments b
  ON  a.barber_id = b.barber_id
  -- `a.id < b.id` lista cada par UMA vez (evita A×B e B×A).
  AND a.id < b.id
  AND a.status <> 'cancelled'
  AND b.status <> 'cancelled'
  AND tsrange(a.date + a.start_time, a.date + a.end_time, '[)')
   && tsrange(b.date + b.start_time, b.date + b.end_time, '[)')
LEFT JOIN public.barbershops b_shop ON b_shop.id = a.barbershop_id
ORDER BY a.barbershop_id, a.barber_id, a.date, a.start_time;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) RESUMO — o número que decide se dá para aplicar a migration
--    Tudo zero  →  a constraint pode ser criada sem tocar em dado nenhum.
-- ─────────────────────────────────────────────────────────────────────────────
WITH pares AS (
  SELECT a.barbershop_id, a.barber_id
  FROM public.appointments a
  JOIN public.appointments b
    ON  a.barber_id = b.barber_id
    AND a.id < b.id
    AND a.status <> 'cancelled'
    AND b.status <> 'cancelled'
    AND tsrange(a.date + a.start_time, a.date + a.end_time, '[)')
     && tsrange(b.date + b.start_time, b.date + b.end_time, '[)')
)
SELECT
  count(*)                        AS pares_conflitantes,
  count(DISTINCT barber_id)       AS profissionais_afetados,
  count(DISTINCT barbershop_id)   AS barbearias_afetadas
FROM pares;
