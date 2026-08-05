-- Superfície pública de `barbershops` — FASE 2a (aditiva, preparatória).
--
-- POR QUE ESTE ARQUIVO EXISTE, SE O RODAPÉ DA FASE 1 DIZIA "só o REVOKE"
--
-- Dizia, e estava errado. A varredura feita antes de versionar a fase 2 achou
-- uma dependência que o rodapé não considerou, e que teria derrubado o site
-- público inteiro no instante do `REVOKE`.
--
-- **Expressões de policy rodam com os privilégios de quem consulta.** Não é
-- descoberta nova neste repositório: é exatamente o que `20260721140000` já
-- registra, e o motivo de `anon` ter recebido `EXECUTE` em `has_role` — sem
-- isso "a página pública quebra". O que ninguém tinha reparado é que a mesma
-- regra vale para TABELAS, não só para funções.
--
-- Três policies de SELECT alcançáveis por `anon` carregam, hoje, uma
-- subconsulta LITERAL em `public.barbershops`:
--
--   services      (20260722170000) EXISTS (SELECT 1 FROM public.barbershops b …)
--   availability  (20260722170000) EXISTS (SELECT 1 FROM public.barbershops b …)
--   reviews       (20260420115631) EXISTS (SELECT 1 FROM public.barbershops b …)
--
-- Com `REVOKE SELECT ON public.barbershops FROM anon`, a avaliação dessas três
-- policies passa a exigir um privilégio que o visitante não tem mais. O
-- resultado NÃO é "lista vazia": é `42501 permission denied for table
-- barbershops` em toda leitura anônima de serviços, horários e avaliações — ou
-- seja, `/agendar/$slug`, o assistente de agendamento e a vitrine de
-- avaliações param de carregar. O caminho migrado na fase 1 (a view e a RPC)
-- continuaria de pé, e a página quebraria assim mesmo, por baixo dele.
--
-- `products` não entra na lista porque a fase 2 do catálogo (20260730120000) já
-- removeu a policy pública dele e revogou o SELECT do `anon`: as leituras
-- passam por `get_public_products`, que é SECURITY DEFINER.
--
-- Esta migration remove a dependência SEM tirar acesso de ninguém. Ela é
-- estritamente aditiva e pode ser aplicada isolada, com o `anon` ainda tendo
-- SELECT na tabela: as policies passam a chamar uma função SECURITY DEFINER que
-- responde à MESMA pergunta, com o MESMO resultado. Só depois dela o REVOKE da
-- fase 2 (20260805130000) é seguro.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A FUNÇÃO FILTRA `_system`, SE AS POLICIES DE HOJE NÃO FILTRAM
--
-- Este é o ponto que, invertido, teria AMPLIADO o acesso em vez de restringir.
--
-- Hoje a subconsulta roda como `anon`, então a RLS de `barbershops` também se
-- aplica DENTRO dela: a policy "Anyone can view approved barbershops"
-- (20260722170000) libera `status = 'approved' AND subdomain <> '_system'`. O
-- que o visitante anônimo enxerga hoje, na prática, já exclui a sentinela —
-- mesmo que o texto da policy de `services` não mencione `_system`.
--
-- Numa função SECURITY DEFINER cujo dono é `postgres` (BYPASSRLS), essa
-- retaguarda some. Copiar o texto literal das policies teria tornado públicos
-- os serviços, horários e avaliações da sentinela. O predicado abaixo preserva
-- o comportamento EFETIVO de hoje, não o texto — é a mesma lição do
-- `security_invoker = false` da fase 1: quando a RLS deixa de ser a segunda
-- barreira, o `WHERE` precisa absorver o que ela fazia.
--
-- Para `authenticated` nada muda: a equipe da própria barbearia continua
-- entrando por `viewer_is_barbershop_staff` e o super_admin por `has_role`,
-- ramos que esta migration não toca.
--
-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÕES OBRIGATÓRIAS APÓS APLICAR (antes de aplicar a fase 2)
--
--   • como anon, com o SELECT em barbershops AINDA concedido: `/agendar/$slug`,
--     `/barbearias` e o assistente de agendamento continuam carregando serviços,
--     horários e avaliações — esta fase não pode mudar nada visível;
--   • como anon: serviço/horário/avaliação de barbearia `pending` continua fora;
--   • como anon: a sentinela `_system` continua sem devolver nada em services,
--     availability e reviews;
--   • como equipe de barbearia `pending`: o próprio catálogo e a própria agenda
--     continuam visíveis (ramo `viewer_is_barbershop_staff`, intocado);
--   • como super_admin: continua enxergando tudo;
--   • `SELECT polname, pg_get_expr(polqual, polrelid) FROM pg_policy` nas três
--     tabelas não pode mais conter `FROM barbershops`.
--
-- ROLLBACK (devolve o texto literal anterior das três policies)
--
--   ALTER POLICY "Anyone can view services of approved barbershops"
--     ON public.services
--     USING (
--       EXISTS (SELECT 1 FROM public.barbershops b
--                WHERE b.id = barbershop_id
--                  AND b.status = 'approved'::public.approval_status)
--       OR public.viewer_is_barbershop_staff(barbershop_id)
--       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
--     );
--   ALTER POLICY "Anyone can view availability of approved barbershops"
--     ON public.availability
--     USING (
--       EXISTS (SELECT 1 FROM public.barbershops b
--                WHERE b.id = barbershop_id
--                  AND b.status = 'approved'::public.approval_status)
--       OR public.viewer_is_barbershop_staff(barbershop_id)
--       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
--     );
--   ALTER POLICY "Anyone can view reviews of approved barbershops"
--     ON public.reviews
--     USING (
--       EXISTS (SELECT 1 FROM public.barbershops b
--                WHERE b.id = reviews.barbershop_id AND b.status = 'approved')
--     );
--   DROP FUNCTION IF EXISTS public.barbershop_is_public(uuid);
--
-- O rollback só é seguro ENQUANTO o `anon` ainda tiver SELECT em `barbershops`.
-- Depois da fase 2, reverter esta migration sozinha quebra a página pública —
-- a ordem de reversão é fase 2 primeiro, depois esta.
-- ============================================================================

/* ═══════════ 1. a pergunta, respondida do lado do servidor ════════════════ */

CREATE OR REPLACE FUNCTION public.barbershop_is_public(_barbershop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.barbershops b
    WHERE b.id = _barbershop_id
      AND b.status = 'approved'::approval_status
      -- Ver o cabeçalho: hoje quem exclui a sentinela é a RLS de `barbershops`,
      -- que deixa de valer dentro de uma função SECURITY DEFINER.
      AND b.subdomain <> '_system'::text
  );
$$;

COMMENT ON FUNCTION public.barbershop_is_public(uuid) IS
  'Barbearia aprovada e não-sentinela? Existe para que as policies públicas de '
  'services, availability e reviews parem de consultar public.barbershops '
  'diretamente: expressão de policy roda com os privilégios de quem consulta, e '
  'sem esta indireção o REVOKE do anon (fase 2) derrubaria toda a leitura '
  'pública dessas três tabelas com 42501. SECURITY DEFINER de propósito — o '
  'predicado aqui absorve o filtro que a RLS de barbershops fazia.';

-- Como `has_role`: a expressão da policy é avaliada como o visitante, então o
-- visitante precisa poder EXECUTAR a função.
REVOKE ALL ON FUNCTION public.barbershop_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.barbershop_is_public(uuid) TO anon, authenticated;

/* ═══════════ 2. as três policies passam a usar a função ═══════════════════ */

-- `ALTER POLICY` troca a expressão NO LUGAR, dentro da transação da migration:
-- não há o intervalo entre `DROP POLICY` e `CREATE POLICY` em que a tabela
-- ficaria sem via pública de leitura.
--
-- Os demais ramos (`viewer_is_barbershop_staff`, `has_role`) são reescritos
-- idênticos ao que está no banco hoje (20260722170000) — o único ramo que muda
-- é o público.

ALTER POLICY "Anyone can view services of approved barbershops"
  ON public.services
  USING (
    public.barbershop_is_public(barbershop_id)
    OR public.viewer_is_barbershop_staff(barbershop_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

ALTER POLICY "Anyone can view availability of approved barbershops"
  ON public.availability
  USING (
    public.barbershop_is_public(barbershop_id)
    OR public.viewer_is_barbershop_staff(barbershop_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- A de `reviews` (20260420115631) só tem o ramo público — nada a preservar
-- além dele.
ALTER POLICY "Anyone can view reviews of approved barbershops"
  ON public.reviews
  USING (public.barbershop_is_public(barbershop_id));

COMMENT ON POLICY "Anyone can view services of approved barbershops" ON public.services IS
  'Leitura pública do catálogo de barbearias aprovadas; a equipe e o proprietário leem o catálogo da PRÓPRIA barbearia em qualquer status. O ramo público passa por barbershop_is_public() para não depender de SELECT em barbershops (fase 2a, 20260805120000).';

COMMENT ON POLICY "Anyone can view availability of approved barbershops" ON public.availability IS
  'Leitura pública da agenda de barbearias aprovadas; a equipe e o proprietário leem a própria agenda em qualquer status. O ramo público passa por barbershop_is_public() para não depender de SELECT em barbershops (fase 2a, 20260805120000).';

COMMENT ON POLICY "Anyone can view reviews of approved barbershops" ON public.reviews IS
  'Leitura pública das avaliações de barbearias aprovadas, via barbershop_is_public() — sem subconsulta em barbershops, que a fase 2 revoga do anon (fase 2a, 20260805120000).';
