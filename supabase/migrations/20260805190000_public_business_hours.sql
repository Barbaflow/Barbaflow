-- Horário de funcionamento na página pública (PR 3 de 3, aditiva).
--
-- Fecha a frente: o expediente existe (20260805170000), tem tela de admin
-- (20260805180000) e agora aparece para quem vai agendar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE RPC, E NÃO GRANT NA TABELA NEM COLUNA NA VITRINE
--
-- `business_hours` NÃO tem — e não deve ter — grant para `anon`. Conferido
-- antes de escrever: `has_table_privilege('anon','public.business_hours',
-- 'SELECT')` = false. É assim desde que nasceu, porque 20260805150000 fez
-- tabela nova não herdar acesso.
--
-- Duas alternativas foram descartadas:
--
--   • conceder SELECT ao `anon` — repetiria o erro que a frente de
--     `barbershops` levou duas fases para desfazer: tabela aberta ao público
--     com a RLS como única fronteira. Aqui não há nem policy pública, e criar
--     uma seria trabalho para chegar a um resultado pior;
--   • ampliar `barbearias_publicas` com um `jsonb_agg` dos sete dias — a view
--     é uma linha por barbearia, e engordaria a listagem de `/barbearias`, que
--     não precisa de expediente. Também quebraria a invariante "24 colunas"
--     que a suíte superficie-barbershops trava.
--
-- Esta RPC é o mesmo padrão de `get_public_products`, `get_public_barbers_v2`
-- e `get_public_barber_ratings`: SECURITY DEFINER, `STABLE`, `search_path`
-- fixo, fronteira em `barbershop_is_public`, EXECUTE nominal.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE ELA DEVOLVE, E O QUE O CONSUMIDOR PRECISA SABER
--
-- Uma linha por dia CONFIGURADO — nunca sete linhas fixas. A distinção que a
-- tela precisa manter é a mesma do modelo:
--
--   • dia AUSENTE do resultado = sem restrição cadastrada. Não é "fechado", e
--     não deve virar "Fechado" na tela;
--   • `is_closed = true` = fechado de verdade, e aí `open_time`/`close_time`
--     vêm nulos.
--
-- Barbearia sem NENHUM dia configurado devolve conjunto vazio, e a página não
-- mostra seção alguma — que é exatamente o comportamento de hoje, antes desta
-- frente existir. Nenhuma barbearia passa a exibir informação que não tinha.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • `has_table_privilege('anon','public.business_hours','SELECT')` => false
--     (a RPC não muda isso, e não pode);
--   • como anon: a RPC responde 200 para barbearia aprovada;
--   • como anon: devolve [] para pending, rejected, `_system`, id inexistente
--     e id nulo;
--   • como anon: um dia com `is_closed` vem com open/close nulos;
--   • `/agendar/$slug` mostra a seção quando há dias configurados, e não mostra
--     nada quando não há.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.get_public_business_hours(uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_business_hours(_barbershop_id uuid)
RETURNS TABLE (
  day_of_week smallint,
  open_time   time,
  close_time  time,
  is_closed   boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT bh.day_of_week, bh.open_time, bh.close_time, bh.is_closed
  FROM public.business_hours bh
  WHERE bh.barbershop_id = _barbershop_id
    -- Parâmetro nulo devolve vazio, nunca a tabela inteira. Mesmo cuidado das
    -- demais RPCs públicas desta base.
    AND _barbershop_id IS NOT NULL
    -- A MESMA fronteira de get_public_barber_ratings e das policies públicas
    -- de services/availability/reviews: aprovada e não-sentinela.
    AND public.barbershop_is_public(_barbershop_id)
  ORDER BY bh.day_of_week;
$$;

COMMENT ON FUNCTION public.get_public_business_hours(uuid) IS
  'Expediente de uma barbearia aprovada e não-sentinela, para a página pública '
  'de agendamento. Uma linha por dia CONFIGURADO — dia ausente do resultado '
  'significa "sem restrição cadastrada", NÃO "fechado"; fechado é is_closed = '
  'true, com open/close nulos. Existe para que business_hours siga sem grant '
  'algum para anon.';

REVOKE ALL ON FUNCTION public.get_public_business_hours(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_business_hours(uuid) TO anon, authenticated;
