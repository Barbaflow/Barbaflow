-- ============================================================================
-- BOOTSTRAP MANUAL DO SUPER_ADMIN  —  NÃO É EXECUTADO AUTOMATICAMENTE
-- ----------------------------------------------------------------------------
-- Este arquivo vive FORA de supabase/migrations, então `supabase db push`
-- NUNCA o executa. Rode-o À MÃO, UMA ÚNICA VEZ, e SOMENTE depois que o
-- primeiro usuário administrativo REAL já existir no Supabase Auth do projeto.
--
-- Ele cria/atualiza a barbearia sentinela `_system` (que ancora papéis globais)
-- e concede o papel `super_admin` a um usuário JÁ EXISTENTE em auth.users,
-- localizado pelo e-mail. Nenhum usuário é criado aqui; nenhum UUID/e-mail real
-- fica versionado (apenas um placeholder que falha de propósito).
--
-- COMO EXECUTAR (exemplo — troque o e-mail pelo do seu admin já criado):
--
--   psql "$DATABASE_URL" \
--     -v admin_email='voce@seu-dominio.com' \
--     -f supabase/bootstrap/super-admin.example.sql
--
--   (ou edite o \set abaixo antes de rodar)
--
-- A senha/URL do banco NÃO deve ser digitada dentro deste arquivo nem colada
-- em histórico de comando versionado — use uma variável de ambiente.
-- ============================================================================

-- Placeholder proposital: se não for sobrescrito (-v admin_email=... ou edição
-- abaixo), o script ABORTA — evita promoção acidental.
\set admin_email 'REPLACE_WITH_ADMIN_EMAIL'

BEGIN;

DO $$
DECLARE
  _email text := :'admin_email';
  _uid   uuid;
  _system_id constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  -- 1) Guard contra execução acidental / sem configurar.
  IF _email IS NULL OR btrim(_email) = '' OR _email = 'REPLACE_WITH_ADMIN_EMAIL' THEN
    RAISE EXCEPTION
      'Defina o e-mail do admin antes de rodar: -v admin_email=voce@dominio.com (ou edite o \set admin_email).';
  END IF;

  -- 2) Exige um usuário JÁ EXISTENTE em auth.users (não cria ninguém).
  SELECT id INTO _uid FROM auth.users WHERE email = _email;
  IF _uid IS NULL THEN
    RAISE EXCEPTION
      'Usuário "%" não encontrado em auth.users. Crie-o primeiro no Supabase Auth e rode novamente.',
      _email;
  END IF;

  -- 3) Sentinela `_system` (owner_id = usuário real). Idempotente.
  INSERT INTO public.barbershops (id, name, subdomain, status, owner_id)
  VALUES (_system_id, '_system', '_system', 'approved', _uid)
  ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id;

  -- 4) Papel super_admin, sem duplicar (UNIQUE user_id, barbershop_id, role).
  INSERT INTO public.user_roles (user_id, barbershop_id, role)
  VALUES (_uid, _system_id, 'super_admin')
  ON CONFLICT (user_id, barbershop_id, role) DO NOTHING;

  RAISE NOTICE 'super_admin configurado para % (%).', _email, _uid;
END $$;

COMMIT;
