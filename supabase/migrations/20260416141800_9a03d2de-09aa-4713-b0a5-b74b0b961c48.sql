
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view products of approved barbershops"
ON public.products FOR SELECT
USING (
  EXISTS (SELECT 1 FROM barbershops b WHERE b.id = products.barbershop_id AND b.status = 'approved')
  OR has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Barbers and admins can insert products"
ON public.products FOR INSERT
TO authenticated
WITH CHECK (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR (has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro') AND true)
  OR has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Barbers and admins can update products"
ON public.products FOR UPDATE
TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
  OR has_role(auth.uid(), 'super_admin')
);

CREATE POLICY "Admins can delete products"
ON public.products FOR DELETE
TO authenticated
USING (
  has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR has_role(auth.uid(), 'super_admin')
);

CREATE TRIGGER update_products_updated_at
BEFORE UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
