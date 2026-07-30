-- Catálogo público de produtos — FASE 2 (restritiva).
--
-- Fecha o acesso direto do visitante anônimo a `public.products`. É a segunda
-- metade do plano descrito no fim de 20260727120000_public_product_catalog.sql,
-- deliberadamente mantida fora do diretório de migrations até que a fase 1
-- estivesse aplicada e o frontend que usa a RPC estivesse publicado.
--
-- PRÉ-REQUISITOS, todos verificados em 30/07/2026 antes de versionar este
-- arquivo:
--
--   • `get_public_products` existe no banco remoto — a fase 1 foi aplicada e
--     registrada no histórico de migrations;
--   • a policy "Staff can view products of their barbershop" existe, criada
--     pela fase 1, e passa a ser a única via de leitura da tabela;
--   • o bundle publicado em produção chama a RPC — nenhuma tela pública
--     depende mais da leitura direta;
--   • a RPC responde 200 para anon HOJE, com a policy pública ainda presente;
--   • `get_public_products` é SECURITY DEFINER e seu dono é `postgres`, que
--     tem BYPASSRLS. Isso é o que garante que ela continue enxergando as
--     linhas depois que a policy pública cair. Sem essa propriedade, esta
--     migration esvaziaria a vitrine em vez de protegê-la.
--
-- O QUE MUDA, EXPLICITAMENTE
--   • anônimo  — perde qualquer leitura direta da tabela; continua vendo o
--                catálogo pela RPC, sem `stock_quantity` e sem inativos;
--   • cliente autenticado sem papel operacional — também perde a leitura
--     direta. A policy de staff não o alcança, o que é intencional: ele usa
--     o mesmo catálogo público. Nenhuma tela de cliente lê a tabela;
--   • barbeiro / admin_barbearia / super_admin — inalterados, pela policy da
--     fase 1;
--   • service_role — inalterado (bypassa RLS), como exigido por close_ticket,
--     pelos relatórios e pelos scripts administrativos.
--
-- ROLLBACK, se algo quebrar:
--   CREATE POLICY "Anyone can view products of approved barbershops"
--     ON public.products FOR SELECT
--     USING (EXISTS (SELECT 1 FROM barbershops b
--                    WHERE b.id = products.barbershop_id AND b.status = 'approved')
--            OR has_role(auth.uid(), 'super_admin'));
--   GRANT SELECT ON TABLE public.products TO anon;

-- 1. remove a leitura pública ampla (todas as colunas, ativos e inativos)
DROP POLICY IF EXISTS "Anyone can view products of approved barbershops"
  ON public.products;

-- 2. tira o acesso direto do visitante anônimo à tabela
REVOKE SELECT ON TABLE public.products FROM anon;

-- 3. a policy interna já existe (criada na fase 1) e passa a ser a única via
--    de leitura da tabela. Nada a criar aqui — apenas confirmar na verificação
--    pós-aplicação que ela continua presente.
