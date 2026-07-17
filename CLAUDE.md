# CLAUDE.md — Regras do projeto BarbaFlow Pro

Guia para agentes/IA e pessoas desenvolvedoras. Leia antes de alterar qualquer
funcionalidade.

## Visão geral

SaaS multi-tenant de gestão de barbearias (agendamento, agenda, clientes,
serviços, equipe, comandas/caixa, relatórios e assinaturas). Stack: React 19 +
TypeScript + TanStack Start/Router + Vite + Tailwind 4 + Supabase +
Cloudflare Workers + Paddle.

## Regras arquiteturais

1. **Não reescrever o projeto.** Faça mudanças incrementais e localizadas.
2. **Uma funcionalidade por vez.** Não implemente várias em paralelo.
3. **Preserve nomes de tabelas e regras de negócio existentes.**
4. **Migrations são imutáveis depois de aplicadas.** Nunca edite migrations
   antigas em `supabase/migrations/`; sempre crie uma nova
   (`supabase migration new ...`).
5. **Proibido `any` em código novo.** Use tipos explícitos ou os tipos gerados em
   `src/integrations/supabase/types.ts`.
6. **Segredos nunca no repositório.** `.env*` estão no `.gitignore`; apenas
   `.env.example` (sem valores) é versionado. `SUPABASE_SERVICE_ROLE_KEY` e chaves
   do Paddle nunca podem chegar ao bundle do cliente.
7. **Não alterar o visual** sem pedido explícito.
8. **`routeTree.gen.ts` é gerado** — não edite manualmente.
9. **`src/integrations/supabase/client.ts` e `client.server.ts`** têm cabeçalho
   "auto-generated"; trate-os como gerados.

## Camadas de acesso ao Supabase

- **`client.ts`** — client do navegador/SSR com a chave *publishable*. Respeita
  RLS. Import: `import { supabase } from "@/integrations/supabase/client"`.
- **`client.server.ts`** — client admin com *service role*, **bypassa RLS**.
  Uso exclusivo em código de servidor confiável (server routes / functions).
  Nunca importar em código que vai para o cliente.
- **`auth-middleware.ts` / `auth-attacher.ts`** — client autenticado por usuário
  para queries com RLS no servidor.
- **Edge Functions** (`supabase/functions/`, Deno) — usam `Deno.env.get(...)`.

## Papéis de usuário (`public.app_role`)

| Papel              | Descrição                                                        |
| ------------------ | ---------------------------------------------------------------- |
| `cliente`          | Cliente final; agenda e gerencia os próprios agendamentos.       |
| `barbeiro`         | Profissional; gerencia a própria agenda dentro da barbearia.     |
| `admin_barbearia`  | Administra uma barbearia (equipe, serviços, config, relatórios). |
| `super_admin`      | Administração global da plataforma.                              |

Autorização no banco via funções `has_role(user_id, role)` e
`has_role_in_barbershop(user_id, barbershop_id, role)`, aplicadas nas políticas RLS.
Papéis são vinculados por barbearia na tabela `user_roles`.

## Tabelas principais (schema `public`)

| Tabela                        | Papel                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| `profiles`                    | Perfil do usuário (1:1 com auth.users).                      |
| `user_roles`                  | Papel do usuário por barbearia (`app_role` + `barbershop_id`).|
| `barbershops`                 | Barbearias (tenants).                                        |
| `services`                    | Serviços oferecidos.                                         |
| `products`                    | Produtos vendidos.                                          |
| `appointments`                | Agendamentos (`appointment_status`).                         |
| `availability`                | Disponibilidade (`availability_status`: livre/ocupado/folga).|
| `weekly_schedule`             | Grade semanal de horários por profissional.                  |
| `schedule_blocks`             | Bloqueios de agenda (`block_type`: feriado/férias/pessoal).  |
| `client_blocks`               | Bloqueios/relacionamento com clientes.                       |
| `client_notes`                | Anotações sobre clientes.                                    |
| `reviews`                     | Avaliações.                                                  |
| `tickets` / `ticket_items` / `ticket_payments` | Comanda/caixa e pagamentos.                 |
| `plans`                       | Planos (`plan_name`: free/pro/enterprise) e limites.         |
| `subscriptions`               | Assinaturas Paddle.                                          |
| `payment_methods`             | Métodos de pagamento.                                        |
| `plan_change_logs`            | Histórico de troca de plano.                                 |
| `team_invitations`            | Convites de equipe (`approval_status`).                      |
| `notifications`               | Notificações in-app.                                         |
| `contact_submissions`         | Formulário de contato.                                       |
| `account_deletions` / `account_deletion_feedback` | Fluxo de exclusão de conta.             |

Enums relevantes: `app_role`, `appointment_status`, `availability_status`,
`block_type`, `plan_name`, `approval_status`.

## Pagamentos (Paddle)

- Client-side: `src/lib/paddle.ts` usa `VITE_PAYMENTS_CLIENT_TOKEN` (prefixo
  `test_` ⇒ sandbox).
- Server-side: Edge Functions em `supabase/functions/` chamam o Paddle via
  gateway Lovable (`_shared/paddle.ts`), usando `PADDLE_*_API_KEY`,
  `PAYMENTS_*_WEBHOOK_SECRET` e `LOVABLE_API_KEY`.
- Webhooks são verificados com assinatura em `verifyWebhook`.

## Convenções de código

- TypeScript estrito (`strict: true`). Sem `any` em código novo.
- Path alias `@/*` → `src/*`.
- Componentes UI seguem shadcn/ui (estilo "new-york") em `src/components/ui`.
- Roteamento file-based do TanStack Router (`src/routes`). Server handlers em
  `src/routes/hooks/`.
- Formatação via Prettier; **não** rode formatação global sem necessidade.
- Datas/timezone: use helpers em `src/lib/tz.ts` e `date-fns`.

## Convenções de Git

- Branches de funcionalidade: `feat/<descricao-curta>`.
- Commits de funcionalidade começam com `adição:`.
- Não versionar `.env*` (exceto `.env.example`).

## Comandos de validação

```bash
npm run build        # build de produção deve passar
npx tsc --noEmit     # checagem de tipos
npm run lint         # ESLint
npm ci               # instalação limpa (package.json ↔ package-lock em sync)
```

Supabase:

```bash
supabase db push                 # aplica migrations
supabase migration new <nome>    # cria nova migration (nunca editar antigas)
supabase functions deploy <fn>   # deploy de Edge Function
supabase secrets set NOME=valor  # define secrets das functions
```
