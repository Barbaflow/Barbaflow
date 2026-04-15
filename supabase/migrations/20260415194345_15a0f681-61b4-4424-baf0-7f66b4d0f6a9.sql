-- Create sentinel barbershop for global roles
INSERT INTO public.barbershops (id, name, subdomain, status, owner_id)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  '_system',
  '_system',
  'approved',
  '051fc93b-2412-40a1-8f2b-9e3f56f0ddfe'
)
ON CONFLICT (id) DO NOTHING;

-- Assign super_admin role
INSERT INTO public.user_roles (user_id, barbershop_id, role)
VALUES (
  '051fc93b-2412-40a1-8f2b-9e3f56f0ddfe',
  '00000000-0000-0000-0000-000000000000',
  'super_admin'
)
ON CONFLICT DO NOTHING;