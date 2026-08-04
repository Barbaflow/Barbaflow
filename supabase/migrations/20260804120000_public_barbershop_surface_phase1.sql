-- Superfície pública de `barbershops` — FASE 1 (aditiva, retrocompatível).
--
-- PROBLEMA
-- `barbershops` tem `GRANT SELECT ... TO anon` (20260721140000) e a policy
-- "Anyone can view approved barbershops" filtra corretamente as LINHAS —
-- barbearia `pending`/`rejected` e a sentinela `_system` não saem. Isso foi
-- verificado ao vivo contra o projeto remoto, com a chave anônima:
--
--     GET /rest/v1/barbershops?status=eq.pending    -> 200  []
--     GET /rest/v1/barbershops?status=eq.rejected   -> 200  []
--     GET /rest/v1/barbershops?subdomain=eq._system -> 200  []
--
-- O problema é outro, e é o mesmo de `products` antes de 20260727120000:
-- **RLS filtra linhas, não colunas.** Para a linha que o visitante PODE ver,
-- ele vê a linha INTEIRA — 36 colunas. Existe uma vitrine estreita e correta ao
-- lado (`barbearias_publicas`, 16 colunas), mas ela é convenção, não fronteira:
-- basta trocar `/rest/v1/barbearias_publicas` por `/rest/v1/barbershops` para
-- receber, hoje, em produção:
--
--     owner_id, plan_id, status, appointments_this_month, updated_at,
--     whatsapp_message, pdf_template, pdf_slogan, qr_size,
--     receipt_title, receipt_subtitle, receipt_footer,
--     receipt_thank_you_message, receipt_whatsapp_intro
--
-- Nenhuma dessas colunas é PII direta (a tabela não tem e-mail nem telefone), e
-- `owner_id` não pivota para PII: `anon` não tem SELECT em `profiles`
-- (confirmado por `has_table_privilege`). São dados operacionais e de
-- configuração interna que simplesmente não têm por que ser públicos.
--
-- POR QUE ESTA MIGRATION NÃO FECHA O ACESSO
-- Mesma razão da fase 1 do catálogo de produtos: fechar o acesso e publicar o
-- frontend novo não acontecem no mesmo instante. Em qualquer ordem, uma
-- migration única quebraria algo — e aqui o risco é maior que em `products`,
-- porque são CINCO pontos de leitura anônima, dois deles no fluxo de
-- agendamento público. Esta fase é estritamente ADITIVA: só cria e amplia.
--
-- O `REVOKE` fica para a FASE 2, descrita no rodapé e deliberadamente NÃO
-- versionada ainda.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE A VIEW PRECISA DEIXAR DE SER `security_invoker`
--
-- Este é o ponto que faria a fase 2 falhar em silêncio, e por isso ele está
-- resolvido AQUI, na fase aditiva.
--
-- `barbearias_publicas` foi criada com `security_invoker = true`
-- (20260428181420). Com isso a leitura da tabela por baixo roda como QUEM
-- CONSULTA — ou seja, a view depende do mesmo `GRANT SELECT ON barbershops TO
-- anon` que a fase 2 vai revogar. Aplicar a fase 2 sem esta mudança derrubaria
-- a vitrine pública junto com a exposição.
--
-- `get_public_products` não tem esse problema porque é SECURITY DEFINER com
-- dono `postgres`. A mesma saída existe aqui, e foi verificada:
--
--     SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'postgres';
--     -> postgres | true
--     SELECT pg_get_userbyid(relowner) FROM pg_class
--      WHERE oid = 'public.barbearias_publicas'::regclass;
--     -> postgres
--
-- CONSEQUÊNCIA, EXPLÍCITA: com `security_invoker = false` a view passa a ler a
-- tabela com os privilégios do dono, que tem BYPASSRLS. **O `WHERE` desta view
-- vira a fronteira de segurança inteira** — a RLS deixa de ser a segunda
-- barreira. É o mesmo modelo do catálogo de produtos, e é por isso que as
-- verificações do rodapé incluem, obrigatoriamente, provar que `pending`,
-- `rejected` e `_system` continuam fora PELA VIEW.
--
-- NOTA PARA QUEM RODAR `npm run db:lint:remote`: o linter do Supabase passa a
-- apontar `security_definer_view` para `barbearias_publicas`. Isso é
-- INTENCIONAL e é o que faz a fase 2 funcionar. Não "corrija" voltando para
-- `security_invoker = true` — isso reintroduz a dependência do grant do anon.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE `is_owner` EM RPC, E NÃO `owner_id` NA VIEW
--
-- `PublicBookingWizard` precisa saber qual dos profissionais é o proprietário,
-- para ordená-lo primeiro e exibir o selo "Proprietário". Hoje ele compara
-- `barbershop.owner_id === barbeiro.user_id` no navegador, e é só para isso que
-- `owner_id` é lido no caminho público.
--
-- Levar `owner_id` para a view resolveria o acesso, mas apenas MOVERIA o dado
-- para um lugar igualmente público. Como a RPC que lista os barbeiros já é
-- SECURITY DEFINER e já faz `JOIN barbershops`, o dado necessário para decidir
-- já está do lado do servidor: basta devolver o booleano em vez do UUID.
-- Exposição vai a zero em vez de mudar de lugar.
--
-- A função existente NÃO é alterada: `CREATE OR REPLACE FUNCTION` não muda
-- `RETURNS TABLE`, e recriá-la exigiria DROP + CREATE + novo GRANT, com janela
-- de recarga do cache do PostgREST e impacto num segundo consumidor
-- (`NewComandaDialog`, tela interna). Criar `get_public_barbers_v2` ao lado
-- mantém esta fase estritamente aditiva. A antiga sai de cena numa fase futura,
-- depois que ninguém mais a chamar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE `branding_enabled` DERIVADO, E NÃO `plan_id`
--
-- `plan_id` nunca é usado como identificador no caminho público: em dois
-- lugares (`TenantThemeApplier` e `agendar/$slug`) ele serve só para buscar
-- `plans.name` e decidir a MESMA coisa — `name IN ('pro','enterprise')`.
--
-- A view devolve a decisão pronta. Ganhos: o id do plano deixa de ser público,
-- some uma consulta a `plans` em cada um dos dois pontos, e o caminho público
-- deixa de depender de `plans` (que hoje também é legível por `anon`).
--
-- O nome diz a CAPACIDADE, não o plano comercial: `plan_tier` publicaria o
-- nível contratado de cada barbearia, o que é informação de negócio sem
-- necessidade de ser pública. Se outra funcionalidade pública precisar de gate
-- por plano, entra outro booleano.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ROLLBACK CONCEITUAL desta fase (seguro: nada aqui é destrutivo)
--
--   -- 1. volta a view para as 16 colunas originais e para security_invoker:
--   CREATE OR REPLACE VIEW public.barbearias_publicas AS
--     SELECT id, name, subdomain, logo_url, primary_color, secondary_color,
--            rating_avg, rating_count, created_at, cep, state, city,
--            neighborhood, street, number, complement
--       FROM public.barbershops
--      WHERE status = 'approved'::approval_status AND subdomain <> '_system';
--   -- (CREATE OR REPLACE não REMOVE colunas: para reverter de fato é preciso
--   --  DROP VIEW + CREATE VIEW + GRANT SELECT TO anon, authenticated.)
--   ALTER VIEW public.barbearias_publicas SET (security_invoker = true);
--
--   -- 2. remove a RPC nova (a antiga nunca foi tocada):
--   DROP FUNCTION IF EXISTS public.get_public_barbers_v2(uuid);
--
-- Nenhum dado é migrado nem destruído: a mudança é só de acesso, e só adiciona.
-- ============================================================================

/* ═══════════ 1. vitrine pública ampliada: 16 → 24 colunas ═════════════════ */

-- `CREATE OR REPLACE VIEW` só aceita ACRESCENTAR colunas ao FIM da lista, com
-- as anteriores mantidas em nome, tipo e ordem. As 16 primeiras estão idênticas
-- às de 20260722130000 de propósito — quem já consome a view não muda.
--
-- As 8 novas são exatamente o que os pontos de leitura anônima buscam hoje na
-- tabela larga, e nada além disso:
--
--   status                 — CONSTANTE 'approved' nesta view. Existe para que
--                            `.eq("status","approved")` continue válido nos
--                            call sites (defesa em profundidade e menos churn),
--                            não porque a view possa devolver outro valor;
--   reschedule_min_hours   — /barbearias, PublicBookingWizard, /agendar/$slug;
--   cancel_min_hours       — idem;
--   noshow_policy_enabled  — /barbearias e /agendar/$slug (aviso de falta);
--   noshow_max_count       — idem;
--   noshow_block_days      — idem;
--   timezone               — use-barbershop sincroniza o fuso ativo do tenant;
--   branding_enabled       — derivada, substitui `plan_id` (ver cabeçalho).
--
-- CONTINUAM FORA, e é este o ganho da migration (13 colunas):
--   owner_id, plan_id, appointments_this_month, updated_at, whatsapp_message,
--   pdf_template, pdf_slogan, qr_size, receipt_title, receipt_subtitle,
--   receipt_footer, receipt_thank_you_message, receipt_whatsapp_intro.
CREATE OR REPLACE VIEW public.barbearias_publicas AS
SELECT
  b.id,
  b.name,
  b.subdomain,
  b.logo_url,
  b.primary_color,
  b.secondary_color,
  b.rating_avg,
  b.rating_count,
  b.created_at,
  b.cep,
  b.state,
  b.city,
  b.neighborhood,
  b.street,
  b.number,
  b.complement,
  -- ── colunas novas, sempre ao fim ──
  b.status,
  b.reschedule_min_hours,
  b.cancel_min_hours,
  b.noshow_policy_enabled,
  b.noshow_max_count,
  b.noshow_block_days,
  b.timezone,
  -- Decisão pronta em vez do id do plano. `EXISTS` devolve boolean não-nulo
  -- mesmo quando `plan_id` é NULL (barbearia sem plano gravado = sem branding),
  -- então o consumidor nunca precisa tratar `null` aqui.
  EXISTS (
    SELECT 1
    FROM public.plans p
    WHERE p.id = b.plan_id
      AND p.name IN ('pro', 'enterprise')
  ) AS branding_enabled
FROM public.barbershops b
-- As duas condições que definem a vitrine. Com `security_invoker = false`
-- (abaixo) elas passam a ser a fronteira inteira — qualquer alteração aqui é
-- alteração de superfície pública, não de apresentação.
WHERE b.status = 'approved'::approval_status
  AND b.subdomain <> '_system'::text;

-- O ponto explicado em detalhe no cabeçalho: sem isto, a fase 2 apaga a
-- vitrine em vez de proteger a tabela.
ALTER VIEW public.barbearias_publicas SET (security_invoker = false);

COMMENT ON VIEW public.barbearias_publicas IS
  'Vitrine pública: barbearias aprovadas, exceto a sentinela _system. 24 '
  'colunas — as 16 originais mais status (constante), as políticas de '
  'reagendamento/cancelamento/falta, timezone e branding_enabled (derivado de '
  'plans.name, substitui plan_id). security_invoker=false de propósito: a view '
  'lê como o dono (postgres, BYPASSRLS) para sobreviver ao REVOKE da fase 2, e '
  'por isso o WHERE desta view é a fronteira de segurança, não a RLS. Colunas '
  'internas (owner_id, plan_id, appointments_this_month, receipt_*, pdf_*, '
  'whatsapp_message, qr_size, updated_at) NÃO entram aqui.';

-- Reafirmado (já concedido em 20260722130000): a view é somente leitura e só
-- para os papéis que a consomem. `service_role` não lê a vitrine — o backend
-- usa `public.barbershops` direto.
GRANT SELECT ON TABLE public.barbearias_publicas TO anon, authenticated;

/* ═══════════ 2. barbeiros públicos com is_owner ═══════════════════════════ */

-- Substitui `get_public_barbers` (20260420123902) no caminho público. A antiga
-- permanece intacta e continua servindo `NewComandaDialog`.
--
-- Diferenças em relação à antiga, todas deliberadas:
--   • devolve `is_owner`, calculado no servidor a partir de `b.owner_id` — o
--     UUID do dono não sai da função;
--   • exclui a sentinela `_system` (a antiga não excluía; ela não tem equipe,
--     então é endurecimento sem efeito prático);
--   • recusa `_barbershop_id` nulo explicitamente, como `get_public_products`;
--   • ordena o proprietário primeiro, tornando a ordem uma garantia do servidor
--     em vez de um detalhe da tela.
CREATE OR REPLACE FUNCTION public.get_public_barbers_v2(_barbershop_id uuid)
RETURNS TABLE (
  user_id  uuid,
  is_owner boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- DISTINCT porque a mesma pessoa pode ter dois papéis na mesma barbearia
  -- (admin_barbearia + barbeiro é o caso comum do dono que também atende).
  -- `is_owner` é função de `user_id`, então o DISTINCT não multiplica linhas.
  SELECT DISTINCT
    ur.user_id,
    (ur.user_id = b.owner_id) AS is_owner
  FROM public.user_roles ur
  JOIN public.barbershops b ON b.id = ur.barbershop_id
  WHERE ur.barbershop_id = _barbershop_id
    -- Parâmetro nulo devolve conjunto vazio, nunca a tabela inteira.
    AND _barbershop_id IS NOT NULL
    AND b.status = 'approved'
    AND b.subdomain <> '_system'
    AND ur.role IN ('barbeiro', 'admin_barbearia')
  ORDER BY is_owner DESC, ur.user_id ASC;
$$;

COMMENT ON FUNCTION public.get_public_barbers_v2(uuid) IS
  'Profissionais visíveis na página pública de uma barbearia aprovada, com '
  'is_owner calculado no servidor — o owner_id nunca é exposto. Barbearia '
  'inexistente, não aprovada ou sentinela devolve lista vazia. Substitui '
  'get_public_barbers no caminho público — a antiga segue para uso interno.';

REVOKE ALL ON FUNCTION public.get_public_barbers_v2(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_barbers_v2(uuid) TO anon, authenticated;

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 2 — NÃO VERSIONADA AINDA (de propósito)
   ═══════════════════════════════════════════════════════════════════════════

   O SQL abaixo é o que fecha o acesso direto do anônimo à tabela larga. Ele
   NÃO está neste arquivo como código executável, e não existe arquivo de
   migration para ele.

   O motivo é operacional: se a fase 2 já estivesse versionada, um único
   `supabase db push` aplicaria as duas de uma vez — e o frontend publicado no
   momento do push ainda seria o que lê a tabela. Manter a fase 2 fora do
   diretório torna esse acidente impossível, não apenas improvável.

   Só criar a migration da fase 2 DEPOIS que o frontend desta fase estiver
   publicado, rodando em produção e observado por alguns dias. São cinco pontos
   de leitura migrados, dois deles no agendamento público — o intervalo aqui
   importa mais do que importou em `products`, que tinha um só.

   Conteúdo conceitual:

     -- tira o acesso direto do visitante anônimo à tabela larga.
     -- A vitrine continua respondendo porque a view passou a ler como o dono
     -- (security_invoker = false, feito nesta fase 1).
     REVOKE SELECT ON TABLE public.barbershops FROM anon;

   NOTA: a policy "Anyone can view approved barbershops" NÃO deve ser removida.
   Ela continua sendo a via de leitura de `authenticated` — cliente, barbeiro,
   admin_barbearia e super_admin dependem dela, e o `REVOKE` acima não a
   alcança. Diferente de `products`, aqui a fase 2 é só o REVOKE.

   Verificações obrigatórias após aplicar a fase 2:
     • como anon: SELECT em `barbershops` deve ser negado (42501);
     • como anon: `barbearias_publicas` deve continuar respondendo 200 — é o
       teste que prova que o `security_invoker = false` desta fase funcionou;
     • como anon: a view NÃO pode devolver barbearia `pending`/`rejected` nem
       `_system`. Sem a RLS por baixo, o WHERE da view é a única barreira —
       criar uma barbearia `pending` de teste e conferir que ela não aparece;
     • como anon: `get_public_barbers_v2` responde para barbearia aprovada e
       devolve vazio para `pending`/`rejected`/`_system`/id inexistente;
     • como cliente autenticado: /meus-agendamentos e o histórico continuam
       resolvendo o nome da barbearia;
     • como barbeiro e admin_barbearia: dashboard, agenda, comandas,
       configurações e relatórios continuam lendo o próprio tenant;
     • como super_admin: /admin/churn continua listando barbearias em TODOS os
       status — é o caminho que mais depende da tabela larga;
     • onboarding: criar barbearia nova continua funcionando (INSERT não é
       afetado pelo REVOKE de SELECT, mas o retorno do INSERT é lido);
     • páginas públicas: /barbearias, /agendar, /agendar/$slug e o manifest
       por subdomínio continuam carregando.

   Rollback da fase 2, se algo quebrar:
     GRANT SELECT ON TABLE public.barbershops TO anon;
   ═══════════════════════════════════════════════════════════════════════════ */
