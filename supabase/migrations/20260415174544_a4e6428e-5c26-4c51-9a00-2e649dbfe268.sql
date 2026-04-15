
-- Create team invitations table
CREATE TABLE public.team_invitations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'barbeiro',
  invited_by UUID NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  UNIQUE (barbershop_id, email, status)
);

-- Enable RLS
ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

-- Admins of the barbershop can view invitations
CREATE POLICY "Barbershop admins can view invitations"
ON public.team_invitations
FOR SELECT
TO authenticated
USING (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
);

-- Admins can create invitations
CREATE POLICY "Barbershop admins can create invitations"
ON public.team_invitations
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
);

-- Admins can cancel invitations
CREATE POLICY "Barbershop admins can update invitations"
ON public.team_invitations
FOR UPDATE
TO authenticated
USING (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
);

-- Admins can delete invitations
CREATE POLICY "Barbershop admins can delete invitations"
ON public.team_invitations
FOR DELETE
TO authenticated
USING (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
);

-- Create function to accept invitation
CREATE OR REPLACE FUNCTION public.accept_team_invitation(_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _invitation RECORD;
  _user_id UUID;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Não autenticado');
  END IF;

  SELECT * INTO _invitation
  FROM public.team_invitations
  WHERE token = _token AND status = 'pending'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Convite não encontrado ou expirado');
  END IF;

  IF _invitation.expires_at < now() THEN
    UPDATE public.team_invitations SET status = 'expired', updated_at = now() WHERE id = _invitation.id;
    RETURN jsonb_build_object('success', false, 'error', 'Convite expirado');
  END IF;

  -- Verify email matches
  IF _invitation.email != (SELECT email FROM auth.users WHERE id = _user_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Este convite não é para o seu email');
  END IF;

  -- Add role
  INSERT INTO public.user_roles (user_id, barbershop_id, role)
  VALUES (_user_id, _invitation.barbershop_id, _invitation.role)
  ON CONFLICT DO NOTHING;

  -- Mark as accepted
  UPDATE public.team_invitations SET status = 'accepted', updated_at = now() WHERE id = _invitation.id;

  RETURN jsonb_build_object('success', true, 'barbershop_id', _invitation.barbershop_id);
END;
$$;

-- Add trigger for updated_at
CREATE TRIGGER update_team_invitations_updated_at
BEFORE UPDATE ON public.team_invitations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Allow admins to remove team members (delete from user_roles)
CREATE POLICY "Barbershop admins can remove team members"
ON public.user_roles
FOR DELETE
TO authenticated
USING (
  public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  AND user_id != auth.uid()
);
