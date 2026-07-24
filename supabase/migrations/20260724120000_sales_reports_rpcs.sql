/* ═══════════════════════════════════════════════════════════════════════════
   RELATÓRIOS DE VENDAS — RPCs de agregação no banco
   ---------------------------------------------------------------------------
   Move todo o cálculo financeiro dos relatórios para o banco. Motivos:
     • precisão: somas em numeric(10,2), nunca float no navegador;
     • isolamento: o front recebe só os agregados, nunca as linhas de tickets;
     • autorização: cada RPC valida auth.uid(), papel e tenant, e restringe o
       barbeiro aos próprios resultados (a RLS de tickets NÃO limita por
       barber_id — qualquer barbeiro da barbearia enxerga todas as comandas,
       então a restrição por profissional precisa ser feita aqui).

   Regras de negócio (iguais em todas as RPCs):
     • só entram comandas status = 'fechada';
     • recorte temporal por closed_at, no intervalo [_start, _end)
       (início inclusivo, fim exclusivo) — o front calcula os limites no fuso
       da barbearia e envia instantes timestamptz absolutos;
     • bruto  = Σ subtotal (antes do desconto);
     • desconto = Σ (subtotal − total) — o desconto EFETIVAMENTE aplicado, já
       clampado pelo trigger; garante por construção bruto − desconto = líquido;
     • líquido = Σ total (valor final gravado, derivado no banco);
     • valores de serviço/produto vêm do SNAPSHOT em ticket_items.unit_price/total
       (renomear ou reprecificar o catálogo não altera histórico).

   Migration posterior a 20260722260000; não altera migrations anteriores.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════ 1. Escopo de autorização por profissional ═════════════════════ */
-- Valida o chamador e devolve o barber_id ao qual o relatório deve se restringir:
--   • super_admin ou admin_barbearia da loja → devolve _barber_id (NULL = toda a
--     barbearia; ou um barbeiro específico, para "drill-down" do admin);
--   • barbeiro da loja → devolve o próprio user_id (ignora _barber_id: ele só vê
--     os próprios resultados, mesmo editando a chamada);
--   • qualquer outro (cliente, anon, papel de outro tenant) → erro.
CREATE OR REPLACE FUNCTION public.report_barber_scope(
  _barbershop_id uuid,
  _barber_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Admin da loja ou super_admin: enxerga a barbearia inteira (ou filtra num
  -- barbeiro, se _barber_id vier preenchido).
  IF has_role_in_barbershop(_caller, _barbershop_id, 'admin_barbearia'::app_role)
     OR has_role(_caller, 'super_admin'::app_role) THEN
    RETURN _barber_id;
  END IF;

  -- Barbeiro da loja: preso aos próprios resultados.
  IF has_role_in_barbershop(_caller, _barbershop_id, 'barbeiro'::app_role) THEN
    RETURN _caller;
  END IF;

  RAISE EXCEPTION 'forbidden: sem acesso aos relatórios desta barbearia'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

/* ═══════════ 2. Resumo de vendas (cards / indicadores) ═════════════════════ */
CREATE OR REPLACE FUNCTION public.report_sales_summary(
  _barbershop_id uuid,
  _start timestamptz,
  _end timestamptz,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  gross          numeric,
  discount       numeric,
  net            numeric,
  closed_count   integer,
  avg_ticket     numeric,
  services_count integer,
  products_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
BEGIN
  RETURN QUERY
  WITH tk AS (
    SELECT t.id, t.subtotal, t.total
    FROM public.tickets t
    WHERE t.barbershop_id = _barbershop_id
      AND t.status = 'fechada'
      AND t.closed_at >= _start
      AND t.closed_at <  _end
      AND (_scope IS NULL OR t.barber_id = _scope)
  ),
  it AS (
    SELECT
      COALESCE(sum(CASE WHEN ti.item_type = 'service' THEN ti.quantity ELSE 0 END), 0) AS svc,
      COALESCE(sum(CASE WHEN ti.item_type = 'product' THEN ti.quantity ELSE 0 END), 0) AS prd
    FROM public.ticket_items ti
    JOIN tk ON tk.id = ti.ticket_id
  )
  SELECT
    round(COALESCE(sum(tk.subtotal), 0), 2)                                   AS gross,
    round(COALESCE(sum(tk.subtotal - tk.total), 0), 2)                        AS discount,
    round(COALESCE(sum(tk.total), 0), 2)                                      AS net,
    count(tk.id)::int                                                         AS closed_count,
    CASE WHEN count(tk.id) = 0 THEN 0
         ELSE round(COALESCE(sum(tk.total), 0) / count(tk.id), 2) END         AS avg_ticket,
    COALESCE((SELECT svc FROM it), 0)::int                                    AS services_count,
    COALESCE((SELECT prd FROM it), 0)::int                                    AS products_count
  FROM tk;
END;
$$;

/* ═══════════ 3. Evolução temporal (faturamento/comandas por dia) ═══════════ */
-- Agrupa por dia-calendário NO FUSO DA BARBEARIA. Dias sem venda não aparecem
-- aqui — o front preenche os zeros do intervalo selecionado (ele conhece o fuso
-- e as bordas do período).
CREATE OR REPLACE FUNCTION public.report_sales_timeseries(
  _barbershop_id uuid,
  _start timestamptz,
  _end timestamptz,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  day          date,
  net          numeric,
  closed_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
  _tz    text;
BEGIN
  SELECT COALESCE(b.timezone, 'America/Sao_Paulo') INTO _tz
  FROM public.barbershops b WHERE b.id = _barbershop_id;
  _tz := COALESCE(_tz, 'America/Sao_Paulo');

  RETURN QUERY
  SELECT
    (t.closed_at AT TIME ZONE _tz)::date AS day,
    round(sum(t.total), 2)               AS net,
    count(*)::int                        AS closed_count
  FROM public.tickets t
  WHERE t.barbershop_id = _barbershop_id
    AND t.status = 'fechada'
    AND t.closed_at >= _start
    AND t.closed_at <  _end
    AND (_scope IS NULL OR t.barber_id = _scope)
  GROUP BY 1
  ORDER BY 1;
END;
$$;

/* ═══════════ 4. Serviços vendidos (snapshot) ═══════════════════════════════ */
CREATE OR REPLACE FUNCTION public.report_services(
  _barbershop_id uuid,
  _start timestamptz,
  _end timestamptz,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  service_id uuid,
  name       text,
  revenue    numeric,
  quantity   integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
BEGIN
  RETURN QUERY
  SELECT
    ti.service_id,
    -- nome mais recente registrado no snapshot (mantém histórico após rename)
    (array_agg(ti.description ORDER BY t.closed_at DESC))[1] AS name,
    round(sum(ti.total), 2)                                  AS revenue,
    sum(ti.quantity)::int                                    AS quantity
  FROM public.ticket_items ti
  JOIN public.tickets t ON t.id = ti.ticket_id
  WHERE t.barbershop_id = _barbershop_id
    AND t.status = 'fechada'
    AND t.closed_at >= _start
    AND t.closed_at <  _end
    AND ti.item_type = 'service'
    AND (_scope IS NULL OR t.barber_id = _scope)
  GROUP BY ti.service_id
  ORDER BY revenue DESC;
END;
$$;

/* ═══════════ 5. Produtos vendidos (snapshot) + estoque atual ═══════════════ */
-- Baseado em ticket_items de comandas FECHADAS. Estoque atual e "ativo" vêm da
-- linha atual de products (informativo). Sem coluna de limiar no schema: a
-- indicação de "estoque baixo" é decidida no front por uma constante.
CREATE OR REPLACE FUNCTION public.report_products(
  _barbershop_id uuid,
  _start timestamptz,
  _end timestamptz,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  product_id     uuid,
  name           text,
  revenue        numeric,
  quantity       integer,
  stock_quantity integer,
  active          boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
BEGIN
  RETURN QUERY
  SELECT
    ti.product_id,
    (array_agg(ti.description ORDER BY t.closed_at DESC))[1] AS name,
    round(sum(ti.total), 2)                                  AS revenue,
    sum(ti.quantity)::int                                    AS quantity,
    max(p.stock_quantity)                                    AS stock_quantity,
    bool_or(p.active)                                        AS active
  FROM public.ticket_items ti
  JOIN public.tickets t ON t.id = ti.ticket_id
  LEFT JOIN public.products p ON p.id = ti.product_id
  WHERE t.barbershop_id = _barbershop_id
    AND t.status = 'fechada'
    AND t.closed_at >= _start
    AND t.closed_at <  _end
    AND ti.item_type = 'product'
    AND (_scope IS NULL OR t.barber_id = _scope)
  GROUP BY ti.product_id
  ORDER BY revenue DESC;
END;
$$;

/* ═══════════ 6. Desempenho por profissional ════════════════════════════════ */
-- Origem do profissional: tickets.barber_id (único consistente — ticket_items
-- não tem barber_id). Um barbeiro só vê a própria linha.
CREATE OR REPLACE FUNCTION public.report_by_barber(
  _barbershop_id uuid,
  _start timestamptz,
  _end timestamptz,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  barber_id      uuid,
  tickets_count  integer,
  services_count integer,
  net            numeric,
  avg_ticket     numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
BEGIN
  RETURN QUERY
  WITH tk AS (
    SELECT t.id, t.barber_id, t.total
    FROM public.tickets t
    WHERE t.barbershop_id = _barbershop_id
      AND t.status = 'fechada'
      AND t.closed_at >= _start
      AND t.closed_at <  _end
      AND (_scope IS NULL OR t.barber_id = _scope)
  ),
  svc AS (
    SELECT tk.barber_id,
           sum(CASE WHEN ti.item_type = 'service' THEN ti.quantity ELSE 0 END) AS services_count
    FROM tk
    JOIN public.ticket_items ti ON ti.ticket_id = tk.id
    GROUP BY tk.barber_id
  )
  SELECT
    tk.barber_id,
    count(*)::int                                             AS tickets_count,
    COALESCE(max(svc.services_count), 0)::int                 AS services_count,
    round(sum(tk.total), 2)                                   AS net,
    round(sum(tk.total) / count(*), 2)                        AS avg_ticket
  FROM tk
  LEFT JOIN svc ON svc.barber_id = tk.barber_id
  GROUP BY tk.barber_id
  ORDER BY net DESC;
END;
$$;

/* ═══════════ 7. Formas de pagamento ════════════════════════════════════════ */
-- Cada parcela entra na sua forma (Σ amount). Uma comanda conta UMA vez em
-- tickets_count (count distinct ticket_id) — split não duplica comandas.
CREATE OR REPLACE FUNCTION public.report_payment_methods(
  _barbershop_id uuid,
  _start timestamptz,
  _end timestamptz,
  _barber_id uuid DEFAULT NULL
)
RETURNS TABLE (
  method_name   text,
  amount        numeric,
  tickets_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _scope uuid := report_barber_scope(_barbershop_id, _barber_id);
BEGIN
  RETURN QUERY
  SELECT
    tp.method_name,
    round(sum(tp.amount), 2)          AS amount,
    count(DISTINCT tp.ticket_id)::int AS tickets_count
  FROM public.ticket_payments tp
  JOIN public.tickets t ON t.id = tp.ticket_id
  WHERE t.barbershop_id = _barbershop_id
    AND t.status = 'fechada'
    AND t.closed_at >= _start
    AND t.closed_at <  _end
    AND (_scope IS NULL OR t.barber_id = _scope)
  GROUP BY tp.method_name
  ORDER BY amount DESC;
END;
$$;

/* ═══════════ 8. Grants: só usuário autenticado; nunca anon/service no front ═ */
REVOKE ALL ON FUNCTION public.report_barber_scope(uuid, uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_sales_summary(uuid, timestamptz, timestamptz, uuid)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_sales_timeseries(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_services(uuid, timestamptz, timestamptz, uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_products(uuid, timestamptz, timestamptz, uuid)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_by_barber(uuid, timestamptz, timestamptz, uuid)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.report_payment_methods(uuid, timestamptz, timestamptz, uuid)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.report_barber_scope(uuid, uuid)                        TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_sales_summary(uuid, timestamptz, timestamptz, uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_sales_timeseries(uuid, timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_services(uuid, timestamptz, timestamptz, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_products(uuid, timestamptz, timestamptz, uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_by_barber(uuid, timestamptz, timestamptz, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.report_payment_methods(uuid, timestamptz, timestamptz, uuid)  TO authenticated;
