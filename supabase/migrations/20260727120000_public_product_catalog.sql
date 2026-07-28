-- Catálogo público de produtos — FASE 1 (aditiva, retrocompatível).
--
-- PROBLEMA
-- `products` tem `GRANT SELECT ... TO anon` (20260721140000) mais a policy
-- "Anyone can view products of approved barbershops" (20260416141800), cuja
-- única condição é a barbearia estar aprovada. Duas consequências:
--
--   1. RLS filtra LINHAS, não COLUNAS. Nenhuma policy esconde `stock_quantity`,
--      então qualquer visitante anônimo consegue inventariar o estoque exato de
--      qualquer barbearia aprovada — direto no PostgREST, sem passar pelo app.
--   2. A policy não filtra `active`. Produtos inativos/descontinuados são
--      legíveis. O `.eq("active", true)` existe só no frontend, e filtro de
--      frontend não é controle de acesso.
--
-- POR QUE ESTA MIGRATION NÃO FECHA O ACESSO
-- Fechar o acesso e publicar o frontend novo são dois eventos que não acontecem
-- ao mesmo tempo. Em qualquer ordem, uma migration única quebraria algo:
--
--   • migration primeiro → o frontend AINDA PUBLICADO perde o SELECT e a
--     vitrine pública para de carregar;
--   • frontend primeiro  → o frontend novo chama uma RPC que ainda não existe.
--
-- Por isso esta fase é estritamente ADITIVA: ela só CRIA coisas. Depois de
-- aplicada, os dois frontends funcionam — o antigo continua lendo a tabela, o
-- novo já encontra a função. A janela de indisponibilidade deixa de existir.
--
-- A revogação do acesso direto fica para a FASE 2, descrita no fim deste
-- arquivo e deliberadamente NÃO versionada ainda.
--
-- POR QUE FUNÇÃO E NÃO VIEW
-- Uma view não tem parâmetro obrigatório: bastaria omitir o filtro para varrer o
-- catálogo de TODAS as barbearias aprovadas numa requisição. E, com
-- `security_invoker = true`, ela ainda exigiria o GRANT na tabela base — que é
-- exatamente o que a fase 2 remove. A função força o tenant como argumento.
-- Mesmo padrão de `get_public_busy_intervals` (20260722190000).
--
-- ROLLBACK CONCEITUAL desta fase (seguro: nada aqui é destrutivo)
--   DROP FUNCTION IF EXISTS public.get_public_products(uuid);
--   DROP POLICY IF EXISTS "Staff can view products of their barbershop" ON public.products;
-- Nenhum dado é migrado nem destruído: a mudança é só de acesso, e só adiciona.

/* ═══════════ 1. catálogo público (sem quantidade, sem inativo) ═════════════ */

CREATE OR REPLACE FUNCTION public.get_public_products(_barbershop_id uuid)
RETURNS TABLE (
  id            uuid,
  barbershop_id uuid,
  name          text,
  description   text,
  price         numeric,
  image_url     text,
  in_stock      boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Colunas listadas uma a uma de propósito: um `SELECT` com asterisco passaria
  -- a vazar qualquer coluna interna adicionada à tabela no futuro.
  SELECT
    p.id,
    p.barbershop_id,
    p.name,
    p.description,
    p.price,
    p.image_url,
    -- A quantidade exata é informação interna. O público só precisa saber se
    -- pode ou não contar com o produto.
    (p.stock_quantity > 0) AS in_stock
  FROM public.products p
  JOIN public.barbershops b ON b.id = p.barbershop_id
  WHERE p.barbershop_id = _barbershop_id
    -- Parâmetro nulo devolve conjunto vazio (o `=` já garante isso), nunca a
    -- tabela inteira: não há caminho em que a ausência de filtro amplie escopo.
    AND _barbershop_id IS NOT NULL
    AND p.active = true
    -- Só barbearia aprovada tem página pública; a sentinela nunca é publicada.
    AND b.status = 'approved'
    AND NOT public.barbershop_is_system_sentinel(b.id)
  -- Ordenação estável: `name` pode repetir, então `id` desempata.
  ORDER BY p.name ASC, p.id ASC;
$$;

COMMENT ON FUNCTION public.get_public_products(uuid) IS
  'Catálogo público de uma barbearia aprovada: apenas produtos ativos, com '
  'in_stock booleano no lugar de stock_quantity. Barbearia inexistente, não '
  'aprovada ou sentinela devolve lista vazia — sem revelar qual é o caso.';

-- Somente leitura e somente para quem precisa. `REVOKE ... FROM PUBLIC` impede
-- que o EXECUTE implícito de PUBLIC sobreviva.
REVOKE ALL ON FUNCTION public.get_public_products(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_products(uuid) TO anon, authenticated;

/* ═══════════ 2. policy interna, criada já nesta fase ══════════════════════ */

-- Policies de SELECT são combinadas por OR. Enquanto a policy pública antiga
-- existir, esta não muda nada do comportamento observável: quem já lia continua
-- lendo. Ela é criada agora para que a FASE 2 seja apenas remoção — sem precisar
-- adicionar acesso no mesmo passo em que retira, que é onde erros acontecem.
--
-- Escopo, explicitamente:
--   • admin_barbearia — só o próprio tenant (`barbershop_id` é o da LINHA);
--   • barbeiro        — só o próprio tenant, mantendo a regra funcional atual
--                       (ele já podia ler, e as telas de comanda dependem disso);
--   • super_admin     — mesma regra administrativa das policies de INSERT/
--                       UPDATE/DELETE já existentes nesta tabela;
--   • cliente         — NÃO é alcançado: não tem papel de staff. Ele usa o
--                       catálogo público, sem quantidade e sem inativo.
--
-- Nada aqui depende de valor enviado pelo navegador: a decisão usa `auth.uid()`
-- e o `barbershop_id` da própria linha. A barbearia sentinela não amplia acesso —
-- `has_role_in_barbershop` compara com o tenant da linha, e a sentinela não tem
-- produtos.
CREATE POLICY "Staff can view products of their barbershop"
ON public.products FOR SELECT
TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
  OR has_role(auth.uid(), 'super_admin')
);

-- Nota sobre service_role: continua com acesso pleno (bypassa RLS), como
-- exigido por close_ticket, pelos relatórios e pelos scripts administrativos.
-- Nada aqui muda isso — e nada disso vai para o frontend.

/* ═══════════════════════════════════════════════════════════════════════════
   FASE 2 — NÃO VERSIONADA AINDA (de propósito)
   ═══════════════════════════════════════════════════════════════════════════

   O SQL abaixo é o que fecha o acesso direto do anônimo. Ele NÃO está neste
   arquivo como código executável, e não existe arquivo de migration para ele.

   O motivo é operacional: se a fase 2 já estivesse versionada, um único
   `supabase db push` aplicaria as duas de uma vez — reintroduzindo exatamente
   a janela de indisponibilidade que esta separação existe para evitar. Manter
   a fase 2 fora do diretório torna esse acidente impossível, não apenas
   improvável.

   Só criar a migration da fase 2 DEPOIS que o frontend que usa
   `get_public_products` estiver publicado e validado em produção.

   Conteúdo conceitual:

     -- 1. remove a leitura pública ampla (todas as colunas, ativos e inativos)
     DROP POLICY IF EXISTS "Anyone can view products of approved barbershops"
       ON public.products;

     -- 2. tira o acesso direto do visitante anônimo à tabela
     REVOKE SELECT ON TABLE public.products FROM anon;

     -- 3. a policy interna já existe (criada nesta fase 1) — apenas confirmar
     --    que continua presente e é a única via de leitura da tabela.

   Verificações obrigatórias após aplicar a fase 2:
     • como anon: SELECT em products deve ser negado;
     • como cliente autenticado SEM papel operacional: também negado
       (a policy de staff não o alcança);
     • como barbeiro e admin_barbearia: leitura normal do PRÓPRIO tenant;
     • comandas: abrir, lançar produto e fechar continuam funcionando
       (close_ticket é SECURITY DEFINER e não depende do grant do anon);
     • relatórios de produtos continuam retornando estoque;
     • catálogo público segue respondendo pela RPC, para anon e autenticado.

   Rollback da fase 2, se algo quebrar:
     CREATE POLICY "Anyone can view products of approved barbershops"
       ON public.products FOR SELECT
       USING (EXISTS (SELECT 1 FROM barbershops b
                      WHERE b.id = products.barbershop_id AND b.status = 'approved')
              OR has_role(auth.uid(), 'super_admin'));
     GRANT SELECT ON TABLE public.products TO anon;
   ═══════════════════════════════════════════════════════════════════════════ */
