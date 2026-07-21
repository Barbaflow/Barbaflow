-- ============================================================================
-- Alinha o schema ao que o frontend já assume:
--   (1) a vitrine pública não mostra a sentinela `_system`;
--   (2) `barbershops.plan_id` ganha um DEFAULT de verdade.
-- ----------------------------------------------------------------------------
-- PROBLEMA 1 — a view pública devolve a sentinela
--
-- `public.barbearias_publicas` filtra apenas `status = 'approved'`. A sentinela
-- `_system`, criada pelo bootstrap para ancorar o papel global `super_admin`,
-- nasce `approved` — então a view a devolve para `anon`. Confirmado contra o
-- projeto real: a vitrine retornava 1 linha, e essa linha era `_system`.
--
-- Hoje nada quebra porque `src/routes/barbearias.tsx` filtra no cliente
-- (`b.subdomain !== "_system"`), mas isso é maquiagem: a API expõe. Qualquer
-- consumidor novo da view — outra tela, um app, um script — herdaria o
-- problema. A regra passa a viver na view.
--
-- Consumidores auditados, nenhum depende da sentinela:
--   * routes/barbearias.tsx      — vitrine; já a excluía no cliente;
--   * components/ReviewsShowcase — busca por `id` de uma barbearia avaliada;
--   * components/NotificationBell— busca por `id` vindo de uma notificação.
-- As duas últimas consultam um id específico, e nem avaliações nem
-- notificações existem para a sentinela.
--
-- ----------------------------------------------------------------------------
-- PROBLEMA 2 — `plan_id` NOT NULL sem DEFAULT
--
-- A migration 20260721120000 tornou `plan_id` NOT NULL, mas quem preenche o
-- valor é o trigger `trg_enforce_barbershop_plan`. Para o Postgres — e para o
-- `supabase gen types`, que olha `column_default` — a coluna é obrigatória.
-- Resultado: `TablesInsert<"barbershops">` exige `plan_id`, mas o app NÃO PODE
-- enviá-lo (o trigger recusa com 42501 qualquer plano escolhido por payload de
-- usuário comum). O OnboardingWizard precisou de um cast para compilar.
--
-- O schema estava mentindo: existe sim um default, só que implementado como
-- trigger. Esta migration o torna um DEFAULT de coluna de verdade, e aí tipo,
-- schema e runtime passam a concordar.
--
-- O trigger CONTINUA — como defesa adicional, não como fonte do valor:
--   * DEFAULT preenche quando `plan_id` é omitido;
--   * o trigger ainda barra `plan_id` explícito != free de usuário comum,
--     ainda recusa plano inexistente, ainda recusa NULL explícito (que ignora
--     o DEFAULT) e ainda protege `plan_id`/`status` no UPDATE.
--
-- Idempotente. Posterior a 20260722120000. Nenhuma das 62 migrations
-- anteriores é alterada.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1) Plano padrão resolvido por identificador estável
-- ------------------------------------------------------------------
-- Um DEFAULT de coluna não aceita subconsulta, então precisa ser uma função.
--
--   * localiza o plano por NAME ('free'), não por UUID fixo — o id é gerado
--     por `gen_random_uuid()` e muda a cada projeto;
--   * `plans.name` é UNIQUE, então o resultado não depende de ordem de linhas
--     nem precisa de LIMIT/ORDER BY;
--   * sem argumentos: não há como o cliente pedir outro plano por parâmetro;
--   * falha com mensagem legível se o seed de planos não tiver rodado, em vez
--     de estourar como violação de NOT NULL.
--
-- SECURITY DEFINER de propósito: a expressão de DEFAULT é avaliada com os
-- privilégios de quem insere. Como INVOKER, o onboarding passaria a depender de
-- `authenticated` manter SELECT em `public.plans` — se um ajuste futuro de
-- grants revogasse isso, a criação de barbearia quebraria com um erro
-- desconexo. Como DEFINER a função é autocontida, e não vaza nada: o id do
-- plano free já é legível por qualquer um via `GRANT SELECT ON plans TO anon`.
CREATE OR REPLACE FUNCTION public.default_free_plan_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  SELECT p.id INTO _id
  FROM public.plans p
  WHERE p.name = 'free';

  IF _id IS NULL THEN
    RAISE EXCEPTION
      'Plano "free" não encontrado em public.plans — aplique o seed de planos antes de criar barbearias.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN _id;
END;
$$;

COMMENT ON FUNCTION public.default_free_plan_id() IS
  'DEFAULT de barbershops.plan_id: id do plano free, localizado por name (UNIQUE). Sem argumentos — o plano não pode ser escolhido por quem insere.';

-- Superfície mínima. Quem precisa de EXECUTE é apenas quem realmente insere
-- barbearias: a expressão de DEFAULT roda como o autor do INSERT.
--   * authenticated → onboarding (única origem de barbearias hoje);
--   * anon          → não insere barbearias (sem INSERT na tabela);
--   * service_role  → hoje só tem SELECT/UPDATE em barbershops; se um fluxo de
--                     backend passar a criar barbearias, precisará de dois
--                     grants: INSERT na tabela e EXECUTE aqui.
REVOKE ALL ON FUNCTION public.default_free_plan_id()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.default_free_plan_id() TO authenticated;

-- ------------------------------------------------------------------
-- 2) DEFAULT da coluna
-- ------------------------------------------------------------------
-- `plan_id` continua NOT NULL. O DEFAULT só age quando a coluna é OMITIDA;
-- um `plan_id: null` explícito (que o PostgREST envia se o cliente mandar) não
-- aciona DEFAULT nenhum e continua sendo resolvido pelo trigger.
ALTER TABLE public.barbershops
  ALTER COLUMN plan_id SET DEFAULT public.default_free_plan_id();

-- ------------------------------------------------------------------
-- 3) Vitrine pública sem a sentinela
-- ------------------------------------------------------------------
-- `CREATE OR REPLACE VIEW` mantém a view no lugar (não é DROP + CREATE), então
-- `security_invoker` e os grants sobrevivem. Ainda assim ambos são reafirmados
-- logo abaixo, para que o estado final não dependa desse detalhe.
--
-- O filtro usa `subdomain <> '_system'` em vez de
-- `public.barbershop_is_system_sentinel(id)`: aquela função é SECURITY DEFINER
-- e teve EXECUTE revogado de anon/authenticated em 20260721130000. Como a view
-- é `security_invoker`, suas expressões rodam como quem consulta — chamá-la
-- aqui quebraria a vitrine para `anon`. `subdomain` é UNIQUE, então o predicado
-- simples identifica a sentinela sem ambiguidade.
--
-- Colunas e ordem idênticas às de 20260428181403: o frontend não muda.
CREATE OR REPLACE VIEW public.barbearias_publicas AS
SELECT
  id,
  name,
  subdomain,
  logo_url,
  primary_color,
  secondary_color,
  rating_avg,
  rating_count,
  created_at,
  cep,
  state,
  city,
  neighborhood,
  street,
  number,
  complement
FROM public.barbershops
WHERE status = 'approved'::approval_status
  AND subdomain <> '_system';

ALTER VIEW public.barbearias_publicas SET (security_invoker = true);

COMMENT ON VIEW public.barbearias_publicas IS
  'Vitrine pública: barbearias aprovadas, exceto a sentinela _system (que existe só para ancorar o papel global super_admin). security_invoker: as policies de barbershops continuam valendo para quem consulta.';

-- Somente leitura, somente para os papéis que a consomem. service_role não
-- lê a vitrine (o backend usa public.barbershops diretamente).
GRANT SELECT ON TABLE public.barbearias_publicas TO anon, authenticated;
