-- Limpeza dos privilégios residuais de `public` e correção do que o schema
-- afirma sobre tabelas novas.
--
-- PROBLEMA 1 — O COMENTÁRIO DO SCHEMA AFIRMA UMA GARANTIA QUE NÃO EXISTE
--
-- `20260721140000` gravou em `public`:
--
--     'Data API: privilégios concedidos nominalmente em
--      20260721140000_explicit_data_api_grants.sql. Tabelas e funções novas
--      nascem SEM acesso para anon/authenticated/service_role — conceda
--      explicitamente.'
--
-- A segunda frase é FALSA, e é a mais perigosa das duas, porque é exatamente a
-- que faria a próxima pessoa não conferir. O banco tem, hoje:
--
--     postgres       → public / r / anon:          8 privilégios (CRUD completo)
--     postgres       → public / r / authenticated: 8 privilégios
--     supabase_admin → public / r / anon:          8 privilégios
--     supabase_admin → public / r / authenticated: 8 privilégios
--
-- Ou seja: `ALTER DEFAULT PRIVILEGES` concede TUDO — inclusive
-- SELECT/INSERT/UPDATE/DELETE — em qualquer relação nova criada em `public`.
-- As 24 tabelas pertencem a `postgres`, e as migrations rodam como `postgres`
-- (verificado: `current_user` = postgres no canal de escrita). A próxima
-- `CREATE TABLE public.x` nasceria com CRUD aberto ao visitante anônimo, com
-- só a RLS entre ele e os dados, e nenhum grant nominal para alguém notar.
--
-- Isso nunca se materializou porque NENHUMA migration criou tabela depois de
-- `20260721140000` — conferido arquivo por arquivo. É defeito latente, não
-- exposição atual.
--
-- PROBLEMA 2 — RESIDUAIS EM TODAS AS 25 RELAÇÕES
--
-- As 25 relações de `public` (24 tabelas + a view `barbearias_publicas`) dão a
-- `anon` E a `authenticated` exatamente `MAINTAIN, REFERENCES, TRIGGER,
-- TRUNCATE`. Uniforme, sem exceção. A causa está escrita na própria
-- `20260721140000`:
--
--     REVOKE SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--       FROM anon, authenticated, service_role;
--
-- O `REVOKE` enumerou quatro verbos em vez de usar `ALL`, então o `GRANT ALL`
-- do bootstrap do Supabase sobreviveu no resto. O comentário daquela migration
-- registra a escolha ("Só CRUD é revogado"), então era consciente — o que
-- faltou foi fechar o ciclo.
--
-- ────────────────────────────────────────────────────────────────────────────
-- GRAVIDADE REAL DO PROBLEMA 2: HOJE, ZERO
--
-- `TRUNCATE`, `REFERENCES` e `TRIGGER` são inalcançáveis pela API, e isso é
-- estrutural, não sorte:
--
--   • o PostgREST tem mapeamento fixo de verbo HTTP para SQL — GET→SELECT,
--     POST→INSERT ou /rpc/, PATCH→UPDATE, PUT→upsert, DELETE→DELETE. Não há
--     verbo, header ou parâmetro que emita TRUNCATE, CREATE, ALTER ou DROP, e
--     não existe injeção de SQL arbitrário;
--   • `REFERENCES` e `TRIGGER` só se exercem por DDL, e `anon` não tem `CREATE`
--     no schema (só `USAGE`) nem é dono de objeto nenhum;
--   • a única via para SQL arbitrário seria uma função, e função só ativa o
--     privilégio de quem chama se for SECURITY INVOKER. Das 204 funções
--     chamáveis por `anon`, 188 são internas do `btree_gist` e as 16 do
--     aplicativo são todas SECURITY DEFINER com dono `postgres` — dentro delas
--     o privilégio do `anon` nunca é consultado. Nenhuma cita TRUNCATE, DDL ou
--     EXECUTE dinâmico;
--   • `pg_graphql` não está instalado: não há segunda superfície de consulta.
--
-- Então isto NÃO é correção de exposição. É remoção de uma capacidade latente,
-- para que ela não seja ativada por acidente no dia em que alguém criar a
-- primeira função SECURITY INVOKER pública. O problema 1 é que é sério.
--
-- ────────────────────────────────────────────────────────────────────────────
-- LIMITAÇÃO CONHECIDA: `supabase_admin` FICA COMO ESTÁ
--
-- O ideal seria zerar também o default de `supabase_admin`. Não dá, e isto foi
-- TESTADO, não presumido — o comando rodou de verdade, numa transação
-- revertida:
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--       REVOKE ALL ON TABLES FROM anon;
--     -- ERROR: 42501: permission denied to change default privileges
--
-- O motivo: `postgres` não é membro de `supabase_admin` nem é superuser
-- (`pg_has_role('postgres','supabase_admin','MEMBER')` = false,
-- `rolsuper` de postgres = false). O papel é gerenciado pela plataforma.
--
-- CONSEQUÊNCIA, EXPLÍCITA: uma relação criada em `public` POR `supabase_admin`
-- continuaria herdando os 8 privilégios. No fluxo deste projeto isso não
-- acontece — migrations rodam como `postgres` —, mas a brecha existe e não é
-- fechável daqui. Se um dia for preciso, é ticket para o suporte do Supabase.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE `service_role` NÃO ENTRA
--
-- Escopo decidido: só `anon` e `authenticated`. `service_role` é a identidade
-- do backend (rotas `/hooks/*`, chave que nunca vai ao navegador), e tirar o
-- default dele significaria que toda tabela nova fica invisível para o servidor
-- até alguém conceder — mudança de processo, não de segurança, e que merece
-- decisão própria. Ele mantém o default e os residuais.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ENSAIO FEITO ANTES DE ESCREVER (transação abortada, nada persistiu)
--
-- Os dois comandos abaixo foram executados no remoto dentro de um bloco
-- terminado em `RAISE EXCEPTION`, e o estado resultante foi medido:
--
--     relações em public ................ 25
--     com residual para anon ............  0   (era 25)
--     com residual para authenticated ...  0   (era 25)
--     anon com SELECT ...................  5   (inalterado)
--     anon com INSERT ...................  1   (inalterado, contact_submissions)
--     authenticated com SELECT .......... 25   (inalterado)
--     default ACL restante .............. só supabase_admin→* e postgres→service_role
--
-- `REVOKE` de privilégios nomeados não toca os demais: por isso os grants
-- nominais de `20260721140000` atravessam intactos.
--
-- ────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÕES OBRIGATÓRIAS APÓS APLICAR
--
--   • nenhuma relação de public dá TRUNCATE/REFERENCES/TRIGGER/MAINTAIN a
--     `anon` ou a `authenticated`:
--       SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--        WHERE n.nspname='public' AND c.relkind IN ('r','v')
--          AND (has_table_privilege('anon',c.oid,'TRUNCATE')
--            OR has_table_privilege('anon',c.oid,'REFERENCES')
--            OR has_table_privilege('anon',c.oid,'TRIGGER')
--            OR has_table_privilege('anon',c.oid,'MAINTAIN'));   -- => 0
--     (repetir trocando 'anon' por 'authenticated')              -- => 0
--
--   • os grants corretos sobrevivem — `anon` com SELECT em exatamente 5
--     relações (availability, barbearias_publicas, plans, reviews, services) e
--     INSERT em exatamente 1 (contact_submissions); `authenticated` com SELECT
--     nas 25;
--
--   • `pg_default_acl` não tem mais entrada de `postgres` para anon/
--     authenticated em public/r — só `postgres→service_role` e as três de
--     `supabase_admin`;
--
--   • `service_role` INTACTO: continua com os privilégios de
--     20260721140000/20260722250000, senão as rotas de cron quebram;
--
--   • como anon, contra a API: /barbearias, /agendar e /agendar/$slug
--     continuam carregando, e o formulário de /contato continua gravando —
--     é o que prova que SELECT e INSERT nominais não foram atingidos;
--
--   • como cliente, barbeiro e admin autenticados: as telas internas continuam
--     lendo e escrevendo normalmente.
--
-- ROLLBACK
--
--   GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public
--     TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated;
--   COMMENT ON SCHEMA public IS
--     'Data API: privilégios concedidos nominalmente em 20260721140000_explicit_data_api_grants.sql. Tabelas e funções novas nascem SEM acesso para anon/authenticated/service_role — conceda explicitamente.';
--
-- Reverter é seguro: devolve exatamente o estado de hoje. Mas note que a última
-- linha reporia uma afirmação que já se sabe falsa.
-- ============================================================================

/* ═══════════ 1. tabelas FUTURAS deixam de herdar acesso ═══════════════════ */

-- A causa do problema 1. Sem isto, o `REVOKE` do bloco 2 limpa o presente e o
-- passado, e a próxima tabela nasce aberta de novo.
--
-- `FOR ROLE postgres` porque é esse o dono das 24 tabelas e o papel sob o qual
-- as migrations rodam. `supabase_admin` fica de fora por impossibilidade
-- técnica — ver o cabeçalho.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

/* ═══════════ 2. tabelas EXISTENTES perdem o residual ══════════════════════ */

-- Os quatro que o `REVOKE` de 20260721140000 não enumerou. Vale para as 25
-- relações de uma vez, inclusive a view `barbearias_publicas`.
--
-- `MAINTAIN` exige PostgreSQL 17+; o projeto está em 17.6 (server_version_num
-- 170006, reconfirmado no momento de escrever). Num servidor anterior este
-- comando falha na análise sintática — se algum dia esta migration for
-- reaplicada num banco mais antigo, remova a palavra.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

/* ═══════════ 3. o schema passa a dizer a verdade ══════════════════════════ */

COMMENT ON SCHEMA public IS
  'Data API: privilégios de anon/authenticated são concedidos NOMINALMENTE — '
  'ver 20260721140000_explicit_data_api_grants.sql e as migrations de '
  'superfície pública. Desde 20260805150000, tabela nova NÃO nasce acessível a '
  'anon/authenticated: o ALTER DEFAULT PRIVILEGES de `postgres` foi zerado para '
  'esses dois papéis. RESSALVAS: (1) `service_role` mantém o default e recebe '
  'os 8 privilégios em toda tabela nova, de propósito — é a identidade do '
  'backend. (2) o default de `supabase_admin` NÃO é alterável por `postgres` '
  '(42501), então relação criada por ele em public ainda herdaria tudo. Ao '
  'criar tabela, conceda a anon/authenticated explicitamente, e confira com '
  'has_table_privilege em vez de confiar neste comentário.';
