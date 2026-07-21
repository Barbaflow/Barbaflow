-- ============================================================================
-- Exclusão de usuário no Auth: anonimizar o profile em vez de deixá-lo órfão
-- ----------------------------------------------------------------------------
-- PROBLEMA CORRIGIDO (auditoria pós-push)
--
-- `public.profiles` não tem mais chave estrangeira para `auth.users`: a
-- migration 20260428191551 executou
--
--     ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_user_id_fkey;
--
-- três minutos depois de `create_walkin_client()` passar a inserir perfis com
-- `gen_random_uuid()` — clientes de balcão, que por definição não têm conta no
-- Auth. A remoção era necessária e continua sendo.
--
-- O efeito colateral é que apagar um usuário REAL deixa de propagar qualquer
-- coisa para `profiles`. `user_roles` some por CASCADE e `barbershops.owner_id`
-- vira NULL, mas o perfil permanece com `full_name`, `phone` e `avatar_url`.
-- O fluxo próprio da aplicação (`/hooks/process-account-deletions`) apagava o
-- perfil explicitamente, mas qualquer exclusão feita FORA dele — painel do
-- Supabase, Auth Admin API, `supabase.auth.admin.deleteUser` de um script —
-- deixava dado pessoal para trás, sem nenhuma barreira no banco.
--
-- Verificado no schema aplicado: 8 perfis sobreviveram a `auth.users = 0` nos
-- testes locais da sessão anterior.
--
-- ----------------------------------------------------------------------------
-- POR QUE ANONIMIZAR E NÃO APAGAR
--
-- Nenhuma tabela tem FK para `public.profiles` — apagar a linha não violaria
-- integridade referencial. Mas praticamente todas as referências a pessoas no
-- schema são uuid SOLTO, sem FK:
--
--     appointments.client_id / barber_id      reviews.client_id / replied_by
--     tickets.client_id / barber_id / closed_by
--     client_notes.client_id / created_by     client_blocks.client_id
--     notifications.user_id                   team_invitations.invited_by
--
-- O nome exibido em todas essas telas é resolvido em `profiles`. Apagar a
-- linha não quebra o banco: quebra o HISTÓRICO da barbearia — comandas,
-- faturamento por cliente, relatório de faltas e avaliações passariam a
-- apontar para um autor inexistente, sem forma de recuperação.
--
-- Anonimizar preserva a coerência desse histórico (que é dado da barbearia,
-- não do titular) e elimina o que de fato identifica a pessoa. É a opção
-- indicada quando apagar "deixaria referências sem autor" ou "impediria
-- relatórios históricos".
--
-- ----------------------------------------------------------------------------
-- O QUE É ANONIMIZADO
--
-- Somente colunas que existem de fato em `public.profiles`
-- (id, user_id, full_name, avatar_url, created_at, updated_at, phone):
--
--   full_name  → 'Conta excluída · <8 hex do user_id>'
--   phone      → NULL
--   avatar_url → NULL
--
-- Não há colunas de email, username ou endereço nesta tabela, e o e-mail
-- original NUNCA é lido: o rótulo deriva apenas de `OLD.id`, é determinístico
-- e não permite reidentificação além do que o próprio `user_id` — que precisa
-- ser preservado para o histórico — já expõe. O sufixo existe para que dois
-- clientes excluídos não colapsem no mesmo nome nos relatórios.
--
-- `user_id` é preservado: é a única ligação entre o histórico e o perfil, e é
-- o campo UNIQUE da tabela. Mantê-lo intacto elimina qualquer risco de colisão
-- de unicidade na anonimização.
--
-- O avatar recebe tratamento à parte: o bucket `avatars` é PÚBLICO e o caminho
-- é determinístico (`<user_id>/avatar.<ext>`). Zerar apenas a coluna deixaria a
-- foto acessível por URL a quem conhecesse o `user_id` — que segue visível em
-- `profiles` e em `appointments`. Por isso a linha correspondente em
-- `storage.objects` também é removida, tornando o arquivo inalcançável pela
-- API de Storage.
--
-- ----------------------------------------------------------------------------
-- WALK-INS
--
-- O gatilho é `AFTER DELETE ON auth.users FOR EACH ROW` e só toca a linha cujo
-- `user_id = OLD.id`. Um perfil de balcão tem `user_id` gerado por
-- `gen_random_uuid()` e nunca corresponde a um usuário do Auth, logo jamais é
-- alcançado. Nenhuma FK obrigatória é criada, nenhum perfil passa a exigir
-- conta no Auth e `create_walkin_client()` segue idêntica.
--
-- ----------------------------------------------------------------------------
-- INTERAÇÃO COM A PROTEÇÃO DO ÚLTIMO ADMIN
--
-- Apagar um usuário do Auth é uma transação só. Nela:
--   1. CASCADE remove as linhas de `user_roles` do usuário;
--   2. SET NULL zera `barbershops.owner_id`;
--   3. este gatilho anonimiza o perfil;
--   4. no COMMIT, o constraint trigger diferido
--      `trg_protect_last_barbershop_admin` valida o estado final.
--
-- Se o usuário era o último `admin_barbearia` de uma barbearia existente, o
-- passo 4 levanta `restrict_violation` e TODA a transação volta atrás — papéis,
-- owner_id e a anonimização. Nada fica pela metade. A atomicidade é do
-- Postgres, não deste arquivo: por isso a anonimização não precisa (e não deve)
-- ser diferida nem rodar em transação própria.
--
-- Idempotente: coluna com IF NOT EXISTS, função com CREATE OR REPLACE, gatilho
-- criado só se ainda não existir, e o UPDATE ignora perfis já anonimizados.
-- Posterior a 20260721140000. Nenhuma migration anterior é alterada.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1) Marcador de anonimização
-- ------------------------------------------------------------------
-- Torna o estado auditável sem depender de casar string em `full_name` (um
-- cliente de balcão poderia, em tese, se chamar "Conta excluída"). Serve de
-- evidência de tratamento e de guarda de idempotência.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

COMMENT ON COLUMN public.profiles.anonymized_at IS
  'Quando preenchido, o titular foi removido de auth.users e os dados pessoais deste perfil já foram anonimizados. A linha é mantida apenas para dar autor ao histórico da barbearia.';

-- ------------------------------------------------------------------
-- 2) Rotina de anonimização
-- ------------------------------------------------------------------
-- SECURITY DEFINER é necessário: quem executa o DELETE em `auth.users` é o
-- GoTrue, conectado como `supabase_auth_admin`, que não tem nenhum privilégio
-- em `public.profiles` (a migration 20260721140000 concedeu CRUD apenas a
-- anon/authenticated/service_role). Sem SECURITY DEFINER o gatilho falharia
-- com 42501 e impediria qualquer exclusão de conta.
CREATE OR REPLACE FUNCTION public.anonymize_profile_on_auth_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _label text;
BEGIN
  -- Rótulo determinístico, derivado só do id do usuário — nunca do e-mail.
  _label := 'Conta excluída · ' || left(replace(OLD.id::text, '-', ''), 8);

  UPDATE public.profiles p
     SET full_name     = _label,
         phone         = NULL,
         avatar_url    = NULL,
         anonymized_at = now()
   WHERE p.user_id = OLD.id
     AND p.anonymized_at IS NULL;

  -- Foto de perfil ------------------------------------------------------
  -- O bucket `avatars` é PÚBLICO e o caminho é determinístico
  -- (`<user_id>/avatar.<ext>`, ver ProfilePhotoUpload). Zerar só a coluna
  -- deixaria a foto acessível por URL a quem conhecesse o `user_id` — que
  -- continua visível em `profiles` e em `appointments`. Como é justamente o
  -- caso de exclusão feita FORA do fluxo da aplicação que esta migration
  -- existe para cobrir, a linha em `storage.objects` também sai.
  --
  -- O Supabase protege essas tabelas com `storage.protect_delete()`
  -- (BEFORE DELETE FOR EACH STATEMENT, ERRCODE 42501) para evitar remoções
  -- acidentais, e oferece a própria válvula documentada:
  -- `storage.allow_delete_query`. Usamos com `is_local => true`, restrita a
  -- esta transação, e restauramos logo em seguida.
  --
  -- Contrapartida assumida: o objeto físico vira lixo até a coleta do
  -- Storage. O arquivo deixa de ser acessível pela API — que é o objetivo de
  -- privacidade — ao custo de bytes órfãos. O fluxo próprio da aplicação
  -- continua removendo o arquivo pela Storage API, do jeito correto.
  --
  -- O EXCEPTION é uma rede de segurança estreita: se uma versão futura do
  -- Storage endurecer a regra, a exclusão da conta continua funcionando (o
  -- dado sensível de `profiles` já foi anonimizado acima) e o operador é
  -- avisado, em vez de toda remoção de usuário passar a falhar.
  BEGIN
    PERFORM set_config('storage.allow_delete_query', 'true', true);
    DELETE FROM storage.objects o
     WHERE o.bucket_id = 'avatars'
       AND (storage.foldername(o.name))[1] = OLD.id::text;
    PERFORM set_config('storage.allow_delete_query', 'false', true);
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM set_config('storage.allow_delete_query', 'false', true);
      RAISE WARNING
        'Perfil anonimizado, mas o avatar em storage.objects não pôde ser removido: %', SQLERRM;
  END;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.anonymize_profile_on_auth_user_delete() IS
  'Gatilho de auth.users: ao excluir um usuário real, remove os dados pessoais do profile correspondente e preserva a linha para manter o histórico da barbearia com autor. Não afeta perfis walk-in.';

-- Uso exclusivo do gatilho. O Postgres verifica EXECUTE na CRIAÇÃO do trigger,
-- não a cada disparo, então fechar a função não afeta o funcionamento — e
-- impede que ela seja chamada como RPC pelo Data API.
REVOKE ALL ON FUNCTION public.anonymize_profile_on_auth_user_delete()
  FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 3) Gatilho em auth.users
-- ------------------------------------------------------------------
-- Criado condicionalmente em vez de `DROP TRIGGER IF EXISTS` + `CREATE`:
-- `auth.users` pertence a `supabase_auth_admin`, e o papel `postgres` que
-- aplica as migrations tem privilégio TRIGGER mas não é o dono. DROP TRIGGER
-- exige ownership, então o par drop+create poderia falhar em um projeto onde
-- o Supabase restrinja mais o schema `auth`. Como toda a lógica vive na função
-- (substituível por CREATE OR REPLACE), a definição do gatilho é estável e
-- criá-lo uma única vez basta.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'on_auth_user_deleted'
      AND tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_deleted
      AFTER DELETE ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.anonymize_profile_on_auth_user_delete();
  END IF;
END$$;

-- ------------------------------------------------------------------
-- 4) Privilégio que deixou de ter consumidor
-- ------------------------------------------------------------------
-- `DELETE` em `public.profiles` foi concedido a service_role em
-- 20260721140000 por causa de um único consumidor: a linha
-- `admin.from("profiles").delete()` em `/hooks/process-account-deletions`.
-- Essa linha saiu junto com esta migration — o profile agora é anonimizado
-- pelo gatilho, não apagado. Sem consumidor, o privilégio volta a ser
-- retirado, mantendo a matriz de grants fiel ao uso real. `SELECT` continua.
REVOKE DELETE ON TABLE public.profiles FROM service_role;
