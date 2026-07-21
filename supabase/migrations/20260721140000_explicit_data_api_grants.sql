-- ============================================================================
-- Privilégios explícitos do Data API (PostgREST)
-- ----------------------------------------------------------------------------
-- PROBLEMA CORRIGIDO (auditoria pré-push)
--
-- GRANT e RLS são camadas DIFERENTES. O Postgres verifica primeiro o
-- privilégio de tabela; só depois aplica as policies. Uma tabela com RLS
-- perfeita e sem GRANT devolve `42501 permission denied for table` antes de
-- qualquer policy ser avaliada.
--
-- Estado auditado no banco local (CLI 2.109.1), em `pg_class.relacl`:
--
--     barbershops | anon=Dxtm/postgres  authenticated=Dxtm/postgres
--                 | service_role=Dxtm/postgres
--
-- `Dxtm` = TRUNCATE, REFERENCES, TRIGGER, MAINTAIN. **Nenhum SELECT, INSERT,
-- UPDATE ou DELETE** para os três papéis do Data API — nas 24 tabelas de
-- `public`. A causa é o ALTER DEFAULT PRIVILEGES do papel `postgres` no schema
-- `public` deste stack:
--
--     postgres | public | r | {postgres=arwdDxtm/postgres, anon=Dxtm/postgres,
--                              authenticated=Dxtm/postgres, service_role=Dxtm/postgres}
--
-- Nenhuma das 60 migrations existentes concede CRUD. A única exceção é
-- `GRANT SELECT ON public.barbearias_publicas TO anon, authenticated`
-- (migration 20260420115631) — que sozinha nem funcionaria, porque a view é
-- `security_invoker=true` e portanto exige SELECT em `public.barbershops`
-- para o papel que consulta.
--
-- Sem esta migration, o primeiro `db push` publica um schema em que **todo o
-- aplicativo devolve 42501**: nenhuma página pública, nenhum login útil,
-- nenhum agendamento, nenhuma Edge Function.
--
-- ----------------------------------------------------------------------------
-- CRITÉRIO DE MÍNIMO PRIVILÉGIO
--
-- Regra base: um papel recebe uma operação em uma tabela **somente quando já
-- existe uma POLICY que autoriza aquele papel naquela operação**. A policy é a
-- declaração do próprio schema de que o fluxo existe; o GRANT apenas deixa de
-- barrá-lo antes da hora. A RLS continua sendo, integralmente, a barreira por
-- linha — este arquivo não relaxa nenhuma policy.
--
-- Exceções deliberadas (mais restritivas que o espelho das policies):
--
--   * subscriptions — a policy `FOR ALL` existente é `TO public` com
--     `USING (auth.role() = 'service_role')`. Espelhá-la daria INSERT/UPDATE/
--     DELETE a anon e authenticated (bloqueados pela RLS, mas ainda assim
--     concedidos). O cliente recebe **apenas SELECT**; a escrita é exclusiva
--     do service_role (webhook do Paddle).
--
--   * user_roles — a policy de UPDATE existe, mas nenhum caminho do aplicativo
--     a usa (TeamManager troca papel com DELETE + INSERT). UPDATE **não é
--     concedido** a authenticated: promoção/rebaixamento de papel via API fica
--     fechada. Se um dia existir tela de "alterar papel", basta um GRANT.
--
--   * plans — a policy `FOR ALL TO authenticated` (super_admin gerencia
--     planos) não tem tela correspondente. Concedemos **apenas SELECT**.
--
--   * anon — recebe só o que os fluxos realmente públicos usam: leitura da
--     vitrine/página de agendamento e envio do formulário de contato.
--
-- Nenhum `GRANT ALL`. Nenhum `ALTER DEFAULT PRIVILEGES`: tabelas criadas por
-- migrations futuras continuam fechadas por padrão e precisam de GRANT
-- explícito — que é exatamente o comportamento desejado.
--
-- Idempotente (GRANT/REVOKE são idempotentes) e reprodutível após
-- `db reset`. Posterior a 20260721130000.
-- ============================================================================

-- ------------------------------------------------------------------
-- 0) Uso do schema + ponto de partida determinístico
-- ------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Zeramos o CRUD antes de conceder. Sem isto o estado final dependeria do
-- ALTER DEFAULT PRIVILEGES de cada projeto: no stack local (restritivo) a
-- migration só somaria; num projeto com defaults permissivos
-- (`anon=arwdDxtm`) as tabelas continuariam abertas no nível de GRANT e o
-- remoto ficaria MAIS permissivo que o local — exatamente a divergência
-- silenciosa que não pode existir antes do primeiro push.
--
-- REVOKE + GRANT nominal torna o resultado idêntico em qualquer projeto e
-- reprodutível a cada `db reset`. Só CRUD é revogado; TRUNCATE/REFERENCES/
-- TRIGGER/MAINTAIN e os privilégios de `postgres` ficam intactos.
REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated, service_role;

-- Não há SEQUENCES em `public` (todas as PKs são uuid/gen_random_uuid()),
-- portanto nenhum GRANT USAGE/SELECT de sequence é necessário. Verificado:
--   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='public' AND c.relkind='S';  -- => 0

-- O schema `storage` é gerenciado pelo Supabase e já possui os privilégios e
-- as policies próprias dos buckets (avatars, logos). Não é tocado aqui.
-- O schema `auth` não é tocado.

/* ===========================================================================
 * 1) anon — somente os fluxos públicos
 * ---------------------------------------------------------------------------
 * Vitrine (`/`) e página pública de agendamento (`/agendar/$slug`). Todas as
 * tabelas abaixo têm policy de SELECT com role `public`, que restringe a
 * linhas de barbearias `approved`.
 * ======================================================================== */
GRANT SELECT ON TABLE
  public.barbershops,          -- exigido também pela view security_invoker
  public.services,
  public.availability,
  public.products,
  public.reviews,
  public.plans
TO anon;

-- Vitrine pública (view security_invoker sobre barbershops WHERE approved).
GRANT SELECT ON TABLE public.barbearias_publicas TO anon;

-- Formulário de contato da landing (policy de INSERT já inclui anon).
GRANT INSERT ON TABLE public.contact_submissions TO anon;

/* ===========================================================================
 * 2) authenticated — operações realmente usadas pelo aplicativo
 * ======================================================================== */

-- Leitura pública continua valendo para quem está logado.
GRANT SELECT ON TABLE
  public.barbershops,
  public.barbearias_publicas,
  public.services,
  public.availability,
  public.products,
  public.reviews,
  public.plans
TO authenticated;

-- Perfil próprio (INSERT existe para o caso de o trigger handle_new_user não
-- ter criado a linha; DELETE é exclusivo do processo de exclusão de conta).
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

-- Equipe/vínculos. Sem UPDATE: troca de papel é DELETE + INSERT.
GRANT SELECT, INSERT, DELETE ON TABLE public.user_roles TO authenticated;

-- Onboarding e configurações da barbearia (plan_id/status continuam barrados
-- pelo trigger trg_enforce_barbershop_plan, não pelo GRANT).
GRANT INSERT, UPDATE, DELETE ON TABLE public.barbershops TO authenticated;

-- Catálogo e agenda administrados pela barbearia.
GRANT INSERT, UPDATE, DELETE ON TABLE
  public.services,
  public.products,
  public.availability
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.weekly_schedule,
  public.schedule_blocks,
  public.appointments,
  public.tickets,
  public.ticket_items,
  public.client_notes,
  public.client_blocks,
  public.team_invitations,
  public.payment_methods,
  public.notifications
TO authenticated;

-- ticket_payments não tem policy de UPDATE (pagamento lançado não se edita).
GRANT SELECT, INSERT, DELETE ON TABLE public.ticket_payments TO authenticated;

-- Avaliações do cliente + resposta da barbearia.
GRANT INSERT, UPDATE, DELETE ON TABLE public.reviews TO authenticated;

-- Contato: o autor não relê o próprio envio; super_admin lê pelo painel.
GRANT SELECT, INSERT ON TABLE public.contact_submissions TO authenticated;

-- Histórico de planos: leitura e escrita restritas a super_admin pela RLS
-- (AdminDashboard). Um cliente comum recebe erro de policy, não de privilégio.
GRANT SELECT, INSERT ON TABLE public.plan_change_logs TO authenticated;

-- Assinatura: leitura da própria (policy auth.uid() = user_id). Escrita é
-- exclusiva do backend — ver exceção documentada no cabeçalho.
GRANT SELECT ON TABLE public.subscriptions TO authenticated;

-- Exclusão de conta: o usuário consulta o próprio agendamento de exclusão
-- (perfil.tsx) e o super_admin lê o feedback anônimo (admin.churn.tsx).
-- Agendar/cancelar passa pelas Edge Functions, nunca direto pelo cliente.
GRANT SELECT, UPDATE ON TABLE public.account_deletions TO authenticated;
GRANT SELECT ON TABLE public.account_deletion_feedback TO authenticated;

/* ===========================================================================
 * 3) service_role — Edge Functions e rotinas administrativas
 * ---------------------------------------------------------------------------
 * service_role tem BYPASSRLS: as policies não se aplicam, mas o privilégio de
 * TABELA continua sendo verificado. Sem estes GRANTs, todo webhook e toda
 * rotina de backend falham com 42501.
 *
 * Consumidores auditados:
 *   payments-webhook          → subscriptions, plans, barbershops
 *   delete-account            → barbershops, user_roles, appointments,
 *                               account_deletions
 *   cancel-account-deletion   → account_deletions
 *   create-portal-session     → subscriptions
 *   /hooks/process-account-deletions (cron) → account_deletions, reviews,
 *                               appointments, notifications, client_blocks,
 *                               user_roles, profiles, account_deletion_feedback
 *
 * Um fluxo de backend novo exige acrescentar o GRANT correspondente aqui.
 * ======================================================================== */
GRANT SELECT, INSERT, UPDATE ON TABLE public.subscriptions     TO service_role;
GRANT SELECT                 ON TABLE public.plans             TO service_role;
GRANT SELECT, UPDATE         ON TABLE public.barbershops       TO service_role;
GRANT SELECT, DELETE         ON TABLE public.user_roles        TO service_role;
GRANT SELECT, UPDATE         ON TABLE public.appointments      TO service_role;
GRANT SELECT, UPDATE         ON TABLE public.reviews           TO service_role;
GRANT SELECT, DELETE         ON TABLE public.notifications     TO service_role;
GRANT SELECT, DELETE         ON TABLE public.client_blocks     TO service_role;
GRANT SELECT, DELETE         ON TABLE public.profiles          TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletions TO service_role;
GRANT SELECT, INSERT         ON TABLE public.account_deletion_feedback TO service_role;

/* ===========================================================================
 * 4) Funções — fechar PUBLIC e abrir só para o consumidor real
 * ---------------------------------------------------------------------------
 * O padrão do Postgres para funções é EXECUTE para PUBLIC. A auditoria de
 * `pg_proc.proacl` mostrou 28 das 32 funções de `public` nesse estado —
 * inclusive SECURITY DEFINER sensíveis como `create_walkin_client`,
 * `get_client_phone`, `get_barbershop_clients` e `accept_team_invitation`,
 * todas chamáveis por `anon` via `POST /rest/v1/rpc/...`.
 *
 * Fechamos tudo e reabrimos nominalmente. Triggers NÃO são afetados: o
 * Postgres verifica EXECUTE na criação do trigger, não a cada disparo. Funções
 * chamadas de dentro de outra SECURITY DEFINER também não são afetadas —
 * executam como o dono (postgres).
 * ======================================================================== */
DO $$
DECLARE _f record;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      _f.sig);
  END LOOP;
END$$;

-- --- exigidas pela AVALIAÇÃO DAS POLICIES -------------------------------
-- Expressões de policy rodam com os privilégios de quem consulta. As policies
-- de SELECT com role `public` em barbershops/services/availability/products
-- referenciam has_role(), então anon precisa de EXECUTE — sem isso a página
-- pública quebra.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role_in_barbershop(uuid, uuid, public.app_role)
  TO authenticated;
-- WITH CHECK da policy de INSERT em appointments.
GRANT EXECUTE ON FUNCTION public.check_appointment_limit(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_client_noshow_block(uuid, uuid) TO authenticated;

-- --- RPCs realmente chamadas pelo frontend ------------------------------
-- Página pública de agendamento (antes do login).
GRANT EXECUTE ON FUNCTION public.get_public_barbers(uuid)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_barber_display_names(uuid[])  TO anon, authenticated;
-- Área logada.
GRANT EXECUTE ON FUNCTION public.accept_team_invitation(uuid)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_walkin_client(uuid, text, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_availability_from_schedule(uuid, uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_phone(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_noshow_report(uuid, integer)          TO authenticated;

-- --- permanecem SEM exposição (uso interno) -----------------------------
--   * triggers: enforce_barbershop_plan, enforce_barber_limit,
--     enforce_last_barbershop_admin, enforce_pinned_notes_limit,
--     handle_new_user, increment_appointment_counter, notify_*,
--     recalc_barbershop_rating, seed_default_payment_methods,
--     adjust_product_stock_on_ticket, update_updated_at_column;
--   * auxiliares: role_counts_toward_barber_limit, is_trusted_backend,
--     barbershop_is_system_sentinel;
--   * não consumidas pelo aplicativo: check_barber_limit,
--     get_barbershop_clients, has_active_subscription.
-- Nenhuma função de promoção de papel, plano ou autorização foi exposta além
-- do estritamente exigido pelas policies acima.

COMMENT ON SCHEMA public IS
  'Data API: privilégios concedidos nominalmente em 20260721140000_explicit_data_api_grants.sql. Tabelas e funções novas nascem SEM acesso para anon/authenticated/service_role — conceda explicitamente.';
