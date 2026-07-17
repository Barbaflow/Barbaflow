# BarbaFlow Pro

Plataforma SaaS para gestão de barbearias: agendamento online, agenda por
profissional, gestão de clientes, serviços, equipe, relatórios, comandas/caixa
e cobrança recorrente por assinatura (planos Free / Pro / Enterprise).

O produto é multi-tenant (várias barbearias na mesma instância), com controle de
acesso baseado em papéis e Row Level Security no banco de dados.

---

## Tecnologias

| Camada            | Stack                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Frontend          | React 19, TypeScript, TanStack Router, TanStack Query, Tailwind CSS 4 |
| UI                | shadcn/ui (Radix UI), lucide-react, framer-motion, recharts, sonner   |
| Meta-framework     | TanStack Start (SSR)                                                   |
| Build / dev       | Vite 7, `@lovable.dev/vite-tanstack-config`                           |
| Hospedagem        | Cloudflare Workers (via `@cloudflare/vite-plugin` + Wrangler)         |
| Backend / dados   | Supabase (PostgreSQL, Auth, Edge Functions, RLS)                      |
| Pagamentos        | Paddle (checkout, assinaturas, webhooks) via gateway Lovable          |
| Formulários       | react-hook-form + zod                                                 |

---

## Requisitos

- **Node.js** >= 20 (o repositório usa recursos ES2022; recomendado LTS atual)
- **npm** (há `package-lock.json`) — o projeto também suporta **Bun** (`bun.lockb`)
- **Supabase CLI** (para migrations e Edge Functions) — https://supabase.com/docs/guides/cli
- **Wrangler** (Cloudflare) para deploy/preview no Workers — instalado como dependência
- Uma conta/projeto **Supabase** e uma conta **Paddle** configurada

> **Gerenciador de pacotes:** o projeto foi originado com Bun, mas mantém um
> `package-lock.json` sincronizado para uso com npm. Escolha **um** gerenciador e
> mantenha o respectivo lockfile atualizado.

---

## Instalação

```bash
git clone <repo-url>
cd barbaflow-pro

# com npm
npm ci

# ou com Bun
bun install
```

---

## Configuração das variáveis de ambiente

Copie o arquivo de exemplo e preencha com os valores reais:

```bash
cp .env.example .env
```

Os arquivos `.env`, `.env.development`, `.env.production` e `.env.local` estão no
`.gitignore` e **nunca** devem ser versionados. Apenas o `.env.example` (sem
valores) é versionado.

### Frontend (Vite — expostas no navegador, use só chaves públicas)

| Variável                       | Descrição                                                        |
| ------------------------------ | ---------------------------------------------------------------- |
| `VITE_SUPABASE_URL`            | URL do projeto Supabase                                          |
| `VITE_SUPABASE_PUBLISHABLE_KEY`| Chave publishable/anon do Supabase                               |
| `VITE_SUPABASE_PROJECT_ID`     | ID do projeto Supabase                                           |
| `VITE_PAYMENTS_CLIENT_TOKEN`   | Token público do Paddle (prefixo `test_` ativa o modo sandbox)  |

### Servidor / SSR (Cloudflare Workers — `process.env`)

| Variável                     | Descrição                                                    |
| ---------------------------- | ------------------------------------------------------------ |
| `SUPABASE_URL`               | URL do projeto Supabase (SSR)                                |
| `SUPABASE_PUBLISHABLE_KEY`   | Chave publishable/anon (SSR)                                 |
| `SUPABASE_ANON_KEY`          | Chave anon (usada em rotas/hooks server)                     |
| `SUPABASE_SERVICE_ROLE_KEY`  | Chave service role — **bypassa RLS, nunca exponha no client**|

### Supabase Edge Functions (Deno — configuradas como *secrets*, não em `.env`)

Defina com `supabase secrets set NOME=valor`. `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente pelo runtime das functions.

| Variável                          | Descrição                                        |
| --------------------------------- | ------------------------------------------------ |
| `PADDLE_SANDBOX_API_KEY`          | API key do Paddle (sandbox)                      |
| `PADDLE_LIVE_API_KEY`             | API key do Paddle (produção)                     |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Segredo de verificação do webhook Paddle (sandbox)|
| `PAYMENTS_LIVE_WEBHOOK_SECRET`    | Segredo de verificação do webhook Paddle (produção)|
| `LOVABLE_API_KEY`                 | Chave do gateway Lovable usado para chamar o Paddle|

---

## Execução local

```bash
# ambiente de desenvolvimento (Vite dev server + SSR)
npm run dev

# build em modo development
npm run build:dev
```

O app sobe por padrão em `http://localhost:3000` (porta pode variar conforme a
configuração do `@lovable.dev/vite-tanstack-config`).

---

## Build

```bash
# build de produção (gera artefatos para Cloudflare Workers)
npm run build

# pré-visualização do build
npm run preview
```

### Validação

```bash
npm run build        # build precisa passar
npx tsc --noEmit     # checagem de tipos sem emissão
npm run lint         # ESLint
```

---

## Estrutura de pastas

```
barbaflow-pro/
├── public/                     # assets estáticos, manifest PWA, service worker (sw.js)
├── src/
│   ├── assets/                 # imagens e mídia importadas
│   ├── components/             # componentes React (inclui ui/ do shadcn)
│   ├── hooks/                  # hooks de domínio (auth, barbershop, plan, notifications...)
│   ├── integrations/
│   │   ├── supabase/           # clients (browser/SSR/admin), auth middleware, types gerados
│   │   └── lovable/            # integração com a plataforma Lovable
│   ├── lib/                    # utilitários (paddle, cep, phone, tz, notifications, constants...)
│   ├── routes/                 # rotas TanStack (file-based) + routes/hooks server-side
│   ├── router.tsx              # criação do router
│   ├── routeTree.gen.ts        # árvore de rotas GERADA — não editar à mão
│   └── styles.css              # estilos base + Tailwind
├── supabase/
│   ├── config.toml             # configuração do projeto Supabase local
│   ├── functions/              # Edge Functions (Deno) + _shared/
│   └── migrations/             # migrations SQL versionadas (NÃO alterar as já aplicadas)
├── vite.config.ts              # config Vite (delega ao preset Lovable)
├── wrangler.jsonc              # config do Cloudflare Workers
├── .env.example                # nomes das variáveis (sem valores)
├── CLAUDE.md                   # regras arquiteturais e convenções do projeto
└── package.json
```

---

## Supabase — migrations e Edge Functions

Requer a Supabase CLI autenticada e o projeto vinculado (`supabase link`).

### Migrations

```bash
# aplicar migrations no banco vinculado
supabase db push

# criar uma NOVA migration (nunca edite migrations antigas já aplicadas)
supabase migration new nome_descritivo

# resetar o banco local aplicando todas as migrations (ambiente local)
supabase db reset
```

As migrations ficam em `supabase/migrations/` e usam o padrão de timestamp já
existente. **Nunca** edite uma migration já aplicada — crie uma nova.

### Edge Functions

```bash
# servir functions localmente
supabase functions serve

# deploy de uma function específica
supabase functions deploy payments-webhook

# definir secrets usados pelas functions (Paddle / Lovable)
supabase secrets set PADDLE_SANDBOX_API_KEY=... PADDLE_LIVE_API_KEY=...
```

Functions disponíveis: `payments-webhook`, `create-portal-session`,
`get-paddle-price`, `delete-account`, `cancel-account-deletion`.
