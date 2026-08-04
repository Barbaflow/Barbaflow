# Estado atual do projeto — BarbaFlow

> Levantado em **04/08/2026**, a partir do código, das migrations, do histórico
> do Git, do **banco remoto** e do **site em produção**. Nada aqui é
> planejamento: é o que existe hoje. O que é planejado está em
> `ROADMAP_DESENVOLVIMENTO.md`.
>
> | Referência | Valor |
> |---|---|
> | `origin/main` | `13f6ac7` (merge do PR #52) |
> | Último merge | 03/08/2026 16:57 (horário local) |
> | Migrations no repositório | 81, de `20260415164717` a `20260730120000` |
> | Migrations aplicadas no remoto | **as mesmas 81** — nenhuma pendente, nenhuma órfã |
> | Produção | `https://barbaflow-delta.vercel.app` — no ar, rodando a `main` |
> | Banco | `qfcngyyzyiwotehubifx` (**único projeto Supabase que existe**) |
>
> Esta revisão **substituiu por completo** a versão de 28/07/2026, que era
> anterior aos itens C1–C5 do roadmap, à migração Nitro e aos PRs #34–#52.
> Cada afirmação sobre o banco, a produção e as vulnerabilidades foi conferida
> nesta sessão — a §14 lista exatamente o que foi executado e o que continua
> sendo inferência.

---

## 1. Arquitetura

Aplicação **full-stack em um único repositório**, com SSR:

```
navegador ──► TanStack Start (SSR + rotas de arquivo)  ──► Nitro ──► Vercel
                  │
                  ├─ cliente Supabase do navegador (chave publicável, RLS ativa)
                  │      └─► PostgREST / Auth / Realtime / Storage
                  │
                  ├─ rotas de servidor  src/routes/hooks/*   (chave administrativa)
                  │
                  └─ Edge Functions  supabase/functions/*     (chave administrativa)
```

Quatro decisões estruturais explicam quase tudo no código:

**Multi-tenant por barbearia.** Cada linha carrega `barbershop_id`, e o
isolamento é feito por RLS no banco — não no frontend.
`src/hooks/use-barbershop.tsx` resolve o tenant ativo (por subdomínio ou por
papel do usuário) e `src/hooks/use-tenant-scope.tsx` distribui esse escopo às
telas, junto com o papel exigido.

**Fonte de dados intercambiável.** `VITE_DATA_SOURCE=mock` troca o cliente
Supabase por um cliente fictício completo (`src/mocks/client.ts`, 1.195 linhas)
que implementa o subconjunto da API usado pelo app, lendo e gravando só em
`localStorage`. É o que permite rodar e testar o produto inteiro sem rede e sem
banco. A troca acontece num ponto só: `src/integrations/supabase/client.ts`,
decidida por `src/lib/data-source.ts` (padrão: `supabase`).

**Testes por harness, não por framework.** Não há Vitest/Jest. A lógica de
negócio é extraída para `src/lib/*` em funções puras, e cada frente tem um
harness em `src/mocks/__harness__/*.ts` (ou direto no `.mjs`) executado por um
script que usa o Vite só para resolver `@` e compilar TS sob demanda. Zero
dependência nova. Boa parte das verificações é **varredura estática do
código-fonte** — é assim que regras como "nenhum componente importa
`client.server`" viram teste.

**Não existe middleware de autenticação.** As guardas são `useEffect` por
página, que redirecionam para `/login` quando não há sessão ou papel.
Consequência prática: toda rota nova precisa declarar sua própria guarda, e
rotas públicas simplesmente não declaram nada.

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Framework | TanStack Start 1.167 + TanStack Router 1.168 (rotas por arquivo) |
| UI | React 19.2, Tailwind CSS 4.2, Radix UI (46 componentes em `src/components/ui`), lucide-react, framer-motion |
| Estado/dados | TanStack Query 5.83, React Hook Form 7.71 + Zod 3.24 |
| Backend | Supabase (Postgres 17.6 + Auth + Realtime + Storage + Edge Functions) |
| Build | Vite 7.3 via `@lovable.dev/vite-tanstack-config` v2; dev na porta **8080** (`strictPort`) |
| Deploy | **Nitro** — preset `vercel` quando `VERCEL=1`, `cloudflare-module` fora dela |
| Relatórios | recharts 2.15, jspdf 4.2 |
| Qualidade | TypeScript 5.8 (`tsc --noEmit`), ESLint 9 + Prettier, 12 harnesses próprios |

Sobre o deploy: **a `main` não está mais no preset Cloudflare.** Desde o PR #34
o wrapper substituiu o plugin do Cloudflare pelo Nitro, e `vite.config.ts` é
deliberadamente vazio (`defineConfig()` sem opções) — fixar um preset ali
quebraria um dos dois alvos. `wrangler.jsonc` continua no repositório como
fallback Cloudflare, com `nodejs_compat` ligado; não é o caminho usado hoje.

---

## 3. Módulos

### Rotas públicas (sem sessão)

| Rota | Arquivo | Função |
|---|---|---|
| `/` | `routes/index.tsx` + `LandingHero`, `ReviewsShowcase` | Landing |
| `/agendar` e `/agendar/$slug` | `routes/agendar.*.tsx` + `components/booking/*` | Agendamento público em assistente; a vitrine de produtos (`ProductsShowcase`) vive aqui, não na landing |
| `/barbearias` | `routes/barbearias.tsx` | Diretório de barbearias aprovadas |
| `/login` | `routes/login.tsx` + `AuthForm` | Entrar, criar conta, recuperar senha, OAuth Google/Apple |
| `/reset-password` | `routes/reset-password.tsx` | Definir nova senha |
| `/convite` | `routes/convite.tsx` | Aceite de convite de equipe (exige sessão — ver §6) |
| `/contato`, `/sobre`, `/termos`, `/privacidade`, `/reembolso` | `routes/*.tsx` | Institucional |
| `/sitemap.xml`, `/manifest.json` | `routes/sitemap[.]xml.tsx`, `routes/manifest[.]json.tsx` | SEO e PWA |

### Rotas autenticadas

| Rota | Arquivo | Função |
|---|---|---|
| `/dashboard` | `routes/dashboard.tsx` + `AdminDashboard`, `BarberDashboard`, `OperationalDashboard` | Painel por papel |
| `/agenda` | `routes/agenda.tsx` + `ScheduleManager`, `ScheduleBlocks`, `WeeklyScheduleEditor` | Agenda, bloqueios, jornada |
| `/clientes` | `routes/clientes.tsx` (1.521 linhas) | Base de clientes e histórico |
| `/comandas` | `routes/comandas.tsx` + `ComandasManager`, `ComandaDetailDialog`, `CloseComandaDialog`, `CloseTicketDialog` | Comandas, produtos, fechamento |
| `/servicos` | `routes/servicos.tsx` + `ServicesManager` | Catálogo de serviços |
| `/relatorios` | `routes/relatorios.tsx` + `BarberReports`, `NoShowReport` | Vendas, no-show, PDF |
| `/configuracoes` | `routes/configuracoes.tsx` + `BarbershopSettings` (1.540 linhas), `TeamManager` | Barbearia, equipe, tema, recibo |
| `/perfil` | `routes/perfil.tsx` | Dados, foto, exclusão de conta |
| `/meus-agendamentos` | `routes/meus-agendamentos.tsx` + `AppointmentHistory`, `RescheduleDialog`, `ReviewDialog` | Área do cliente |
| `/onboarding` | `routes/onboarding.tsx` + `OnboardingWizard` | Criação da barbearia |
| `/upgrade` | `routes/upgrade.tsx` + `PlanCard`, `PlanPaywallModal` | Planos (**cobrança pausada**) |
| `/admin/churn` | `routes/admin.churn.tsx` | Visão de plataforma (super admin) |
| `/admin/mensagens` | `routes/admin.mensagens.tsx` | **Novo (PR #31)** — caixa de entrada do formulário de contato, só super admin |

### Servidor e integrações

| Item | Arquivo | Observação |
|---|---|---|
| Cron de exclusão de contas | `routes/hooks/process-account-deletions.ts` | Chave administrativa; protegido por `CRON_SECRET` |
| Cron de reset mensal | `routes/hooks/reset-monthly-appointments.ts` | Chave administrativa; protegido por `CRON_SECRET` |
| Porta única de autorização de cron | `lib/cron-auth.server.ts` | `timingSafeEqual` sobre digests SHA-256; falha fechada |
| Edge Functions | `supabase/functions/{delete-account, cancel-account-deletion, create-portal-session, get-paddle-price, payments-webhook}` | As três últimas são de pagamento |
| Cliente administrativo | `integrations/supabase/client.server.ts` | Só rotas de servidor podem importar — travado por harness |

---

## 4. Autenticação, papéis e RLS

### Como a identidade entra

O login é o **Auth do Supabase**: e-mail/senha, mais OAuth Google e Apple
configurados no painel. O SSR e o navegador usam a **chave publicável**, que é
pública por definição — a proteção real é a RLS, nunca o segredo da chave.

Recuperação de senha: `lib/password-recovery.ts` + `lib/auth-redirect.ts`. A
URL de retorno é montada num ponto só; no navegador vence a origem atual, e no
SSR ela cai em `PRODUCTION_ORIGIN` (`https://barbaflow-delta.vercel.app`) se
`PUBLIC_SITE_URL` não estiver definida. Cada endereço usado precisa estar em
**Authentication → URL Configuration → Redirect URLs**, à mão no painel — o
passo a passo está em `docs/RECUPERACAO_SENHA.md`. O harness `senha` (80
verificações) trava as regras: nenhuma URL montada à mão, nenhum domínio de
Preview aceito, nenhum arquivo do fluxo tocando chave administrativa.

### Os quatro papéis

`app_role` é um enum do Postgres, criado na primeira migration:

| Papel | Como se ganha | O que alcança |
|---|---|---|
| `cliente` | **Automático** na primeira sessão (`use-auto-client-role`, `AutoClientRole`) | `/meus-agendamentos`, agendar, avaliar |
| `barbeiro` | Só por **convite aceito** (`accept_team_invitation`) | `/dashboard` (visão de barbeiro), `/agenda`, `/comandas`, `/relatorios` do próprio tenant |
| `admin_barbearia` | Onboarding (dono da barbearia) ou convite | Tudo do tenant: equipe, serviços, produtos, configurações |
| `super_admin` | **Fora do app** — `supabase/bootstrap/super-admin.example.sql`, aplicado à mão | `/admin/churn`, `/admin/mensagens`, e qualquer tenant |

Os papéis vivem em `public.user_roles (user_id, barbershop_id, role)` — nunca
numa coluna de `profiles`, e nunca no JWT. Quem decide é o banco, por
`has_role()` / `has_role_in_barbershop()`, funções `SECURITY DEFINER` com
`search_path` fixo.

### O que a RLS garante hoje

- **Tabelas de tenant** (`appointments`, `services`, `products`, `clients`,
  `tickets`, `weekly_schedule`, …): política por `barbershop_id` cruzada com
  `user_roles`. Migration `20260722170000_tenant_scoped_module_policies.sql`.
- **`profiles`**: leitura restrita desde `20260722240000`; telefone de cliente
  só sai por RPC `SECURITY DEFINER`, e só para barbeiro/admin da barbearia onde
  ele agendou.
- **`products`**: desde 30/07 o anônimo **não tem nenhum acesso direto** — nem
  policy, nem `GRANT`. O catálogo público sai pela RPC `get_public_products`
  (§7).
- **`contact_submissions`**: `anon` tem **INSERT e só INSERT**; a leitura é
  exclusiva do super admin. Desde 03/08 há também cinco `CHECK` de tamanho e
  formato e um trigger de vazão por e-mail.
- **Última barbearia com admin**: `20260721130000` impede remover o último
  `admin_barbearia` de uma barbearia.
- **Agendamentos sobrepostos**: `20260722180000` impede no banco, não só na tela.
- **Limite de barbeiros por plano**: `20260720130000` valida no servidor, dentro
  do próprio `accept_team_invitation`.

O que a RLS **não** faz: não substitui a guarda de rota. Uma rota nova sem
`useEffect` de guarda abre a tela (vazia, porque a RLS filtra) para quem não
deveria vê-la.

---

## 5. Estado de cada funcionalidade

### 5.1 Concluídas e cobertas por teste

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
| **Catálogo público (2 fases)** | `harness:catalogo-publico` (106) | `catalogo-publico-harness.ts` |
| **Mensagens de contato** | `harness:mensagens-contato` (133) | `mensagens-contato-harness.ts` |
| **Autorização dos endpoints de cron** | `harness:cron-endpoints` (89) | `cron-endpoints-harness.ts` |
| **Recuperação de senha** | `harness:senha` (80) | `recuperacao-senha-harness.ts` |
| Comandas e clientes | `harness:db` (2 suítes) | exigem Postgres local |

### 5.2 Parciais ou bloqueadas

| Módulo | Situação | Onde está |
|---|---|---|
| **Convite de equipe** | Funciona ponta a ponta **desde que o convidado já tenha conta e o link chegue nele por fora**. Ver §6. | `TeamManager.tsx`, `routes/convite.tsx` |
| **Notificações por e-mail de agendamento** | Só `console.log`. O envio está escrito e comentado, esperando domínio verificado e provedor. | `lib/notifications.ts:41,68` |
| **Cobrança / assinaturas** | Desligada por flag (`BILLING_UI_ENABLED = false`). Toda a infraestrutura (hooks, 3 Edge Functions, rota `/upgrade`, migrations) permanece intacta e inalcançável pela interface. | `lib/billing-ui.ts:20` |
| **Múltiplas unidades** | Anunciado como "em breve" no plano Enterprise da landing. Não há código. | `LandingHero.tsx` |
| **Resolução de tenant** | `DEFAULT_BARBERSHOP_ID` continua sendo o último recurso do campo legado `barbershopId`, com `TODO` na primeira linha do arquivo. As telas críticas (`/agenda`, `/comandas`, `/clientes`, dashboard) já migraram para `useTenantScope`, que **não** usa a sentinela — mas o campo legado ainda existe e 7 arquivos o citam. | `lib/constants.ts:1`, `hooks/use-barbershop.tsx:256` |
| **`harness:db`** | 3 suítes de integração exigem Postgres local (`npx supabase start`, o único uso de Docker no projeto). Sem Docker elas ficam SKIPPED — e SKIPPED **não é** PASS. | `scripts/run-harness-suite.mjs` |

### 5.3 O que foi **fechado** desde a revisão de 28/07

Registrado aqui de propósito, porque a versão anterior deste documento listava
tudo isto como aberto:

| Item | Como fechou |
|---|---|
| Endpoints de cron abertos (bugs #1 e #2) | PR #32 — `CRON_SECRET`, checagem em tempo constante, falha fechada. **Verificado ao vivo em produção** (§14) |
| `products` legível por anônimo (bug #3) | Fase 1 (PR #29 + aplicação no remoto) e Fase 2 (PR #39). **Verificado ao vivo** — anon leva 401 na tabela e 200 na RPC (§14) |
| Recuperação de senha quebrada | PR #40 |
| `npm run dev` quebrado pelo `@import` remoto de fontes | PR #37 |
| Formulário de contato sem destino | PR #31 — `/admin/mensagens` |
| `contact_submissions` sem limite nenhum | Migration `20260729120000`, aplicada e validada em 03/08 |
| `main` divergindo do build de deploy | PR #34 — Nitro/Vercel na `main` |
| Preview improvisado do cliente | Encerrado em 31/07; branch `preview/cliente-vercel` apagada. **Confirmado: não existe mais nem local nem no remoto** |
| `.vercel/` sujando o `git status` | Já está no `.gitignore` da `main` |
| `barbaflow.pro` (domínio que não existe) no código | PRs #45 e #46 |

---

## 6. O fluxo do barbeiro — o que existe de fato

Esta seção existe porque o fluxo é o mais irregular do produto: cada peça
funciona, e mesmo assim ninguém entra sozinho.

### O que funciona

1. **Convite.** O admin abre `/configuracoes` → `TeamManager`, digita o e-mail e
   escolhe o papel (`barbeiro` ou `admin_barbearia`). Isso grava uma linha em
   `team_invitations` com token e validade de 7 dias. O limite de barbeiros do
   plano é validado **no servidor**, dentro da RPC de aceite.
2. **Link.** O admin copia o link (`/convite?token=…`) pelo botão de copiar.
3. **Aceite.** O convidado abre o link **já logado**; `accept_team_invitation`
   confere token, validade e **se o e-mail do convite bate com o da conta**,
   insere em `user_roles` e marca o convite como aceito.
4. **Agenda própria.** Desde o PR #44 há link para `/agenda` no cabeçalho, ao
   lado de Comandas e Relatórios. A rota autoriza `admin_barbearia` e `barbeiro`
   pelo `useTenantScope`, e a RLS deixa o barbeiro editar a própria grade
   (`barber_id = auth.uid()`).

### As lacunas — todas confirmadas no código

| Lacuna | Onde se vê | Efeito |
|---|---|---|
| **Nenhum e-mail é enviado.** O botão diz "Enviar Convite" e o toast diz "Convite enviado para …", mas o código só faz `INSERT` em `team_invitations`. | `TeamManager.tsx:197-214` | O admin **precisa** copiar o link e mandar por WhatsApp/e-mail por fora. Quem espera o convite chegar sozinho espera para sempre |
| **Não há auto-cadastro pelo convite.** `accept_team_invitation` devolve "Não autenticado" se `auth.uid()` for nulo, e a página redireciona para `/login`. | `20260415174544…sql`, `convite.tsx:40-45` | O barbeiro tem de **criar conta antes**, com exatamente o mesmo e-mail do convite. Não há tela que explique isso |
| **O e-mail precisa bater exatamente.** Se ele se cadastrar com outro endereço, a RPC devolve "Este convite não é para o seu email". | mesma migration | Falha silenciosa do ponto de vista do admin: o convite continua "pendente" |
| **A nav de abas do `BarberDashboard` só renderiza para admin** (`isAdmin`), e `activeTab` nasce em `"overview"`. | `BarberDashboard.tsx:300,408` | O barbeiro vê só a visão geral dentro do dashboard. Tudo o mais ele alcança por links do cabeçalho — foi exatamente esse o buraco que o PR #44 tapou para `/agenda` |
| **Nenhum aviso ao convidado** de que o convite existe, expirou ou foi cancelado | — | Os três estados existem no banco (`pending`/`expired`/`cancelled`) e aparecem só para o admin |

Resumindo: o caminho suportado hoje é **"o admin convida, copia o link, manda
por fora, e o barbeiro cria a conta com o mesmo e-mail antes de abrir o link"**.
Nada disso está escrito em nenhuma tela. Destravar o envio de e-mail depende de
domínio verificado e provedor contratado (B1 do roadmap); o auto-cadastro pelo
convite **não** depende disso e não tem item próprio no roadmap.

---

## 7. Banco de dados remoto

| Item | Valor |
|---|---|
| Projeto | `qfcngyyzyiwotehubifx` — **o único que existe na organização** |
| Postgres | 17.6.1.147, `ACTIVE_HEALTHY`, região `us-west-2` |
| `project_id` do CLI | `barbaflow` (`supabase/config.toml`) |
| Migrations versionadas | **81**, de `20260415164717` a `20260730120000` |
| Migrations aplicadas | **81** — conferido linha a linha contra `supabase_migrations.schema_migrations` |
| Divergência de histórico | **nenhuma**: zero migrations locais não aplicadas, zero aplicadas sem arquivo |
| Edge Functions | 5, mais `_shared/paddle.ts` |
| Bootstrap do super admin | `supabase/bootstrap/super-admin.example.sql` (exemplo, aplicação manual) |

> **Não há projeto Supabase de produção separado.** `qfcngyyzyiwotehubifx` é ao
> mesmo tempo o banco do desenvolvimento, o da homologação e o que o site em
> produção usa. `DESENVOLVIMENTO_REMOTO.md` §11 ainda descreve produção como
> "não configurado neste repositório" — a frase é literalmente verdadeira
> (nenhum script daqui aponta para outro lugar), mas dá a impressão errada de
> que existe um segundo banco. **Não existe.** Todo cuidado com esse projeto é
> cuidado com produção.

### As duas últimas migrations, aplicadas e verificadas

**`20260729120000_contact_submissions_limits.sql`** — cinco `CHECK` de tamanho
e formato (nome, e-mail, formato de e-mail, telefone, mensagem) e um trigger de
vazão por e-mail. Aplicada em 03/08/2026. As constraints nasceram `NOT VALID`
para não falhar em linha histórica; a tabela estava vazia, os cinco
`VALIDATE CONSTRAINT` rodaram na sequência, e hoje `convalidated = true` nas
cinco — **reconferido nesta revisão**. O trigger
`contact_submissions_rate_limit` existe.

**`20260730120000_public_product_catalog_phase2.sql`** — fecha o acesso direto
do anônimo a `products`. O `relacl` da tabela hoje concede a `anon` apenas
`Dxtm` (nada de `SELECT`), e as únicas policies restantes são as quatro de
staff. Foi aplicada no remoto **antes** de o arquivo ser versionado, e o
histórico foi acertado com `supabase migration repair` — está registrado na
mensagem do commit `23c7297`.

O padrão de duas fases que essas migrations inauguraram (aditiva primeiro,
restritiva só depois de a aditiva estar em uso real) é a regra do projeto para
qualquer mudança de permissão. O harness `catalogo-publico` chegou a falhar de
propósito enquanto a fase 2 não podia existir; hoje ele verifica as duas.

### Como ler o estado do banco

```bash
npm run db:status:remote     # somente leitura
npm run db:lint:remote       # somente leitura
npm run db:dry-run           # o que seria aplicado; não escreve
npm run types:check          # tipos versionados x schema remoto
```

Os quatro exigem `SUPABASE_DB_PASSWORD` no `.env.local`. Nenhum escreve. O
`db push` real **não tem script de npm, de propósito** — é sempre digitado à
mão, depois de um dry-run limpo e com autorização.

---

## 8. Ambiente de deploy

| Item | Estado |
|---|---|
| Plataforma | Vercel, projeto `barbaflow` (`prj_1XfhtmyL5SoqMUdAzmQgIWXaPMsB`), vinculado em `.vercel/repo.json` (não versionado) |
| Build | Nitro, preset `vercel` (`VERCEL=1`), saída em `.vercel/output` (Build Output API v3) |
| Ambiente | **só Produção.** O Preview improvisado (`preview/cliente-vercel`) foi encerrado em 31/07 e a branch não existe mais |
| URL pública | `https://barbaflow-delta.vercel.app` — a única que responde sem o SSO da Vercel |
| Fonte da produção | a `main`. O deploy de 03/08 já não tem o botão "Instalar App" (PR #50), o que confirma que produção está no `main` corrente |
| `vercel.json` | não existe; toda a configuração é do wrapper + painel |

Variáveis de ambiente: são **build-time por target** para tudo que tem prefixo
`VITE_`. Uma variável cadastrada só em Preview não existe em Production, e o
sintoma é traiçoeiro — o SSR responde 200 e só o cliente quebra, sem nada nos
logs. `CRON_SECRET` está configurada em Production: os dois endpoints
respondem `401`, e não `500`, quando chamados sem o segredo (§14).

**Nesta máquina o `.env` está com todos os valores vazios e
`VITE_DATA_SOURCE=mock`.** É um ambiente de trabalho de interface: o app sobe em
modo fictício, e nenhum script remoto roda sem alguém preencher as variáveis.

---

## 9. Dependências externas

### 9.1 E-mail

| O que depende | Situação |
|---|---|
| Confirmação de cadastro, recuperação de senha | **Auth do Supabase.** Funciona com o SMTP padrão (limitado) ou com um SMTP próprio no painel |
| Convite de equipe | **Nada é enviado pelo app** — a linha entra em `team_invitations` e o link é copiado à mão. Ver §6 |
| Confirmação e cancelamento de agendamento | **Nada é enviado.** Só `console.log`, com o envio comentado (`lib/notifications.ts`) |
| Formulário de contato | Grava no banco; ninguém recebe e-mail. A leitura é pela tela `/admin/mensagens` |

O bloqueio é o mesmo para os três casos: **não há domínio verificado nem
provedor de envio transacional contratado.** É decisão de negócio, não de
código.

### 9.2 Pagamento

Provedor: **Paddle**. `VITE_PAYMENTS_CLIENT_TOKEN` no frontend; as chaves de
servidor ficam nas Edge Functions.

| Peça | Arquivo |
|---|---|
| Checkout | `hooks/use-paddle-checkout.ts`, `lib/paddle.ts` |
| Preço | Edge Function `get-paddle-price` |
| Portal do assinante | Edge Function `create-portal-session` |
| Webhook | Edge Function `payments-webhook` |
| Banner de modo de teste | `components/PaymentTestModeBanner.tsx` |

**Tudo inacessível pela interface**: `BILLING_UI_ENABLED = false` esconde
botões de assinatura, checkout e CTAs de upgrade. Permanecem visíveis o rótulo
do plano, o uso e os avisos de limite — informativos.

### 9.3 Outras

| Dependência | Onde |
|---|---|
| ViaCEP (endereço) | `lib/cep.ts` — API pública, sem chave |
| Google Fonts | `<link>` no `__root.tsx` (o `@import` remoto no CSS foi removido no PR #37) |
| OAuth Google e Apple | Painel do Supabase |
| Storage de fotos de perfil | Bucket `avatars` do Supabase |
| Agendador dos dois `/hooks/*` | **Nenhum agendador está versionado.** Quem chamar precisa mandar `Authorization: Bearer <CRON_SECRET>` |

---

## 10. Riscos e vulnerabilidades

### 10.1 Segurança — nada crítico em aberto

As três vulnerabilidades da revisão de 28/07 estão **fechadas e conferidas ao
vivo** nesta revisão. Não herdei nenhuma delas: cada uma foi testada contra o
ambiente real antes de sair desta lista (§14).

### 10.2 Segurança — verificado e saudável

- Os dois endpoints `/hooks/*` recusam com `401` requisição sem segredo, com
  header arbitrário, com bearer errado e com `lovable-context` — **em
  produção**, agora.
- `anon` não lê `products`, `profiles` nem `contact_submissions` (401,
  `permission denied`). Lê `barbershops` aprovadas, que é o esperado.
- A RPC `get_public_products` devolve `in_stock` booleano, sem
  `stock_quantity` e sem produtos inativos — testada com três barbearias reais.
- Nenhum componente, hook ou lib importa `client.server`; só rotas de servidor.
- `SERVICE_ROLE` nunca é lida de `import.meta.env`; nenhuma variável
  administrativa usa prefixo `VITE_`.
- Erros técnicos são redigidos antes do console (JWT, `sb_secret`, `apikey`,
  senha, `Authorization`) — `lib/error-reporting.ts`.
- As quatro últimas garantias são **travadas por teste** (`harness:erros`,
  `harness:cron-endpoints`).

### 10.3 O que continua sendo risco — operação, não vulnerabilidade

| Risco | Detalhe | Gravidade |
|---|---|---|
| **Um banco só para tudo** | Desenvolvimento, homologação e produção compartilham `qfcngyyzyiwotehubifx`. Um seed, um cleanup ou um `db push` mal medido atinge o site no ar | **Alta** — é o risco estrutural do projeto hoje |
| **Dados de seed vivos em produção** | Há barbearias `[SEED TESTE]` aprovadas e visíveis ao anônimo em `/barbearias` e na busca. Foi conferido: aparecem na resposta pública | Média |
| **Nenhum agendador para os `/hooks/*`** | O reset mensal e o processamento de exclusões não rodam sozinhos. Se algum agendador externo existia antes do PR #32, ele parou de funcionar naquele dia (não manda o `CRON_SECRET`) | Média — **vale confirmar com quem opera** |
| **Sem CI** | Não existe `.github/workflows`. `tsc`, `build` e `harness:core` dependem de disciplina de quem commita | Média |
| **`harness:db` quase nunca roda** | 3 suítes de integração exigem Docker; na prática ficam SKIPPED | Média |
| **Nenhuma validação visual registrada** | Nenhuma tela do produto tem conferência visual arquivada, nos três papéis. Os PRs #47–#49 mostraram o custo disso: três defeitos de cabeçalho seguidos, cada um encontrado só depois do anterior | Média |
| **Sentinela de tenant ainda viva** | `DEFAULT_BARBERSHOP_ID` continua sendo o fallback do campo legado. As telas críticas já não o usam, mas o campo existe | Baixa hoje, alta se alguém escrever tela nova usando o campo legado |

---

## 11. Testes

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
| catalogo-publico | `npm run harness:catalogo-publico` | 106 | não |
| mensagens-contato | `npm run harness:mensagens-contato` | 133 | não |
| cron-endpoints | `npm run harness:cron-endpoints` | 89 | não |
| senha | `npm run harness:senha` | 80 | não |
| cliente | `npm run harness:cliente` | — | **sim** |
| comandas | `npm run harness:comandas` | — | **sim** |
| agenda-concorrencia | `npm run harness:agenda-concorrencia` | — | **sim** |

`npm run harness:core` roda as **12 primeiras**: **865 verificações**, todas
verdes — executado nesta revisão. `docs/DESENVOLVIMENTO_REMOTO.md` §6 ainda diz
"8 suítes"; está desatualizado desde a entrada de `catalogo-publico`.

O runner distingue **PASS / FAIL / SKIPPED / NOT RUN** e soma só o que
executou. Uma suíte SKIPPED não passou — ela não aconteceu.

### O que não existe

- **Nenhum teste de componente React.** Os harnesses testam funções puras e
  fazem varredura estática; não montam a árvore React.
- **Nenhum teste de ponta a ponta** (Playwright/Cypress).
- **Nenhuma validação visual automatizada.**
- **Nenhum CI configurado.**

---

## 12. Branches

**38 locais, 44 remotas.** As de feature já mescladas continuam existindo —
histórico útil, ruído para quem chega agora.

### 12.1 Branches especiais

| Branch | O que é | Regra |
|---|---|---|
| `feat/assinaturas-cobranca` | Referência da frente de cobrança, removida da `main` pelo PR #25. Existe local e no remoto | Preservar |
| `origin/security/cron-fix-preview` | Única ref que preserva o commit `35ca4ba` do fix de cron | **Não apagar sem antes conferir** |
| `chore/vercel-nitro` | Já mesclada (PR #34). Não tem mais função | Pode ser apagada |

> `chore/seed-demo-cliente`, citada na revisão anterior como portadora de um
> `stash` pendente, **não existe mais** — nem local, nem no remoto. E
> `git stash list` nesta máquina está vazio. O item some da lista de cuidados.

> **`preview/cliente-vercel` não existe mais** — nem local, nem remota.
> Confirmado nesta revisão. Foi apagada no encerramento do C5, em 31/07, e
> **não deve ser recriada**: o cliente testa na produção da `main` desde então.
> A regra antiga "nunca mesclar `preview/cliente-vercel`" perdeu o objeto.

### 12.2 Trabalho não mesclado

**Nenhum.** Todas as branches com trabalho pendente da revisão anterior
(`fix/recuperacao-senha`, `fix/import-fontes-css`, `fix/protege-endpoints-cron`,
`feat/leitura-mensagens-contato`, `chore/vercel-nitro`) foram mescladas nos PRs
#32–#41. Não há PR aberto no momento.

---

## 13. Dívida técnica e código morto

| Item | Onde | Impacto |
|---|---|---|
| `DEFAULT_BARBERSHOP_ID` como sentinela do campo legado | `lib/constants.ts` + 7 arquivos | Tela nova que use `barbershopId` (legado) consulta uma barbearia inexistente. As telas críticas já migraram |
| `npm run lint` não é usável como portão | CRLF + Prettier: **3.346 problemas só em `src/lib` + `src/hooks`**, 3.344 deles `Delete ␍`. A execução na base inteira não termina em tempo útil | Impede transformar o lint em portão de commit |
| Arquivos muito grandes | `BarberDashboard.tsx` (1.981), `BarbershopSettings.tsx` (1.540), `clientes.tsx` (1.521), `mocks/client.ts` (1.195), `ManualAppointmentDialog.tsx` (1.106) | Revisão e teste difíceis; foi o terreno dos três defeitos de cabeçalho dos PRs #47–#49 |
| Constante depreciada de fuso | `lib/tz.ts:33` | Compatibilidade; sempre devolve o default |
| RPCs e operadores não implementados no mock | `mocks/client.ts`, `mocks/query-builder.ts` | Avisam no console e devolvem `null`/ignoram o filtro |
| `DESENVOLVIMENTO_REMOTO.md` desatualizado | §6 ("8 suítes", hoje 12) e §11 (dá a entender que existe produção separada) | Documentação que engana |
| 38 branches locais, quase todas mescladas | `git branch` | Ruído |
| Infra do Paddle mantida sem uso | 3 Edge Functions, hooks, `/upgrade` | Código vivo, inalcançável pela interface |
| Sem CI | não existe `.github/workflows` | Nada impede um commit que quebra `tsc` |
| `wrangler.jsonc` mantido | raiz | Fallback Cloudflare que ninguém usa; custa uma pergunta a cada leitura |

---

## 14. Verificado em 04/08/2026

Esta seção separa o que foi **executado** do que é **inferência**. A revisão
anterior não pôde tocar o banco nem a produção; esta pôde.

### 14.1 Executado nesta revisão — resultado real

| # | O que foi feito | Resultado |
|---|---|---|
| 1 | `npx tsc --noEmit` | **limpo**, exit 0 |
| 2 | `npm run harness:core` | **12 PASS, 0 FAIL, 0 SKIPPED — 865 verificações** |
| 3 | `npx supabase --version` e `projects list` | CLI **executa e está autenticado** (2.111.0), vinculado a `qfcngyyzyiwotehubifx`. **A afirmação antiga de que o Smart App Control bloqueia o CLI nesta máquina não vale mais** — o registro ainda marca `VerifiedAndReputablePolicyState = 1`, mas o binário roda |
| 4 | `projects list` | **um único projeto** na organização: `barbaflow`. Não existe projeto de produção separado |
| 5 | `supabase_migrations.schema_migrations` (Management API, `read_only`) | **81 locais = 81 remotas**, última `20260730120000`, zero divergências nos dois sentidos |
| 6 | `pg_policy` + `relacl` de `public.products` | Sobraram só as 4 policies de staff; `anon` tem `Dxtm` e **não tem `SELECT`**. RLS ligada |
| 7 | `GET /rest/v1/products` com a chave anônima real | **401 `permission denied for table products`** |
| 8 | `POST /rest/v1/rpc/get_public_products` como anônimo, em 3 barbearias | **200**, com `in_stock` booleano, sem `stock_quantity` |
| 9 | `GET /rest/v1/profiles` e `/contact_submissions` como anônimo | **401** nos dois |
| 10 | `GET /rest/v1/barbershops` como anônimo | 200 — e revelou que há barbearias `[SEED TESTE]` aprovadas em produção |
| 11 | `pg_constraint` de `contact_submissions` | as **5 CHECK com `convalidated = true`**, e o trigger `contact_submissions_rate_limit` presente |
| 12 | `GET` em 6 rotas públicas de `https://barbaflow-delta.vercel.app` | `/`, `/login`, `/barbearias`, `/agendar`, `/contato`, `/reset-password` → **200**, com o `<title>` esperado |
| 13 | `POST` nos dois `/hooks/*` em produção, em 4 formatos de ataque | **401 `{"error":"unauthorized"}` nos 8 casos** — e o 401 (em vez de 500) prova que `CRON_SECRET` está configurada em Production |
| 14 | HTML de produção | não contém "Instalar App" → produção está no `main` corrente (PR #50) |
| 15 | `git branch -a` após `fetch --prune` | `preview/cliente-vercel` **não existe** em lugar nenhum |
| 16 | `gh pr list` | **nenhum PR aberto**; #52 foi mesclado em 03/08 16:57 |
| 17 | Leitura do código de convite, aceite e dashboard do barbeiro | As lacunas da §6 são do código, não suposição |
| 18 | `npx eslint src/lib src/hooks` | **3.346 problemas** em duas pastas — 3.344 deles `Delete ␍` (CRLF). O lint segue inutilizável como portão. `npx eslint .` na base inteira foi disparado, consumiu mais de 14 minutos de CPU e terminou sem produzir saída |

Os comandos que **escrevem** — `db push`, seed, cleanup, `migration repair` —
**não foram executados**, e nenhuma consulta ao banco saiu do modo somente
leitura.

### 14.2 Inferência — não foi executado

| Afirmação | Base | Como confirmar |
|---|---|---|
| A migration `20260729120000` foi aplicada **em 03/08 com a tabela vazia** | Mensagem do commit `9535c64` e o rodapé da própria migration | Só o registro escrito na época; hoje só dá para ver o resultado (constraints validadas), não a data |
| A fase 2 do catálogo foi aplicada **antes** de o arquivo ser versionado, com `migration repair` | Mensagem do commit `23c7297` | Idem |
| `npm run db:status:remote`, `db:lint:remote`, `db:dry-run` e `types:remote` funcionam | Nunca executados de fato — exigem `SUPABASE_DB_PASSWORD`, que **não está** no `.env.local` desta máquina. O estado do banco aqui foi lido pela Management API, não por eles | Preencher a senha e rodar os quatro |
| `harness:db` (3 suítes) passa | Depende de Docker; não foi tentado | `npx supabase start && npm run harness:db` |
| Não há agendador externo chamando os `/hooks/*` | Nenhum está versionado; nada prova que não exista um fora do repositório | Perguntar a quem opera, ou olhar o painel da Vercel/serviço de cron |
| As telas internas (dashboard, agenda, clientes, comandas, relatórios, configurações) funcionam | Nenhuma foi aberta nesta revisão, em nenhum papel. As verificações de produção foram só nas 6 rotas públicas | Percurso manual em modo mock ou com conta de seed (M1 do roadmap) |
| O **total** de problemas de lint na base | Só `src/lib` e `src/hooks` foram medidos (3.346). A base inteira não terminou de rodar | Rodar por diretório, somando |

### 14.3 O que mudou de opinião desde 28/07

Duas afirmações do documento anterior **não sobreviveram à conferência** e
foram removidas em vez de reescritas:

1. **"Supabase CLI bloqueado no Windows / nenhum comando de banco roda nessa
   máquina."** Falso hoje: o CLI executa, está autenticado e vinculado. O que
   falta é a senha do banco no `.env.local`, que é outro problema, bem menor.
2. **"Produção não configurada neste repositório."** Tecnicamente verdadeiro,
   praticamente enganoso: existe **um** projeto Supabase, e é ele que o site em
   produção usa. Tratar `qfcngyyzyiwotehubifx` como "ambiente de
   desenvolvimento" é o erro mais caro que dá para cometer neste projeto.

---

## 15. Comandos de validação

```bash
# Sem banco, sem rede — o portão do dia a dia, antes de todo commit
npx tsc --noEmit
npm run build
npm run harness:core

# Frontend (porta 8080, strictPort)
npm run dev                            # com VITE_DATA_SOURCE=mock roda offline

# Banco remoto — somente leitura, exigem CLI vinculado + SUPABASE_DB_PASSWORD
npm run db:status:remote
npm run db:lint:remote
npm run db:dry-run
npm run types:check

# Integração (exigem Postgres local via `npx supabase start`)
npm run harness:db
npm run harness:all                    # não fica verde se algo for pulado
```

Antes de qualquer commit: `git diff --check` e `git status --short`.

**Nunca**: `supabase db reset --linked`, `db push` sem dry-run, `migration
repair` sem diagnóstico, seed automático no remoto, `supabase stop --all`.
As regras de trabalho do dia a dia — inclusive as que existem porque já
custaram caro — estão em `CLAUDE.md`, na raiz.
