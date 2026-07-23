-- ============================================================================
-- Privilégios DML de service_role para o seed administrativo de teste
-- ----------------------------------------------------------------------------
-- PROBLEMA
--
-- O seed administrativo (`scripts/seed-barbaflow-test.mjs`) e o seu cleanup
-- rodam como `service_role`. service_role tem BYPASSRLS, mas o Postgres ainda
-- verifica o privilégio de TABELA antes de qualquer policy — sem GRANT, a
-- escrita falha com `42501 permission denied for table`.
--
-- CAUSA (por que os privilégios sumiram)
--
--   * 20260721140000_explicit_data_api_grants.sql zerou o CRUD de service_role
--     (`REVOKE SELECT,INSERT,UPDATE,DELETE ON ALL TABLES ... FROM service_role`)
--     e reconcedeu SÓ o que os consumidores de backend auditados à época
--     usavam (webhooks, delete-account, cron). Para `profiles`, concedeu apenas
--     `SELECT, DELETE`; para o catálogo/agenda (services, products,
--     weekly_schedule, availability, schedule_blocks), NADA; para barbershops e
--     appointments, sem INSERT/DELETE; para user_roles, sem INSERT.
--   * 20260722120000_cleanup_profile_on_auth_user_delete.sql revogou o DELETE
--     de `profiles` (`REVOKE DELETE ON public.profiles FROM service_role`),
--     deixando service_role com apenas SELECT em profiles — a falha relatada.
--
-- CORREÇÃO
--
-- O seed é um NOVO fluxo de backend administrativo. Seguindo a regra que a
-- própria 20260721140000 documenta ("um fluxo de backend novo exige acrescentar
-- o GRANT correspondente aqui"), concedemos a service_role exatamente o DML que
-- o seed e o cleanup executam em cada tabela — nada além.
--
-- ESCOPO / SEGURANÇA
--
--   * mexe SÓ em GRANTs de service_role (papel de servidor, usado apenas com a
--     chave secreta — nunca no frontend);
--   * NÃO altera nenhuma policy de `anon` ou `authenticated`;
--   * NÃO concede nada a anon/authenticated;
--   * RLS continua habilitada e inalterada em todas as tabelas;
--   * sem ALTER DEFAULT PRIVILEGES: tabelas futuras continuam fechadas.
--
-- GRANT é idempotente; segura em base vazia e reprodutível após `db reset`.
-- Posterior a 20260722240000. Não altera nenhuma migration anterior.
-- ============================================================================

-- Perfis: escritos pelo seed (upsert = INSERT/UPDATE) e removidos pelo cleanup
-- (DELETE). SELECT já existia. É o privilégio explicitamente pedido.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO service_role;

-- Barbearias: upsert (INSERT) e remoção no cleanup (DELETE). Já tinha SELECT, UPDATE.
GRANT INSERT, DELETE ON TABLE public.barbershops TO service_role;

-- Papéis: inseridos pelo seed (INSERT). Já tinha SELECT, DELETE (removidos por
-- cascade da barbearia no cleanup).
GRANT INSERT ON TABLE public.user_roles TO service_role;

-- Agendamentos: inseridos pelo seed (INSERT) e removidos pelo cleanup (DELETE).
-- Já tinha SELECT, UPDATE.
GRANT INSERT, DELETE ON TABLE public.appointments TO service_role;

-- Catálogo e agenda: nenhum CRUD para service_role até aqui.
--   services/products  → upsert (INSERT+UPDATE) + contagem (SELECT) + cleanup (DELETE)
--   weekly_schedule/availability → upsert DO NOTHING (INSERT) + SELECT + cleanup (DELETE)
--   schedule_blocks    → só o cleanup (SELECT + DELETE)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.services        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.products        TO service_role;
GRANT SELECT, INSERT, DELETE         ON TABLE public.weekly_schedule TO service_role;
GRANT SELECT, INSERT, DELETE         ON TABLE public.availability     TO service_role;
GRANT SELECT, DELETE                 ON TABLE public.schedule_blocks TO service_role;
