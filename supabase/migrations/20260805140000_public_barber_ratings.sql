-- Nota pública por profissional — RPC agregadora (aditiva).
--
-- PROBLEMA
-- `PublicBookingWizard` mostra a nota de cada profissional no passo de escolha.
-- Para saber QUAL profissional cada avaliação atingiu, a tela fazia, no
-- navegador:
--
--     .from("reviews").select("rating, appointments!inner(barber_id)")
--
-- `reviews` não tem `barber_id` — só `appointment_id` (nullable, ON DELETE SET
-- NULL) —, então o vínculo com o profissional só existe passando por
-- `appointments`. E é aí que a consulta quebra, de três jeitos diferentes
-- conforme quem olha:
--
--   • VISITANTE ANÔNIMO — `anon` nunca teve SELECT em `appointments`
--     (20260721140000). A consulta devolve 42501 e a tela mostra
--     "Sem avaliações" para todo mundo;
--   • CLIENTE LOGADO — `authenticated` tem o GRANT, mas a policy de SELECT de
--     `appointments` só libera `client_id = auth.uid()` (fora staff e
--     super_admin). O `!inner` então descarta toda avaliação ligada ao
--     agendamento de OUTRA pessoa, e a média exibida é calculada apenas com as
--     avaliações que o próprio visitante escreveu. Não é um vazio honesto: é um
--     NÚMERO ERRADO apresentado como média pública;
--   • EQUIPE E SUPER_ADMIN — enxergam os agendamentos do tenant e veem o número
--     certo. Ou seja, o defeito é invisível para exatamente quem costuma testar.
--
-- Hoje o banco tem ZERO avaliações, então nada disso aparece na tela ainda. É um
-- defeito latente: nasce visível na primeira avaliação real.
--
-- POR QUE NÃO FOI PEGO ANTES
-- `src/mocks/relations.ts` declara a relação `reviews → appointments` e o mock
-- não modelava GRANT de tabela na leitura. No modo mock a consulta FUNCIONA e a
-- nota renderiza — o defeito só existia contra o Supabase real. A mesma
-- migration que traz esta RPC endurece o mock (ver o harness
-- `avaliacoes-publicas`), para que a próxima consulta impossível falhe offline.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE RPC, E NÃO `reviews.barber_id`
--
-- Denormalizar resolveria o acesso: com a coluna na própria `reviews`, que o
-- `anon` já lê, o embed sumiria. Foi descartado por dois motivos:
--
--   1. sincronização — a coluna precisaria de trigger ou de validação no
--      `WITH CHECK` da policy de INSERT, senão o cliente atribui a própria
--      avaliação ao profissional que quiser;
--   2. exposição — publicaria a atribuição de CADA avaliação individual a um
--      profissional. A tela precisa da média, não do detalhe. Esta RPC devolve
--      só o agregado, então vaza estritamente menos.
--
-- É o mesmo padrão de `get_public_products`, `get_public_barbers_v2`,
-- `get_public_availability_windows` e `get_public_busy_intervals`: o caminho
-- público não consulta a tabela — pergunta ao servidor.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE UMA FUNÇÃO NOVA, E NÃO MAIS COLUNAS EM `get_public_barbers_v2`
--
-- Devolver a nota junto com `user_id`/`is_owner` economizaria uma ida ao
-- servidor, mas mudar `RETURNS TABLE` exige `DROP` + `CREATE` — com janela de
-- recarga do cache do PostgREST. É exatamente o que 20260804120000 evitou ao
-- criar a `v2` ao lado da original em vez de recriá-la. Função separada mantém
-- esta migration estritamente aditiva.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O QUE A FUNÇÃO NÃO DEVOLVE, DE PROPÓSITO
--
--   • `comment` — o texto da avaliação. Quem quer ler os comentários usa
--     `reviews` direto, que `anon` já lê e cuja policy pública filtra por
--     barbearia aprovada;
--   • `client_id` — quem avaliou. Nome e avatar de terceiros só por
--     `get_public_profile_summaries` (20260722240000);
--   • qualquer coluna de `appointments` — data, horário, status, preço. A
--     função LÊ a tabela com privilégio de dono; o que ela DEVOLVE é só o
--     `barber_id` agregado.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.get_public_barber_ratings(uuid);
--   -- e reverter PublicBookingWizard para o embed anterior, ciente de que ele
--   -- nunca funcionou para visitante anônimo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_barber_ratings(_barbershop_id uuid)
RETURNS TABLE (
  barber_id    uuid,
  rating_avg   numeric,
  rating_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    a.barber_id,
    -- Uma casa decimal: é o que a tela exibe (`toFixed(1)`), e arredondar aqui
    -- evita que servidor e navegador divirjam na última casa.
    round(avg(r.rating)::numeric, 1) AS rating_avg,
    count(*)::integer                AS rating_count
  FROM public.reviews r
  JOIN public.appointments a ON a.id = r.appointment_id
  WHERE r.barbershop_id = _barbershop_id
    -- Parâmetro nulo devolve conjunto vazio, nunca a base inteira. Mesmo
    -- cuidado de `get_public_products` e `get_public_barbers_v2`.
    AND _barbershop_id IS NOT NULL
    -- A MESMA fronteira das demais superfícies públicas: barbearia aprovada e
    -- não-sentinela. Sem isto, a nota de uma barbearia `pending` — que não
    -- aparece em lugar nenhum do site — sairia por aqui.
    AND public.barbershop_is_public(_barbershop_id)
    -- Avaliação cujo agendamento foi apagado tem `appointment_id` nulo
    -- (ON DELETE SET NULL) e simplesmente não entra: não há como saber a quem
    -- ela se referia. O JOIN já a descarta; a condição abaixo cobre o caso de
    -- um agendamento sem profissional atribuído.
    AND a.barber_id IS NOT NULL
    -- Defesa contra dado inconsistente: a avaliação e o agendamento têm de ser
    -- da MESMA barbearia. Sem isto, um `appointment_id` apontando para outro
    -- tenant somaria a nota na barbearia errada.
    AND a.barbershop_id = r.barbershop_id
  GROUP BY a.barber_id;
$$;

COMMENT ON FUNCTION public.get_public_barber_ratings(uuid) IS
  'Nota média e quantidade de avaliações POR PROFISSIONAL de uma barbearia '
  'aprovada e não-sentinela. Existe porque reviews não tem barber_id: o vínculo '
  'passa por appointments, que anon não lê e que a RLS restringe ao próprio '
  'cliente — o cálculo no navegador dava 42501 para o visitante e uma média '
  'errada (só as avaliações dele) para o cliente logado. Devolve apenas o '
  'agregado: nem comment, nem client_id, nem coluna de appointments.';

-- Como as demais funções do caminho público: ninguém por padrão, e EXECUTE
-- nominal para os dois papéis que a chamam.
REVOKE ALL ON FUNCTION public.get_public_barber_ratings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_barber_ratings(uuid) TO anon, authenticated;
