-- ============================================================================
-- Comanda com ciclo de vida (aberta / fechada / cancelada)
-- ----------------------------------------------------------------------------
-- HOJE: `tickets` é um RECIBO de fechamento imediato — nasce fechado
-- (`appointment_id NOT NULL UNIQUE`, `closed_by`/`closed_at NOT NULL`), sem
-- coluna de status. O estoque baixa no INSERT do item (trigger
-- adjust_product_stock_on_ticket) com `GREATEST(0, stock - qty)`, que CLAMPA em
-- zero e nunca acusa falta (oversell silencioso). O fechamento é um multi-INSERT
-- client-side sem transação, e o total vem pronto do frontend.
--
-- ESTA MIGRATION transforma `tickets` numa COMANDA com ciclo de vida:
--   * status 'aberta' | 'fechada' | 'cancelada';
--   * appointment_id / client_id / closed_by / closed_at OPCIONAIS (abertura
--     manual, cliente opcional, comanda aberta ainda sem fechamento);
--   * itens entram/saem enquanto aberta; estoque só baixa NO FECHAMENTO;
--   * isolamento de tenant e integridade validados NO BANCO (triggers), não só
--     por RLS/frontend;
--   * fechamento por RPC transacional (close_ticket): revalida estoque, baixa
--     atômico (erro se insuficiente, sem baixa parcial), recalcula total no
--     banco, grava pagamentos (informativos), fecha e conclui o agendamento;
--   * comanda fechada/cancelada é IMUTÁVEL; cancelamento só quando aberta.
--
-- COMPATIBILIDADE: recibos existentes são preservados e tratados como FECHADOS
-- (status='fechada'); closed_at/appointment_id/valores mantidos, nada apagado
-- nem recalculado de forma destrutiva.
--
-- Sem enum novo: status é text+CHECK, no mesmo padrão de `discount_type`.
-- Posterior a 20260722250000. Idempotente onde possível; feita para `db reset`.
-- ============================================================================

/* ═══════════ 1. tickets: status, campos opcionais, compatibilidade ═════════ */

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'aberta'
    CHECK (status IN ('aberta','fechada','cancelada')),
  ADD COLUMN IF NOT EXISTS opened_by uuid;

-- Compatibilidade: todo ticket que já existia é um recibo fechado.
UPDATE public.tickets SET status = 'fechada' WHERE closed_at IS NOT NULL;
-- opened_by legado = quem fechou (melhor aproximação sem inventar dado novo).
UPDATE public.tickets SET opened_by = closed_by WHERE opened_by IS NULL;
ALTER TABLE public.tickets ALTER COLUMN opened_by SET NOT NULL;

-- Campos que passam a ser opcionais no modelo de comanda aberta.
ALTER TABLE public.tickets
  ALTER COLUMN appointment_id DROP NOT NULL,
  ALTER COLUMN client_id      DROP NOT NULL,
  ALTER COLUMN closed_by      DROP NOT NULL,
  ALTER COLUMN closed_at      DROP NOT NULL,
  ALTER COLUMN closed_at      DROP DEFAULT;

-- appointment_id: era UNIQUE global. Vira índice único PARCIAL — no máximo uma
-- comanda NÃO cancelada por agendamento (permite reabrir após cancelar).
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_appointment_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_active_per_appointment
  ON public.tickets (appointment_id)
  WHERE appointment_id IS NOT NULL AND status <> 'cancelada';

-- Integridade de valores (comanda aberta começa em zero; nada negativo).
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_subtotal_nonneg CHECK (subtotal >= 0),
  ADD CONSTRAINT tickets_total_nonneg    CHECK (total >= 0),
  ADD CONSTRAINT tickets_discount_nonneg CHECK (discount_amount >= 0);

/* ═══════════ 2. products: estoque nunca negativo (backstop) ════════════════ */

ALTER TABLE public.products
  ADD CONSTRAINT products_stock_nonneg CHECK (stock_quantity >= 0);

/* ═══════════ 3. baixa de estoque deixa de ser no INSERT do item ════════════ */
-- Passa a ocorrer só no fechamento, dentro de close_ticket (transacional).
DROP TRIGGER IF EXISTS ticket_items_adjust_stock ON public.ticket_items;
DROP FUNCTION IF EXISTS public.adjust_product_stock_on_ticket();

/* ═══════════ 4. cálculo: fonte única de verdade do desconto/total ══════════ */

CREATE OR REPLACE FUNCTION public.ticket_discount_value(_subtotal numeric, _type text, _amount numeric)
RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  -- Desconto nunca maior que o subtotal → total nunca negativo.
  SELECT CASE
           WHEN _subtotal <= 0 THEN 0
           WHEN _type = 'percent' THEN LEAST(_subtotal, round(_subtotal * COALESCE(_amount,0) / 100.0, 2))
           ELSE LEAST(_subtotal, COALESCE(_amount,0))
         END;
$$;

-- Recalcula subtotal (soma dos itens) e total da comanda ABERTA. Única fonte de
-- verdade do subtotal; o total é derivado sempre (ver enforce_ticket_write).
CREATE OR REPLACE FUNCTION public.ticket_recalc(_ticket_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE _sub numeric;
BEGIN
  SELECT COALESCE(sum(total), 0) INTO _sub
  FROM public.ticket_items WHERE ticket_id = _ticket_id;

  UPDATE public.tickets
     SET subtotal = _sub, updated_at = now()
   WHERE id = _ticket_id AND status = 'aberta';
END;
$$;

REVOKE ALL ON FUNCTION public.ticket_discount_value(numeric, text, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ticket_recalc(uuid) FROM PUBLIC, anon, authenticated;

/* ═══════════ 5. itens: isolamento e integridade no BANCO ═══════════════════ */
-- Vale para qualquer caminho de escrita (PostgREST, RPC, SQL). Independe de RLS.
CREATE OR REPLACE FUNCTION public.enforce_ticket_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _t         RECORD;
  _price     numeric;
  _name      text;
  _active    boolean;
  _bs        uuid;
BEGIN
  -- (a) comanda-alvo e imutabilidade: só comanda ABERTA aceita mudança de item.
  SELECT barbershop_id, status INTO _t
  FROM public.tickets
  WHERE id = COALESCE(NEW.ticket_id, OLD.ticket_id);

  IF NOT FOUND THEN
    -- Comanda já não existe: é o CASCADE do DELETE da própria comanda apagando
    -- os itens. Não há o que proteger — deixa o cascade seguir.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'comanda inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF _t.status <> 'aberta' THEN
    RAISE EXCEPTION 'comanda_nao_aberta: itens só mudam com a comanda aberta'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- (b) o item pertence ao MESMO tenant da comanda (autoritativo, não do front).
  NEW.barbershop_id := _t.barbershop_id;

  IF NEW.quantity IS NULL OR NEW.quantity <= 0 THEN
    RAISE EXCEPTION 'quantidade deve ser inteira e positiva' USING ERRCODE = 'check_violation';
  END IF;

  -- (c) por tipo: serviço/produto do MESMO tenant; preço vem do catálogo (snapshot).
  IF NEW.item_type = 'service' THEN
    IF NEW.service_id IS NULL THEN
      RAISE EXCEPTION 'service_id obrigatório para item de serviço' USING ERRCODE = 'check_violation';
    END IF;
    NEW.product_id := NULL;
    SELECT price, name, barbershop_id INTO _price, _name, _bs
    FROM public.services WHERE id = NEW.service_id;
    IF NOT FOUND OR _bs <> _t.barbershop_id THEN
      RAISE EXCEPTION 'tenant_invalido: serviço de outra barbearia' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.unit_price := _price;                      -- snapshot no momento da venda
      NEW.description := COALESCE(NULLIF(TRIM(NEW.description), ''), _name);
    ELSE
      NEW.unit_price := OLD.unit_price;              -- preço não muda depois de lançado
    END IF;

  ELSIF NEW.item_type = 'product' THEN
    IF NEW.product_id IS NULL THEN
      RAISE EXCEPTION 'product_id obrigatório para item de produto' USING ERRCODE = 'check_violation';
    END IF;
    NEW.service_id := NULL;
    SELECT price, name, barbershop_id, active INTO _price, _name, _bs, _active
    FROM public.products WHERE id = NEW.product_id;
    IF NOT FOUND OR _bs <> _t.barbershop_id THEN
      RAISE EXCEPTION 'tenant_invalido: produto de outra barbearia' USING ERRCODE = 'check_violation';
    END IF;
    IF _active IS NOT TRUE THEN
      RAISE EXCEPTION 'produto_inativo' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.unit_price := _price;                      -- snapshot; estoque NÃO baixa aqui
      NEW.description := COALESCE(NULLIF(TRIM(NEW.description), ''), _name);
    ELSE
      NEW.unit_price := OLD.unit_price;
    END IF;

  ELSIF NEW.item_type = 'custom' THEN
    NEW.service_id := NULL;
    NEW.product_id := NULL;
    IF NEW.description IS NULL OR TRIM(NEW.description) = '' THEN
      RAISE EXCEPTION 'descrição obrigatória para item avulso' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.unit_price IS NULL OR NEW.unit_price < 0 THEN
      RAISE EXCEPTION 'preço unitário não pode ser negativo' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'item_type inválido' USING ERRCODE = 'check_violation';
  END IF;

  -- (d) total do item é do SERVIDOR, nunca o que o front mandar.
  NEW.total := round(NEW.unit_price * NEW.quantity, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ticket_item ON public.ticket_items;
CREATE TRIGGER trg_enforce_ticket_item
  BEFORE INSERT OR UPDATE OR DELETE ON public.ticket_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_item();

-- Recalcula a comanda a cada mudança de item (prévia no banco).
CREATE OR REPLACE FUNCTION public.ticket_recalc_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ticket_recalc(COALESCE(NEW.ticket_id, OLD.ticket_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticket_items_recalc ON public.ticket_items;
CREATE TRIGGER trg_ticket_items_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.ticket_items
  FOR EACH ROW EXECUTE FUNCTION public.ticket_recalc_trg();

/* ═══════════ 6. tickets: transições, imutabilidade, total derivado ═════════ */
CREATE OR REPLACE FUNCTION public.enforce_ticket_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Toda comanda nasce ABERTA e zerada; fechar é só via close_ticket (UPDATE).
    IF NEW.status IS DISTINCT FROM 'aberta' THEN
      RAISE EXCEPTION 'comanda nasce aberta; fechamento é pela RPC close_ticket'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.closed_at := NULL;
    NEW.closed_by := NULL;
    NEW.total := GREATEST(0, NEW.subtotal - public.ticket_discount_value(NEW.subtotal, NEW.discount_type, NEW.discount_amount));
    RETURN NEW;
  END IF;

  -- UPDATE: fechada/cancelada são IMUTÁVEIS.
  IF OLD.status <> 'aberta' THEN
    RAISE EXCEPTION 'comanda_imutavel: comanda % não pode mais ser alterada', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Transições válidas a partir de aberta: aberta | fechada | cancelada.
  IF NEW.status NOT IN ('aberta','fechada','cancelada') THEN
    RAISE EXCEPTION 'status inválido' USING ERRCODE = 'check_violation';
  END IF;

  -- total é SEMPRE derivado do subtotal + desconto — nunca aceito do chamador.
  NEW.total := GREATEST(0, NEW.subtotal - public.ticket_discount_value(NEW.subtotal, NEW.discount_type, NEW.discount_amount));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_ticket_write ON public.tickets;
CREATE TRIGGER trg_enforce_ticket_write
  BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ticket_write();

/* ═══════════ 7. RLS: INSERT usa opened_by (comanda aberta sem closed_by) ═══ */
DROP POLICY IF EXISTS "Staff can insert tickets" ON public.tickets;
CREATE POLICY "Staff can insert tickets"
ON public.tickets FOR INSERT TO authenticated
WITH CHECK (
  opened_by = auth.uid()
  AND (
    has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

/* ═══════════ 8. RPC: abrir comanda (manual ou por agendamento) ═════════════ */
CREATE OR REPLACE FUNCTION public.open_ticket(
  _barbershop_id uuid,
  _appointment_id uuid DEFAULT NULL,
  _client_id uuid DEFAULT NULL,
  _barber_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _appt   RECORD;
  _existing RECORD;
  _ticket uuid;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Só equipe daquela barbearia (ou super_admin) abre comanda.
  IF NOT (
    has_role_in_barbershop(_caller, _barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(_caller, _barbershop_id, 'admin_barbearia'::app_role)
    OR has_role(_caller, 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: só a equipe da barbearia abre comanda' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Abertura por agendamento: valida tenant, herda cliente/barbeiro, é idempotente.
  IF _appointment_id IS NOT NULL THEN
    SELECT * INTO _appt FROM public.appointments WHERE id = _appointment_id;
    IF NOT FOUND OR _appt.barbershop_id <> _barbershop_id THEN
      RAISE EXCEPTION 'tenant_invalido: agendamento de outra barbearia' USING ERRCODE = 'check_violation';
    END IF;

    -- Não duplica: se já há comanda ABERTA, devolve-a (idempotente). Se já há
    -- uma FECHADA, o agendamento já foi faturado — erro claro (o índice único
    -- parcial também barraria uma segunda comanda não cancelada).
    SELECT id, status INTO _existing FROM public.tickets
    WHERE appointment_id = _appointment_id AND status <> 'cancelada'
    LIMIT 1;
    IF _existing.id IS NOT NULL THEN
      IF _existing.status = 'aberta' THEN
        RETURN _existing.id;
      END IF;
      RAISE EXCEPTION 'comanda_ja_fechada: este agendamento já possui comanda fechada'
        USING ERRCODE = 'check_violation';
    END IF;

    _client_id := COALESCE(_client_id, _appt.client_id);
    _barber_id := COALESCE(_barber_id, _appt.barber_id);
  END IF;

  IF _barber_id IS NULL THEN
    RAISE EXCEPTION 'barber_id obrigatório para abrir comanda' USING ERRCODE = 'check_violation';
  END IF;

  -- Barbeiro responsável precisa ser da barbearia.
  IF NOT (
    has_role_in_barbershop(_barber_id, _barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(_barber_id, _barbershop_id, 'admin_barbearia'::app_role)
  ) THEN
    RAISE EXCEPTION 'tenant_invalido: barbeiro não é desta barbearia' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tickets
    (barbershop_id, appointment_id, client_id, barber_id, opened_by, status, subtotal, total)
  VALUES
    (_barbershop_id, _appointment_id, _client_id, _barber_id, _caller, 'aberta', 0, 0)
  RETURNING id INTO _ticket;

  -- Aberta por agendamento: adiciona o serviço do agendamento como item inicial.
  -- (Acesso a _appt aninhado: em abertura MANUAL o record não é atribuído, e o
  --  PL/pgSQL avaliaria _appt.service_id mesmo com o AND — o que estouraria.)
  IF _appointment_id IS NOT NULL THEN
    IF _appt.service_id IS NOT NULL THEN
      INSERT INTO public.ticket_items (ticket_id, barbershop_id, item_type, service_id, description, quantity)
      VALUES (_ticket, _barbershop_id, 'service', _appt.service_id, '', 1);
    END IF;
  END IF;

  RETURN _ticket;
END;
$$;

/* ═══════════ 9. RPC: fechar comanda (transacional) ═════════════════════════ */
CREATE OR REPLACE FUNCTION public.close_ticket(
  _ticket_id uuid,
  _payments jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _t      RECORD;
  _n      integer;
  _rec    RECORD;
  _stock  integer;
  _pay    jsonb;
  _sub    numeric;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Trava a comanda: fechamentos concorrentes serializam aqui.
  SELECT * INTO _t FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'comanda inexistente' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT (
    has_role_in_barbershop(_caller, _t.barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(_caller, _t.barbershop_id, 'admin_barbearia'::app_role)
    OR has_role(_caller, 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden: só a equipe da barbearia fecha comanda' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _t.status <> 'aberta' THEN
    RAISE EXCEPTION 'comanda_nao_aberta' USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO _n FROM public.ticket_items WHERE ticket_id = _ticket_id;
  IF _n = 0 THEN
    RAISE EXCEPTION 'comanda_sem_itens' USING ERRCODE = 'check_violation';
  END IF;

  -- Revalida e baixa estoque ATÔMICO. FOR UPDATE serializa por produto: a
  -- segunda comanda espera o commit da primeira, relê o estoque já comprometido
  -- e falha se insuficiente. Qualquer erro aqui reverte TUDO (sem baixa parcial).
  FOR _rec IN
    SELECT product_id, sum(quantity) AS qty
    FROM public.ticket_items
    WHERE ticket_id = _ticket_id AND item_type = 'product' AND product_id IS NOT NULL
    GROUP BY product_id
  LOOP
    SELECT stock_quantity INTO _stock
    FROM public.products
    WHERE id = _rec.product_id AND barbershop_id = _t.barbershop_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'tenant_invalido: produto fora da barbearia' USING ERRCODE = 'check_violation';
    END IF;
    IF _stock < _rec.qty THEN
      RAISE EXCEPTION 'estoque_insuficiente: produto % (tem %, precisa %)', _rec.product_id, _stock, _rec.qty
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE public.products
       SET stock_quantity = stock_quantity - _rec.qty, updated_at = now()
     WHERE id = _rec.product_id;
  END LOOP;

  -- Subtotal recalculado no banco (o total é derivado no trigger BEFORE UPDATE).
  SELECT COALESCE(sum(total), 0) INTO _sub FROM public.ticket_items WHERE ticket_id = _ticket_id;

  -- Pagamentos são apenas INFORMATIVOS (sem gateway). Valida tenant da forma.
  FOR _pay IN SELECT * FROM jsonb_array_elements(COALESCE(_payments, '[]'::jsonb))
  LOOP
    IF (_pay->>'amount') IS NULL OR (_pay->>'amount')::numeric <= 0 THEN
      RAISE EXCEPTION 'pagamento com valor inválido' USING ERRCODE = 'check_violation';
    END IF;
    IF (_pay->>'payment_method_id') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_methods pm
         WHERE pm.id = (_pay->>'payment_method_id')::uuid AND pm.barbershop_id = _t.barbershop_id
       ) THEN
      RAISE EXCEPTION 'tenant_invalido: forma de pagamento de outra barbearia' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.ticket_payments (ticket_id, barbershop_id, payment_method_id, method_name, amount)
    VALUES (
      _ticket_id, _t.barbershop_id,
      NULLIF(_pay->>'payment_method_id','')::uuid,
      COALESCE(_pay->>'method_name', 'Não informado'),
      (_pay->>'amount')::numeric
    );
  END LOOP;

  UPDATE public.tickets
     SET status = 'fechada', subtotal = _sub, closed_at = now(), closed_by = _caller
   WHERE id = _ticket_id;

  -- Regra atual: concluir o agendamento vinculado.
  IF _t.appointment_id IS NOT NULL THEN
    UPDATE public.appointments
       SET status = 'completed'
     WHERE id = _t.appointment_id
       AND barbershop_id = _t.barbershop_id
       AND status <> 'cancelled';
  END IF;

  RETURN _ticket_id;
END;
$$;

/* ═══════════ 10. grants das RPCs (EXECUTE só authenticated) ════════════════ */
REVOKE ALL ON FUNCTION public.open_ticket(uuid, uuid, uuid, uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_ticket(uuid, jsonb)            FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_ticket(uuid, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_ticket(uuid, jsonb)          TO authenticated;

COMMENT ON FUNCTION public.open_ticket(uuid, uuid, uuid, uuid) IS
  'Abre uma comanda (manual ou por agendamento). Valida papel+tenant, é idempotente por agendamento e adiciona o serviço inicial. Não movimenta estoque.';
COMMENT ON FUNCTION public.close_ticket(uuid, jsonb) IS
  'Fecha uma comanda de forma transacional: revalida estoque (FOR UPDATE), baixa atômico, recalcula total, grava pagamentos informativos, fecha e conclui o agendamento. Falha reverte tudo.';
