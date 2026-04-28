
-- ============================================
-- payment_methods (configurável por barbearia)
-- ============================================
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (barbershop_id, name)
);

CREATE INDEX idx_payment_methods_barbershop ON public.payment_methods(barbershop_id) WHERE active = true;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view payment methods"
ON public.payment_methods FOR SELECT TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can insert payment methods"
ON public.payment_methods FOR INSERT TO authenticated
WITH CHECK (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can update payment methods"
ON public.payment_methods FOR UPDATE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can delete payment methods"
ON public.payment_methods FOR DELETE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE TRIGGER update_payment_methods_updated_at
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed defaults para barbearias existentes
INSERT INTO public.payment_methods (barbershop_id, name, sort_order)
SELECT b.id, m.name, m.sort_order
FROM public.barbershops b
CROSS JOIN (VALUES
  ('Dinheiro', 1),
  ('Pix', 2),
  ('Cartão Débito', 3),
  ('Cartão Crédito', 4)
) AS m(name, sort_order)
ON CONFLICT (barbershop_id, name) DO NOTHING;

-- Trigger: criar formas padrão para novas barbearias
CREATE OR REPLACE FUNCTION public.seed_default_payment_methods()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payment_methods (barbershop_id, name, sort_order) VALUES
    (NEW.id, 'Dinheiro', 1),
    (NEW.id, 'Pix', 2),
    (NEW.id, 'Cartão Débito', 3),
    (NEW.id, 'Cartão Crédito', 4)
  ON CONFLICT (barbershop_id, name) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_payment_methods_on_barbershop_create
AFTER INSERT ON public.barbershops
FOR EACH ROW EXECUTE FUNCTION public.seed_default_payment_methods();

-- ============================================
-- tickets (comanda)
-- ============================================
CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbershop_id uuid NOT NULL,
  appointment_id uuid NOT NULL UNIQUE,
  client_id uuid NOT NULL,
  barber_id uuid NOT NULL,
  closed_by uuid NOT NULL,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  discount_type text NOT NULL DEFAULT 'fixed' CHECK (discount_type IN ('fixed','percent')),
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  total numeric(10,2) NOT NULL DEFAULT 0,
  notes text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tickets_barbershop ON public.tickets(barbershop_id, closed_at DESC);
CREATE INDEX idx_tickets_client ON public.tickets(client_id, closed_at DESC);
CREATE INDEX idx_tickets_barber ON public.tickets(barber_id, closed_at DESC);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff and client can view tickets"
ON public.tickets FOR SELECT TO authenticated
USING (
  client_id = auth.uid()
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Staff can insert tickets"
ON public.tickets FOR INSERT TO authenticated
WITH CHECK (
  closed_by = auth.uid()
  AND (
    has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
    OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  )
);

CREATE POLICY "Staff can update tickets"
ON public.tickets FOR UPDATE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Admins can delete tickets"
ON public.tickets FOR DELETE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE TRIGGER update_tickets_updated_at
BEFORE UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- ticket_items
-- ============================================
CREATE TABLE public.ticket_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  barbershop_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('service','product','custom')),
  service_id uuid,
  product_id uuid,
  description text NOT NULL,
  unit_price numeric(10,2) NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_items_ticket ON public.ticket_items(ticket_id);

ALTER TABLE public.ticket_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff and client can view ticket items"
ON public.ticket_items FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_items.ticket_id AND t.client_id = auth.uid())
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Staff can insert ticket items"
ON public.ticket_items FOR INSERT TO authenticated
WITH CHECK (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Staff can update ticket items"
ON public.ticket_items FOR UPDATE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Staff can delete ticket items"
ON public.ticket_items FOR DELETE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

-- Trigger: ajustar estoque quando produto é adicionado/removido
CREATE OR REPLACE FUNCTION public.adjust_product_stock_on_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.item_type = 'product' AND NEW.product_id IS NOT NULL THEN
    UPDATE public.products
    SET stock_quantity = GREATEST(0, stock_quantity - NEW.quantity), updated_at = now()
    WHERE id = NEW.product_id;
  ELSIF TG_OP = 'DELETE' AND OLD.item_type = 'product' AND OLD.product_id IS NOT NULL THEN
    UPDATE public.products
    SET stock_quantity = stock_quantity + OLD.quantity, updated_at = now()
    WHERE id = OLD.product_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER ticket_items_adjust_stock
AFTER INSERT OR DELETE ON public.ticket_items
FOR EACH ROW EXECUTE FUNCTION public.adjust_product_stock_on_ticket();

-- ============================================
-- ticket_payments (suporta pagamento dividido)
-- ============================================
CREATE TABLE public.ticket_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  barbershop_id uuid NOT NULL,
  payment_method_id uuid,
  method_name text NOT NULL,
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_payments_ticket ON public.ticket_payments(ticket_id);

ALTER TABLE public.ticket_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff and client can view ticket payments"
ON public.ticket_payments FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_payments.ticket_id AND t.client_id = auth.uid())
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Staff can insert ticket payments"
ON public.ticket_payments FOR INSERT TO authenticated
WITH CHECK (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);

CREATE POLICY "Staff can delete ticket payments"
ON public.ticket_payments FOR DELETE TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::app_role)
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::app_role)
  OR has_role(auth.uid(), 'super_admin'::app_role)
);
