# Estado atual do projeto — BarbaFlow

> Levantado em **28/07/2026**, a partir do código, das migrations e do histórico
> do Git. Nada aqui é planejamento: é o que existe hoje no repositório.
>
> | Referência | Valor |
> |---|---|
> | `main` | `6afd1c2` (merge do PR #29) |
> | Branch de trabalho no momento do levantamento | `fix/import-fontes-css` (`97f95d0`) |
> | Working tree | limpa, com `.vercel/` não rastreado |
>
> O que **não** foi verificado, e por quê: o estado real do banco remoto
> (`qfcngyyzyiwotehubifx`) — exige o Supabase CLI, que esta auditoria não
> executou. Onde o documento afirma algo sobre o remoto, a fonte é
> `docs/PREVIEW_CLIENTE_VERCEL.md` (na branch `preview/cliente-vercel`) ou o
> comentário da própria migration, e está marcado como tal.

---

## 1. Arquitetura

Aplicação **full-stack em um único repositório**, com SSR:

```
navegador ──► TanStack Start (SSR + rotas de arquivo)
                  │
                  ├─ cliente Supabase do navegador (chave publicável, RLS ativa)
                  │      └─► PostgREST / Auth / Realtime / Storage
                  │
                  ├─ rotas de servidor  src/routes/hooks/*   (chave administrativa)
                  │
                  └─ Edge Functions  supabase/functions/*     (chave administrativa)
```

Três decisões estruturais que explicam quase tudo no código:

**Multi-tenant por barbearia.** Cada linha carrega `barbershop_id`, e o
isolamento é feito por RLS no banco — não no frontend. `src/hooks/use-barbershop.tsx`
resolve o tenant ativo (por subdomínio ou por papel do usuário) e
`src/hooks/use-tenant-scope.tsx` distribui esse escopo às telas.

**Fonte de dados intercambiável.** `VITE_DATA_SOURCE=mock` troca o cliente
Supabase por um cliente fictício completo (`src/mocks/client.ts`, ~1.060 linhas)
que implementa o subconjunto da API usado pelo app, lendo e gravando só em
`localStorage`. É o que permite rodar e testar o produto inteiro sem rede e sem
banco. A troca acontece num ponto só: `src/integrations/supabase/client.ts`.

**Testes por harness, não por framework.** Não há Vitest/Jest. A lógica de
negócio é extraída para `src/lib/*` em funções puras, e cada frente tem um
harness em `src/mocks/__harness__/*.ts` executado por um script `.mjs` que usa o
Vite só para resolver `@` e compilar TS sob demanda. Zero dependência nova.

**Não existe middleware de autenticação.** As guardas são `useEffect` por
página, que redirecionam para `/login` quando não há sessão ou papel. Consequência
prática: toda rota nova precisa declarar sua própria guarda, e rotas públicas
simplesmente não declaram nada.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Framework | TanStack Start 1.167 + TanStack Router 1.168 (rotas por arquivo) |
| UI | React 19.2, Tailwind CSS 4.2, Radix UI (46 componentes em `src/components/ui`), lucide-react, framer-motion |
| Estado/dados | TanStack Query 5.83, React Hook Form 7.71 + Zod 3.24 |
| Backend | Supabase (Postgres + Auth + Realtime + Storage + Edge Functions) |
| Build | Vite 7.3 via `@lovable.dev/vite-tanstack-config`; dev na porta **8080** (`strictPort`) |
| Deploy | Cloudflare na `main`; **Nitro/Vercel só na branch `chore/vercel-nitro`** |
| Relatórios | recharts 2.15, jspdf 4.2 |
| Qualidade | TypeScript 5.8 (`tsc --noEmit`), ESLint 9 + Prettier, harnesses próprios |

---

## 3. Módulos

### Rotas públicas (sem sessão)

| Rota | Arquivo | Função |
|---|---|---|
| `/` | `routes/index.tsx` + `LandingHero`, `ProductsShowcase`, `ReviewsShowcase` | Landing com vitrine de produtos e avaliações |
| `/agendar` e `/agendar/$slug` | `routes/agendar.*.tsx` + `components/booking/*` | Agendamento público em assistente (7 arquivos) |
| `/barbearias` | `routes/barbearias.tsx` | Diretório de barbearias aprovadas |
| `/login` | `routes/login.tsx` + `AuthForm` | Entrar, criar conta, recuperar senha, OAuth Google/Apple |
| `/reset-password` | `routes/reset-password.tsx` | Definir nova senha |
| `/convite` | `routes/convite.tsx` | Aceite de convite de equipe |
| `/contato`, `/sobre`, `/termos`, `/privacidade`, `/reembolso` | `routes/*.tsx` | Institucional |
| `/sitemap.xml`, `/manifest.json` | `routes/sitemap[.]xml.tsx`, `routes/manifest[.]json.tsx` | SEO e PWA |

### Rotas autenticadas

| Rota | Arquivo | Função |
|---|---|---|
| `/dashboard` | `routes/dashboard.tsx` + `AdminDashboard`, `BarberDashboard`, `OperationalDashboard` | Painel por papel |
| `/agenda` | `routes/agenda.tsx` + `ScheduleManager`, `ScheduleBlocks`, `WeeklyScheduleEditor` | Agenda, bloqueios, jornada |
| `/clientes` | `routes/clientes.tsx` (1.457 linhas) | Base de clientes e histórico |
| `/comandas` | `routes/comandas.tsx` + `ComandasManager`, `ComandaDetailDialog`, `CloseComandaDialog`, `CloseTicketDialog` | Comandas, produtos, fechamento |
| `/servicos` | `routes/servicos.tsx` + `ServicesManager` | Catálogo de serviços |
| `/relatorios` | `routes/relatorios.tsx` + `BarberReports`, `NoShowReport` | Vendas, no-show, PDF |
| `/configuracoes` | `routes/configuracoes.tsx` + `BarbershopSettings` (1.444 linhas), `TeamManager` | Barbearia, equipe, tema, recibo |
| `/perfil` | `routes/perfil.tsx` | Dados, foto, exclusão de conta |
| `/meus-agendamentos` | `routes/meus-agendamentos.tsx` + `AppointmentHistory`, `RescheduleDialog`, `ReviewDialog` | Área do cliente |
| `/onboarding` | `routes/onboarding.tsx` + `OnboardingWizard` | Criação da barbearia |
| `/upgrade` | `routes/upgrade.tsx` + `PlanCard`, `PlanPaywallModal` | Planos (**cobrança pausada**) |
| `/admin/churn` | `routes/admin.churn.tsx` | Visão de plataforma (super admin) |

### Servidor e integrações

| Item | Arquivo | Observação |
|---|---|---|
| Cron de exclusão de contas | `routes/hooks/process-account-deletions.ts` | Usa chave administrativa |
| Cron de reset mensal | `routes/hooks/reset-monthly-appointments.ts` | Usa chave administrativa |
| Edge Functions | `supabase/functions/{delete-account, cancel-account-deletion, create-portal-session, get-paddle-price, payments-webhook}` | As três últimas são de pagamento |
| Cliente administrativo | `integrations/supabase/client.server.ts` | Só rotas de servidor podem importar — travado por harness |

---

## 4. Estado de cada funcionalidade

### 4.1 Concluídas e cobertas por teste

| Módulo | Cobertura | Evidência |
|---|---|---|
| Agenda e agendamento público | `harness:agenda` (56) + `harness:agenda-concorrencia` (banco) | `mocks/__harness__/slots.ts` |
| Dashboard operacional | `harness:dashboard` (87) | `dashboard-harness.ts` |
| Relatórios de vendas | `harness:relatorios` (56) | `relatorios-harness.ts` |
| Planos, onboarding e limites | `harness` / `plan` (46) | `plan-onboarding-harness.ts` |
| Notificações e avaliações | `harness:notifications` (100) | `notifications-reviews-harness.ts` |
| Realtime | `harness:realtime` (22) | `run-realtime-harness.mjs` |
| Erros seguros e papel de cliente | `harness:erros` (49) | `erros-role-cliente-harness.ts` |
| Scripts de banco remoto | `harness:remote-scripts` (41) | `run-remote-scripts-harness.mjs` |
| Comandas e clientes | `harness:db` (2 suítes) | exigem Postgres local |

### 4.2 Parciais ou bloqueadas

| Módulo | Situação | Onde está |
|---|---|---|
| **Catálogo público de produtos** | Código pronto e testado (96 verificações); a RPC `get_public_products` **não existe no remoto**, então a vitrine falha lá. A fase 2 (revogar leitura pública de `products`) **nem foi escrita**, de propósito. | `lib/public-catalog.ts`, migration `20260727120000` |
| **Recuperação de senha** | Corrigida e testada (75 verificações) na branch `fix/recuperacao-senha`, **não mesclada**. Na `main` o defeito continua. | branch `fix/recuperacao-senha` |
| **Carregamento das fontes** | `npm run dev` quebra na `main` por um `@import` remoto no CSS. Corrigido em `fix/import-fontes-css` (e também em `fix/recuperacao-senha`), **não mesclado**. | branch `fix/import-fontes-css` |
| **Cobrança / assinaturas** | Desligada por flag. Toda a infraestrutura (hooks, edge functions, rota `/upgrade`, migrations) permanece intacta. | `lib/billing-ui.ts` |
| **Notificações por e-mail** | Só `console.log`. O envio está escrito, comentado, esperando domínio de e-mail. | `lib/notifications.ts:41,68` |
| **Formulário de contato** | Grava em `contact_submissions`. **Ninguém é notificado** — depende de alguém consultar a tabela. | `routes/contato.tsx:71` |
| **Múltiplas unidades** | Anunciado como "em breve" no plano Enterprise da landing. Não há código. | `LandingHero.tsx:245` |
| **Resolução de tenant** | `DEFAULT_BARBERSHOP_ID` é um uuid fixo usado como último recurso, com `TODO` pedindo resolução por subdomínio/papel. | `lib/constants.ts:1` |

### 4.3 Bugs conhecidos

| # | Bug | Estado |
|---|---|---|
| 1 | `/hooks/reset-monthly-appointments` aceita **qualquer** header `authorization` (ou `lovable-context`) e zera `appointments_this_month` de **todas** as barbearias com a chave administrativa | **aberto na `main`** — ver §9 |
| 2 | `/hooks/process-account-deletions` autoriza pela chave publicável, que é pública por definição | **aberto na `main`** — ver §9 |
| 3 | `products` legível por visitante anônimo, incluindo `stock_quantity` | **aberto no banco** — ver §9 |
| 4 | Recuperação de senha não detecta a sessão numa recarga; link expirado não informa nada | corrigido em branch, **aberto na `main`** |
| 5 | `npm run dev` falha no Lightning CSS | corrigido em branch, **aberto na `main`** |
| 6 | `npm run lint` vermelho na base (CRLF + Prettier) | aberto, sem impacto funcional |

---

## 5. Branches

**24 branches locais, 35 remotas.** As de feature já mescladas continuam existindo
— histórico útil, mas ruído para quem chega agora.

### 5.1 Branches especiais — leia antes de mexer

| Branch | O que é | Regra |
|---|---|---|
| **`preview/cliente-vercel`** | Ambiente que o cliente está testando. É `chore/vercel-nitro` **menos** a frente de catálogo público (revertida para casar com o schema remoto atual). | ⛔ **Nunca mesclar na `main`.** Não commitar nela. Ver §11. |
| **`chore/vercel-nitro`** | Migração do build Cloudflare → Nitro/Vercel. Altera `vite.config.ts`, `package.json`, `package-lock.json`, `.gitignore`. **É permanente** e deve ir à `main` pelo próprio PR. | Não mexer fora do PR dela |
| **`chore/seed-demo-cliente`** | Dados de demonstração para homologação. Tem um `stash` pendente (`stash@{0}`, ajuste local de `.gitignore`). | Não descartar o stash |

### 5.2 Branches com trabalho pronto e não mesclado

| Branch | Commits à frente da `main` | Conteúdo |
|---|---|---|
| `fix/recuperacao-senha` | 3 | Correção + 75 testes do fluxo de senha, e a correção do CSS |
| `fix/import-fontes-css` | 1 | Só a correção do CSS |

⚠️ As duas contêm o **mesmo** commit de correção do CSS, com hashes diferentes
(`a1969ca` e `97f95d0`). Mesclar as duas é seguro (conteúdo idêntico), mas é
duplicação: o ideal é mesclar `fix/import-fontes-css` primeiro e rebasear a outra.

### 5.3 Branches de feature já mescladas

`feat/agenda-real-e-agendamento-publico`, `feat/area-cliente-meus-agendamentos`,
`feat/comandas-produtos-estoque`, `feat/conexao-frontend-supabase`,
`feat/configuracao-supabase-real`, `feat/correcao-perfis-auth`,
`feat/corrigir-acesso-clientes`, `feat/corrigir-onboarding-real`,
`feat/corrigir-realtime-plano`, `feat/dashboard-operacional`,
`feat/notificacoes-avaliacoes-mock`, `feat/notificacoes-operacionais`,
`feat/ocultar-sentinela-rls`, `feat/onboarding-planos-mock`,
`feat/relatorios-vendas`, `feat/seed-dados-teste`,
`feat/tenant-real-modulos-base`, `fix/catalogo-publico-estoque-interno`,
`fix/dashboard-pos-smoke`, `fix/remover-assinaturas-da-main`,
`fix/tratamento-erros-e-role-cliente`, `chore/desenvolvimento-remote-first`.

Existem ainda 6 branches **só no remoto**, sem cópia local:
`feat/agenda-agendamento-mock`, `feat/auditoria-reinicio`,
`feat/clientes-comandas-mock`, `feat/configuracoes-equipe-mock`,
`feat/dashboard-relatorios-mock`, `feat/estabilizacao-repositorio`.

`feat/assinaturas-cobranca` é o caso especial: foi **removida da `main`** pelo PR
#25 (`fix/remover-assinaturas-da-main`) e continua viva como referência da frente
pausada.

---

## 6. Ambiente Supabase

| Item | Valor |
|---|---|
| Projeto de desenvolvimento/homologação | `qfcngyyzyiwotehubifx` — **compartilhado pela equipe e pelo cliente** |
| Produção | **não configurado neste repositório** |
| `project_id` do CLI | `barbaflow` (`supabase/config.toml`) |
| Migrations versionadas | **75 arquivos** em `supabase/migrations/`, de `20260415164717` a `20260727120000` |
| Edge Functions | 5, mais `_shared/paddle.ts` |
| Bootstrap | `supabase/bootstrap/super-admin.example.sql` (exemplo, aplicação manual) |

### Migrations ainda não confirmadas no remoto

**`20260727120000_public_product_catalog.sql` (fase 1) não foi aplicada.** A fonte
é `docs/PREVIEW_CLIENTE_VERCEL.md`, na branch do Preview: a RPC
`get_public_products` não existe no remoto, o PostgREST responde `PGRST202`, e foi
por isso que a frente de catálogo precisou ser revertida no Preview do cliente.

**A fase 2 não existe como arquivo, e isso é intencional.** O rodapé da migration
descreve o conteúdo (`DROP POLICY` + `REVOKE SELECT ... FROM anon`) e o harness
`catalogo-publico` **falha de propósito** se alguém criar essa migration antes da
hora — para que um único `db push` não aplique as duas fases juntas.

Para conferir o estado real de todas as 75, numa máquina com o CLI funcionando:

```bash
npm run db:status:remote     # somente leitura
npm run db:dry-run           # o que seria aplicado; não escreve
```

Nenhum dos dois escreve. O `db push` real não tem script de npm, de propósito.

---

## 7. Ambiente Vercel

| Item | Estado |
|---|---|
| Projeto | `barbaflow`, vinculado localmente em `.vercel/repo.json` (não versionado) |
| Branch que constrói para Vercel | **só `chore/vercel-nitro` e `preview/cliente-vercel`** |
| `main` | ainda no preset Cloudflare — `vite.config.ts` e `package.json` da `main` não têm a configuração Nitro |
| URL do Preview do cliente | **não está registrada em nenhum arquivo do repositório.** Só no painel da Vercel. |
| `.vercel/` | aparece como não rastreado; entra no `.gitignore` apenas nas branches Nitro |

Consequência prática: **um deploy feito a partir da `main` hoje não usaria a
configuração Nitro.** Enquanto `chore/vercel-nitro` não for mesclada, a `main` e o
ambiente de Preview divergem no build.

---

## 8. Dependências externas

### 8.1 SMTP / e-mail

| O que depende | Situação |
|---|---|
| Confirmação de cadastro, recuperação de senha, convite de equipe | Enviados pelo **Auth do Supabase**. Funcionam com o SMTP padrão (limitado) ou com um SMTP próprio configurado no painel. |
| Confirmação e cancelamento de agendamento | **Não enviam nada.** Só `console.log`, com o envio comentado esperando domínio (`lib/notifications.ts`). |
| Formulário de contato | Grava no banco; nenhum e-mail é disparado. |

O fluxo de recuperação de senha depende ainda de **Authentication → URL
Configuration** estar preenchido — está documentado em `docs/RECUPERACAO_SENHA.md`.

### 8.2 Pagamento

Provedor: **Paddle**. `VITE_PAYMENTS_CLIENT_TOKEN` no frontend; as chaves de
servidor ficam nas Edge Functions.

| Peça | Arquivo |
|---|---|
| Checkout | `hooks/use-paddle-checkout.ts`, `lib/paddle.ts` |
| Preço | Edge Function `get-paddle-price` |
| Portal do assinante | Edge Function `create-portal-session` |
| Webhook | Edge Function `payments-webhook` |
| Banner de modo de teste | `components/PaymentTestModeBanner.tsx` |

**Tudo isso está inacessível pela interface**: `BILLING_UI_ENABLED = false`
esconde botões de assinatura, checkout e CTAs de upgrade. Permanecem visíveis o
rótulo do plano, o uso e os avisos de limite — que são informativos.

### 8.3 Outras configurações externas

| Dependência | Onde |
|---|---|
| ViaCEP (endereço) | `lib/cep.ts` — API pública, sem chave |
| Google Fonts | `<link>` no `__root.tsx` (nas branches corrigidas) |
| Agendador externo para os dois `/hooks/*` | Nenhum agendador está versionado |
| Google Fonts / OAuth Google e Apple | Configuração no painel do Supabase |
| Storage de fotos de perfil | Bucket do Supabase |

---

## 9. Riscos

### 9.1 Segurança — crítico

**1. `/hooks/reset-monthly-appointments` é efetivamente aberto.**
O handler só verifica se **existe** um header `authorization` ou `lovable-context`
— qualquer valor serve. Em seguida usa `supabaseAdmin` (chave administrativa,
RLS ignorada) para zerar `appointments_this_month` de todas as barbearias.
Qualquer pessoa que conheça a URL derruba o controle de limite mensal de todos os
tenants com um POST. `src/routes/hooks/reset-monthly-appointments.ts:8-22`

**2. `/hooks/process-account-deletions` autoriza com chave pública.**
Compara o bearer com `SUPABASE_ANON_KEY`/`SUPABASE_PUBLISHABLE_KEY` — chaves que,
por definição, estão no bundle do navegador. O endpoint executa
`auth.admin.deleteUser`. O dano é contido (só age em contas já marcadas para
exclusão com prazo vencido), mas a autorização não vale nada.
`src/routes/hooks/process-account-deletions.ts:29`

**3. `products` exposto a visitante anônimo.**
`GRANT SELECT ... TO anon` (migration `20260721140000`) mais a policy de
`20260416141800` deixam qualquer visitante ler a tabela inteira pelo PostgREST.
RLS filtra linhas, não colunas: **`stock_quantity` é público**, e produtos
inativos também. A correção é a fase 1 da migration `20260727120000` seguida da
fase 2 — nenhuma das duas aplicada.

### 9.2 Segurança — verificado e saudável

- Nenhum componente, hook ou lib importa `client.server`; só rotas de servidor.
- `SERVICE_ROLE` nunca é lida de `import.meta.env`, e nenhuma variável
  administrativa usa prefixo `VITE_`.
- Erros técnicos são redigidos antes do console (JWT, `sb_secret`, `apikey`,
  senha, `Authorization`) — `lib/error-reporting.ts`.
- As três garantias acima são **travadas por teste** (`harness:erros`).

### 9.3 Operação

| Risco | Detalhe |
|---|---|
| Cliente testando em ambiente compartilhado | O Preview aponta para `qfcngyyzyiwotehubifx`, o mesmo banco do desenvolvimento. Um seed ou cleanup apaga o que ele criar. |
| `main` sem configuração de deploy Vercel | Ver §7 |
| Dois defeitos conhecidos vivos na `main` | Recuperação de senha e `npm run dev` |
| `harness:db` não roda sem Docker | 3 suítes de integração ficam SKIPPED na maioria das máquinas |
| Supabase CLI bloqueado no Windows | Smart App Control impede a execução; nenhum comando de banco roda nessa máquina |

---

## 10. Testes

### O que existe

| Suíte | Comando | Verificações | Precisa de banco |
|---|---|---|---|
| plan | `npm run harness` | 46 | não |
| agenda | `npm run harness:agenda` | 56 | não |
| relatorios | `npm run harness:relatorios` | 56 | não |
| dashboard | `npm run harness:dashboard` | 87 | não |
| erros | `npm run harness:erros` | 49 | não |
| notifications | `npm run harness:notifications` | 100 | não |
| realtime | `npm run harness:realtime` | 22 | não |
| remote-scripts | `npm run harness:remote-scripts` | 41 | não |
| catalogo-publico | `npm run harness:catalogo-publico` | 96 | não |
| cliente | `npm run harness:cliente` | — | **sim** |
| comandas | `npm run harness:comandas` | — | **sim** |
| agenda-concorrencia | `npm run harness:agenda-concorrencia` | — | **sim** |

`npm run harness:core` roda as 9 primeiras: **553 verificações** na `main`
(soma das suítes acima). Com `fix/recuperacao-senha` aplicada são 10 suítes e
**628 verificações** — medido nesta auditoria.

`docs/DESENVOLVIMENTO_REMOTO.md` ainda diz "8 suítes"; está desatualizado desde
a entrada de `catalogo-publico`.

### O que não existe

- **Nenhum teste de componente React.** Os harnesses testam funções puras e fazem
  varredura estática do código-fonte; não montam a árvore React.
- **Nenhum teste de ponta a ponta** (Playwright/Cypress).
- **Nenhuma validação visual automatizada.**
- **Nenhum CI configurado** — não há `.github/workflows`.

### Telas sem validação visual registrada

Todas. Nesta auditoria só houve conferência por HTTP (SSR devolvendo 200 e o
texto esperado) de `/`, `/login` e `/reset-password`. As demais — dashboard nos
três papéis, agenda, clientes, comandas, serviços, relatórios, configurações,
perfil, onboarding, agendar, meus-agendamentos, admin/churn, barbearias, upgrade,
convite e as institucionais — **nunca tiveram conferência visual registrada**,
em nenhum ambiente.

---

## 11. Regras para não afetar o Preview do cliente

O cliente está testando `preview/cliente-vercel`, apontando para o banco de
homologação. Cinco regras:

1. **Nunca commitar, rebasear ou mesclar `preview/cliente-vercel`.** Nem mesclá-la
   na `main`, nem mesclar a `main` nela.
2. **Nunca commitar em `chore/vercel-nitro`** fora do PR dela — o Preview é
   construído a partir dessa base.
3. **Nenhum `db push`, seed, cleanup ou `migration repair` sem autorização
   explícita.** O banco é o mesmo que o cliente está usando; um seed apaga o que
   ele criou. `db reset --linked` é proibido em qualquer hipótese.
4. **Não alterar configuração remota do Supabase** (URL Configuration, templates,
   provedores) sem apresentar o diagnóstico antes. Uma Redirect URL removida
   quebra o login do cliente no meio do teste.
5. **Trabalho novo sempre em branch a partir da `main`.** Nada que ainda não
   passou por `tsc`, `build` e `harness:core` deve encostar em branch conectada a
   um ambiente que o cliente abre.

Quando a migration `20260727120000` for aplicada no remoto, o Preview deixa de
precisar da reversão: apagar a branch, apontar o Preview para uma branch derivada
da `main` e remover `docs/PREVIEW_CLIENTE_VERCEL.md`.

---

## 12. Dívida técnica e código morto

| Item | Onde | Impacto |
|---|---|---|
| `DEFAULT_BARBERSHOP_ID` como sentinela de tenant | `lib/constants.ts` + 8 usos | Consulta pode cair numa barbearia fictícia quando o tenant não resolve |
| `npm run lint` vermelho na base | CRLF + Prettier em arquivos antigos | Impede usar o lint como portão |
| Arquivos muito grandes | `BarberDashboard.tsx` (1.860), `clientes.tsx` (1.457), `BarbershopSettings.tsx` (1.444), `ManualAppointmentDialog.tsx` (1.052) | Revisão e teste difíceis |
| Constante depreciada de fuso | `lib/tz.ts:33` | Compatibilidade; sempre devolve o default |
| RPCs e operadores não implementados no mock | `mocks/client.ts:1060`, `mocks/query-builder.ts:316` | Avisam no console e devolvem `null`/ignoram o filtro |
| Documentação desatualizada | `DESENVOLVIMENTO_REMOTO.md` (§6, "8 suítes") | Contagem errada |
| **Não existe `CLAUDE.md`** | raiz | Nenhuma instrução de projeto versionada para agentes |
| 24 branches locais, a maioria já mesclada | `git branch` | Ruído |
| `.vercel/` não ignorado na `main` | `.gitignore` | Aparece em todo `git status` |
| Infra do Paddle mantida sem uso | 3 Edge Functions, hooks, `/upgrade` | Código vivo, inalcançável pela interface |

---

## 13. Comandos de validação

```bash
# Sem banco, sem rede — o portão do dia a dia
npx tsc --noEmit
npm run build
npm run harness:core

# Frontend (porta 8080, strictPort)
npm run dev
npm run dev -- --mode development     # com VITE_DATA_SOURCE=mock roda offline

# Banco remoto — somente leitura, exigem o Supabase CLI vinculado
npm run db:status:remote
npm run db:lint:remote
npm run db:dry-run
npm run types:check

# Integração (exigem Postgres local via `npx supabase start`)
npm run harness:db
npm run harness:all       # não fica verde se algo for pulado
```

Antes de qualquer commit: `git diff --check` e `git status --short`.

**Nunca**: `supabase db reset --linked`, `db push` sem dry-run, `migration repair`
sem diagnóstico, seed automático no remoto, `supabase stop --all`.
