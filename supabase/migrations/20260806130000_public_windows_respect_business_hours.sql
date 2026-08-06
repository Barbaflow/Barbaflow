-- O expediente da barbearia passa a filtrar a leitura pública das janelas.
--
-- PASSO 1 DE 2. Este arquivo é INÓCUO enquanto a regra antiga valer, e é
-- exatamente por isso que ele vai sozinho para produção primeiro.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ESTÁ ERRADO HOJE, E POR QUE NINGUÉM VIU
--
-- `get_public_availability_windows` deriva as janelas de `weekly_schedule` e
-- NUNCA consultou `business_hours`. `generate_availability_from_schedule`
-- também não. A coerência entre "a barbearia diz que fecha sexta" e "o
-- assistente público oferece sexta" nunca foi garantida por filtro de leitura:
-- ela vinha de um INVARIANTE DE ESCRITA mantido por dois triggers —
-- `enforce_business_hours_fit_shifts` (recusa fechar um dia que tenha turno
-- ativo) e `enforce_shift_within_business_hours` (recusa turno ativo fora do
-- envelope). Turno ativo ⊆ envelope, sempre. Logo, ler a grade dava o mesmo
-- resultado que ler a grade ∩ expediente.
--
-- Medido no remoto em 06/08/2026, em transação abortada: suprimindo o trigger
-- de conflito e marcando sábado como fechado em `barbearia-demo-cliente`,
-- `get_public_business_hours` passou a dizer FECHADO e
-- `get_public_availability_windows` continuou devolvendo 1 janela para o
-- sábado seguinte. A mesma página se contradiz.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE ESTE PASSO É SEGURO SOZINHO
--
-- Recortar uma janela pela interseção com o expediente é NO-OP enquanto o
-- invariante vale: se o turno já está inteiramente dentro do envelope,
-- `GREATEST(início, abertura) = início` e `LEAST(fim, fechamento) = fim`. Ou
-- seja, esta migration não muda nenhum resultado hoje — ela só passa a
-- sustentar sozinha uma garantia que hoje depende dos triggers.
--
-- Só depois que ela estiver EM USO REAL é que o passo 2 (20260806140000) pode
-- relaxar `enforce_business_hours_fit_shifts`. Aplicar os dois juntos abriria
-- exatamente a janela de incoerência descrita acima. É o padrão da §2.1 do
-- CLAUDE.md, e a razão de os dois estarem em PRs separados e empilhados.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DECISÕES QUE ESTÃO NO SQL
--
--   • DIA FECHADO → NENHUMA JANELA. `NOT COALESCE(bh.is_closed, false)`.
--   • REDUÇÃO PARCIAL → RECORTA, não descarta. Turno 09–18 com expediente
--     09–12 vira janela 09–12. Descartar o turno inteiro puniria o
--     profissional por uma decisão administrativa.
--   • JANELA QUE ZERA SAI. Turno 14–18 com expediente 09–12 não vira janela de
--     duração zero nem negativa: o `<` final a elimina.
--   • LINHA AUSENTE = SEM RESTRIÇÃO. `LEFT JOIN` + `COALESCE` para o próprio
--     horário do turno. Preserva o comportamento de TODAS as barbearias de
--     hoje: só 1 das 5 tem expediente cadastrado, e dia não configurado nunca
--     pode significar "fechado" (é a mesma distinção que
--     `get_public_business_hours` já faz).
--
-- O SEGUNDO RAMO (exceções) NÃO É RECORTADO, DE PROPÓSITO
--
-- Ele devolve `availability` com `status <> 'livre'` — folga e ocupado —, que o
-- consumidor usa para MASCARAR intervalos dentro das janelas. Recortar uma
-- máscara pelo expediente a encurtaria, e encurtar máscara DESMASCARA horário:
-- o efeito seria o oposto do pretendido. Como um dia fechado já não produz
-- janela nenhuma no primeiro ramo, máscara sobrando é inofensiva.
--
-- NOTA SOBRE `generate_availability_from_schedule`: não é tocada aqui e não
-- precisa ser para fechar o vazamento público. As linhas que ela materializa
-- nascem com status `livre`, e o segundo ramo desta RPC filtra
-- `status <> 'livre'` — ou seja, o público NUNCA vê o que ela gera. Elas
-- alimentam só a agenda interna (`ScheduleManager`). Alinhá-la ao expediente é
-- higiene da tela interna, não correção de vazamento, e fica fora deste PR.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • hoje, com o invariante de pé, NENHUMA barbearia muda de resultado:
--     comparar a contagem de janelas por (barbearia, barbeiro, data) antes e
--     depois deve dar igual;
--   • em transação abortada: marcar um dia como fechado (suprimindo o trigger)
--     e conferir que a RPC passa a devolver zero janelas naquele dia;
--   • turno 09–18 com expediente 09–12 devolve 09–12;
--   • barbearia sem linha em `business_hours` devolve exatamente o que devolvia.
--
-- ROLLBACK
--   -- restaura a versão sem o LEFT JOIN, que está em 20260722210000.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_availability_windows(
  _barbershop_id uuid,
  _barber_id     uuid,
  _date          date
)
RETURNS TABLE (
  start_time time without time zone,
  end_time   time without time zone,
  status     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Base: turnos ativos do profissional naquele dia da semana, RECORTADOS pelo
  -- expediente da barbearia. `EXTRACT(DOW …)` devolve 0=domingo, a mesma
  -- convenção de `weekly_schedule.day_of_week`.
  SELECT
    GREATEST(w.start_time, COALESCE(bh.open_time,  w.start_time)) AS start_time,
    LEAST   (w.end_time,   COALESCE(bh.close_time, w.end_time))   AS end_time,
    'livre'::text
  FROM public.weekly_schedule w
  JOIN public.barbershops b ON b.id = w.barbershop_id
  -- LEFT: dia sem expediente cadastrado segue sem restrição.
  LEFT JOIN public.business_hours bh
         ON bh.barbershop_id = w.barbershop_id
        AND bh.day_of_week   = w.day_of_week
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
    -- Barbearia fechada neste dia da semana: nenhuma janela.
    AND NOT COALESCE(bh.is_closed, false)
    -- Sobra alguma coisa depois do recorte? Turno inteiramente fora do
    -- expediente zera aqui em vez de virar janela vazia ou invertida.
    AND GREATEST(w.start_time, COALESCE(bh.open_time,  w.start_time))
      < LEAST   (w.end_time,   COALESCE(bh.close_time, w.end_time))

  UNION ALL

  -- Exceções do dia lançadas na agenda (folga/ocupado). NÃO são recortadas —
  -- ver o cabeçalho: encurtar máscara desmascara horário.
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
  'Janelas públicas de um profissional numa data: turnos ativos RECORTADOS pelo '
  'expediente da barbearia (20260806130000), menos os dias bloqueados, mais as '
  'exceções não-livres da agenda. Dia fechado devolve nada; dia sem linha em '
  '`business_hours` segue sem restrição. Antes disso a coerência com o '
  'expediente dependia só do invariante mantido pelos triggers de escrita.';
