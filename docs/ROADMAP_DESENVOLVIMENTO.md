# Roadmap de desenvolvimento — BarbaFlow

> Montado em **28/07/2026** a partir de `docs/ESTADO_ATUAL_PROJETO.md`. Todo item
> aponta para código, migration ou branch que já existem. **Nada aqui é
> funcionalidade nova inventada** — o que não está no repositório não está nesta
> lista.
>
> Legenda de estimativa: **P** = uma sessão · **M** = algumas sessões ·
> **G** = várias sessões, provavelmente em etapas.
>
> A coluna "risco para o ambiente do cliente" mede o impacto sobre
> `preview/cliente-vercel` e sobre o banco `qfcngyyzyiwotehubifx`, que o cliente
> está usando agora.

---

## 🔴 Prioridade crítica

### C1. Fechar os dois endpoints de cron

| | |
|---|---|
| **Objetivo** | Impedir que qualquer pessoa na internet execute operações com a chave administrativa. |
| **Escopo** | `src/routes/hooks/reset-monthly-appointments.ts` aceita qualquer header `authorization` e zera `appointments_this_month` de todas as barbearias. `src/routes/hooks/process-account-deletions.ts` autoriza pela chave publicável, que está no bundle do navegador. Trocar as duas por um segredo próprio (`CRON_SECRET`, sem prefixo `VITE_`), comparado em tempo constante, e recusar requisição sem ele. Documentar a variável em `.env.example`. |
| **Dependências** | Nenhuma no código. A variável precisa ser cadastrada no ambiente antes do deploy. |
| **Migration** | Não |
| **Risco p/ o cliente** | **Baixo** no código; **atenção** na operação: se houver um agendador externo chamando essas URLs hoje, ele para de funcionar até receber o novo segredo. Descobrir isso antes. |
| **Testes** | Harness novo de rotas de servidor: sem header → 401; header errado → 401; segredo ausente no ambiente → 500 sem executar nada; segredo correto → executa. Mais varredura provando que nenhuma rota `/hooks/*` autoriza por chave pública. |
| **Estimativa** | **P** |
| **Branch** | `fix/protege-endpoints-cron` |

### C2. Mesclar `fix/import-fontes-css`

| | |
|---|---|
| **Objetivo** | Devolver o `npm run dev` a quem trabalha na `main`. |
| **Escopo** | Abrir o PR da branch existente (1 commit, 12 linhas em 2 arquivos). Nada a escrever. |
| **Dependências** | Nenhuma |
| **Migration** | Não |
| **Risco p/ o cliente** | **Nenhum** — o Preview tem o próprio CSS e não é tocado. |
| **Testes** | Já executados: `tsc`, `build`, dev server com `/`, `/login` e `/reset-password` em 200. |
| **Estimativa** | **P** |
| **Branch** | `fix/import-fontes-css` (já existe e está publicada) |

### C3. Mesclar `fix/recuperacao-senha` e cadastrar as URLs no Supabase

| | |
|---|---|
| **Objetivo** | Fazer a recuperação de senha funcionar de ponta a ponta — hoje ela falha na `main`. |
| **Escopo** | PR da branch existente (3 commits, 75 verificações novas) e, **à mão no painel**, Authentication → URL Configuration: Site URL `https://barbaflow.pro`, Redirect URLs para local, Preview e produção. O passo a passo está em `docs/RECUPERACAO_SENHA.md`. |
| **Dependências** | C2 (a branch carrega o mesmo commit de CSS — mesclar C2 antes e rebasear evita duplicata). Acesso ao painel do Supabase. |
| **Migration** | Não |
| **Risco p/ o cliente** | **Médio, e é o ponto de atenção**: cadastrar Redirect URLs é aditivo e seguro, mas **remover** ou trocar o Site URL quebra o login do cliente no meio do teste. Só acrescentar. |
| **Testes** | `harness:senha` (75) já verde; teste manual com um e-mail real próprio — nunca de terceiros. |
| **Estimativa** | **P** |
| **Branch** | `fix/recuperacao-senha` (já existe e está publicada) |

### C4. Aplicar a fase 1 do catálogo público no remoto

| | |
|---|---|
| **Objetivo** | Criar a RPC `get_public_products` no banco, destravando a vitrine da `main` e o encerramento do Preview improvisado. |
| **Escopo** | Nenhum código novo: a migration `20260727120000_public_product_catalog.sql` já está versionada e é aditiva. O trabalho é operacional — `db:status:remote`, `db:dry-run`, conferência e só então o `db push` manual, com autorização. Depois: `types:remote` e revisão do diff. |
| **Dependências** | Máquina com o Supabase CLI funcionando (o Smart App Control bloqueia no Windows atual). Autorização explícita. |
| **Migration** | **Sim — aplicação de uma já existente.** Nenhuma migration nova. |
| **Risco p/ o cliente** | **Alto — escreve no banco que o cliente está usando.** A fase 1 é aditiva (cria função e policy interna, não remove nada), então o risco é de janela, não de conteúdo. Combinar horário e avisar antes. |
| **Testes** | `harness:catalogo-publico` (96) antes; depois do push, conferir a vitrine pública e as telas internas de produtos contra o remoto. |
| **Estimativa** | **P** (execução) — **M** se a máquina precisar ser preparada |
| **Branch** | `chore/aplica-catalogo-publico-remoto` (para o registro e os tipos regenerados) |

### C5. Encerrar o Preview improvisado

| | |
|---|---|
| **Objetivo** | Colocar o cliente para testar código igual ao da `main`, sem a reversão do catálogo. |
| **Escopo** | Apontar o Preview para uma branch derivada da `main` (com Nitro), apagar `preview/cliente-vercel` local e remota, apagar `docs/PREVIEW_CLIENTE_VERCEL.md`. O procedimento está escrito no rodapé desse arquivo. |
| **Dependências** | **C4** e **A1** (Nitro na `main`). Combinar com o cliente. |
| **Migration** | Não |
| **Risco p/ o cliente** | **Alto** — troca o ambiente debaixo de quem está testando. Só com aviso e janela combinada. |
| **Testes** | `harness:core` completo na branch nova; conferência visual das telas que o cliente usa antes de virar a chave. |
| **Estimativa** | **P** |
| **Branch** | `chore/encerra-preview-cliente` |

---

## 🟠 Prioridade alta

### A1. Levar a migração Nitro/Vercel para a `main`

| | |
|---|---|
| **Objetivo** | Acabar com a divergência de build entre `main` (Cloudflare) e o ambiente do cliente (Nitro/Vercel). |
| **Escopo** | PR da `chore/vercel-nitro`: `vite.config.ts`, `package.json`, `package-lock.json`, `.gitignore`. Conferir se o `.gitignore` dela já cobre `.vercel/`. |
| **Dependências** | Nenhuma técnica; convém depois de C2 para não conflitar em `package.json`. |
| **Migration** | Não |
| **Risco p/ o cliente** | **Médio** — muda o build da `main`. Não afeta o Preview enquanto ele viver na branch própria, mas passa a ser a base do próximo. |
| **Testes** | `tsc`, `build` e `harness:core` na branch mesclada; um deploy de teste em projeto Vercel separado, nunca o do cliente. |
| **Estimativa** | **M** |
| **Branch** | `chore/vercel-nitro` (já existe) |

### A2. Fase 2 do catálogo público — fechar `products` para o anônimo

| | |
|---|---|
| **Objetivo** | Parar de expor `stock_quantity` e produtos inativos a qualquer visitante. |
| **Escopo** | Escrever a migration com `DROP POLICY "Anyone can view products of approved barbershops"` e `REVOKE SELECT ON products FROM anon`. O conteúdo, as verificações obrigatórias e o rollback já estão redigidos no rodapé da migration da fase 1. |
| **Dependências** | **C4 aplicada e validada em uso real.** O harness `catalogo-publico` falha de propósito se esta migration aparecer antes — a trava é intencional e precisa ser ajustada no mesmo PR. |
| **Migration** | **Sim — nova**, e destrutiva de permissão |
| **Risco p/ o cliente** | **Alto** — se algum ponto ainda ler `products` direto como anônimo, a vitrine cai. Por isso a fase 1 vem antes e precisa de tempo em uso. |
| **Testes** | As seis verificações listadas no rodapé da migration (anon negado, cliente autenticado negado, barbeiro e admin lendo o próprio tenant, comandas funcionando, relatórios com estoque, catálogo pela RPC) + ajuste do harness. |
| **Estimativa** | **M** |
| **Branch** | `feat/catalogo-publico-fase-2` |

### A3. Notificação real de agendamento por e-mail

| | |
|---|---|
| **Objetivo** | Fazer o cliente final receber confirmação e cancelamento — hoje só sai `console.log`. |
| **Escopo** | Implementar `sendTransactionalEmail` (Edge Function nova), ligar em `lib/notifications.ts:41,68`, com chave de idempotência por agendamento e templates de confirmação e cancelamento. |
| **Dependências** | **Bloqueado**: exige domínio de e-mail verificado e provedor de envio contratado. Ver B1. |
| **Migration** | Provavelmente sim — tabela de log/idempotência de envio, a definir no desenho |
| **Risco p/ o cliente** | **Médio** — passa a enviar e-mail de verdade a partir de dados de homologação. Exige lista de destinatários controlada no primeiro teste. |
| **Testes** | Harness da montagem do template e da idempotência (sem rede); envio real só para endereço próprio. |
| **Estimativa** | **G** |
| **Branch** | `feat/emails-transacionais-agendamento` |

### ✅ A4. Dar destino às mensagens do formulário de contato

**Concluído** na branch `feat/leitura-mensagens-contato`. Das três opções, foi
escolhida a **tela de leitura** para o super admin, e não o e-mail: é a única
que não depende de B1 (domínio verificado e provedor de SMTP), que segue
bloqueado.

| | |
|---|---|
| **Objetivo** | Hoje a mensagem entra em `contact_submissions` e ninguém é avisado. |
| **Escopo** | Decidir o destino (notificação interna no app, e-mail, ou tela de leitura para super admin) e implementar. A tela de leitura é a opção que **não** depende de SMTP. |
| **Entregue** | `/admin/mensagens` (`src/routes/admin.mensagens.tsx`): caixa de entrada restrita ao super admin, com recorte por período, busca, contagem das últimas 24h e resposta por e-mail ou WhatsApp. Link no painel do super admin, ao lado do de churn. |
| **Dependências** | Se a escolha for e-mail, depende de B1. Como foi pela tela de leitura, **nenhuma**. |
| **Migration** | A leitura **não** exigiu policy nova — a de 20260416012649 já restringia o SELECT ao super admin. Foi criada, no entanto, `20260729120000_contact_submissions_limits.sql` (CHECK de tamanho/formato e trigger de vazão por e-mail), **ainda não aplicada**: a tabela aceitava INSERT anônimo sem limite nenhum, e passar a exibir esse conteúdo numa tela tornou o problema visível. |
| **Risco p/ o cliente** | **Baixo** no código (tela nova, nada existente alterado). A migration ainda não aplicada é **aditiva**; quando for aplicada, o ponto de atenção é o formulário público de `/contato` continuar enviando. |
| **Testes** | `harness:mensagens-contato` (125 verificações): regra de acesso por papel, ausência de UPDATE/DELETE, limites de conteúdo e vazão, telefone não-brasileiro, e paridade entre o mock, o `.sql` e os limites do formulário. |
| **Estimativa** | **M** |
| **Branch** | `feat/leitura-mensagens-contato` |

---

## 🟡 Prioridade média

### M1. Validação visual das telas principais

| | |
|---|---|
| **Objetivo** | Nenhuma tela do produto tem conferência visual registrada. |
| **Escopo** | Rodar o app em modo mock e percorrer, com registro (captura ou anotação), as telas dos três papéis: dashboard, agenda, clientes, comandas, serviços, relatórios, configurações, perfil, onboarding, agendar, meus-agendamentos. Registrar o que estiver quebrado — sem corrigir no mesmo passo. |
| **Dependências** | C2 (sem ela o dev server não sobe) |
| **Migration** | Não |
| **Risco p/ o cliente** | **Nenhum** — modo mock, sem rede e sem banco |
| **Testes** | O próprio percurso; o resultado vira lista de defeitos priorizada |
| **Estimativa** | **M** |
| **Branch** | `chore/validacao-visual-telas` (só documentação) |

### M2. Aposentar `DEFAULT_BARBERSHOP_ID`

| | |
|---|---|
| **Objetivo** | Eliminar a sentinela que faz uma consulta cair numa barbearia fictícia quando o tenant não resolve. |
| **Escopo** | Resolver o tenant sempre por subdomínio ou papel (`use-barbershop`, `use-tenant-scope`), tornar o id nulo quando não houver tenant e tratar esse estado nas telas. São 8 pontos de uso, mais o mock, que legitimamente usa o mesmo uuid. |
| **Dependências** | Nenhuma |
| **Migration** | Não |
| **Risco p/ o cliente** | **Médio** — mexe no caminho de resolução de tenant de todas as telas internas |
| **Testes** | Ampliar os harnesses de dashboard e agenda para o caso "sem tenant resolvido"; conferir que nenhuma consulta parte com id fictício fora do mock |
| **Estimativa** | **G** |
| **Branch** | `refactor/resolucao-tenant-sem-sentinela` |

### M3. `CLAUDE.md` e atualização da documentação

| | |
|---|---|
| **Objetivo** | O repositório não tem instruções de projeto versionadas, e `DESENVOLVIMENTO_REMOTO.md` está defasado. |
| **Escopo** | Criar `CLAUDE.md` na raiz (comandos, convenções de commit em português, regras do Preview, proibições de banco) e corrigir a contagem de suítes no §6 do documento remoto. |
| **Dependências** | Este roadmap e o documento de estado |
| **Migration** | Não |
| **Risco p/ o cliente** | **Nenhum** |
| **Testes** | Nenhum |
| **Estimativa** | **P** |
| **Branch** | `docs/instrucoes-projeto` |

### M4. Limpar branches

| | |
|---|---|
| **Objetivo** | 24 branches locais e 35 remotas, a maioria já mesclada. |
| **Escopo** | Apagar as mescladas (local e remoto), preservando **`preview/cliente-vercel`**, `chore/vercel-nitro`, `chore/seed-demo-cliente` (tem stash pendente) e `feat/assinaturas-cobranca` (referência da frente pausada). |
| **Dependências** | Conferir uma a uma antes |
| **Migration** | Não |
| **Risco p/ o cliente** | **Alto se feito às cegas** — apagar a branch do Preview derruba o ambiente do cliente. Listar e conferir antes de cada `push --delete`. |
| **Testes** | Nenhum |
| **Estimativa** | **P** |
| **Branch** | não precisa |

---

## 🟢 Prioridade baixa

### B-1. Normalizar formatação e fim de linha

Objetivo: `npm run lint` volta a ser utilizável como portão — hoje a base já sai
vermelha (CRLF + Prettier em arquivos antigos). Escopo: definir `.gitattributes`
com `eol=lf`, rodar `npm run format` uma vez e commitar o resultado sozinho.
Sem migration. Risco para o cliente: **baixo**, mas o diff é enorme e polui o
histórico — fazer quando nenhuma branch estiver aberta esperando merge.
Testes: `tsc`, `build`, `harness:core` depois da formatação. Estimativa: **P**.
Branch: `chore/normaliza-formatacao`.

### B-2. Quebrar os arquivos grandes

`BarberDashboard.tsx` (1.860 linhas), `clientes.tsx` (1.457),
`BarbershopSettings.tsx` (1.444), `ManualAppointmentDialog.tsx` (1.052).
Objetivo: tornar revisão e teste viáveis. Escopo: extrair seções para
componentes, sem mudar comportamento. Sem migration. Risco para o cliente:
**médio** (mexe em telas centrais). Testes: harnesses existentes + conferência
visual (M1) antes e depois. Estimativa: **G**. Branch:
`refactor/divide-telas-grandes` — uma por PR.

### B-3. Remover a constante depreciada de fuso

`lib/tz.ts:33`. Trocar os usos por `getActiveTenantTZ()` e apagar. Sem migration.
Risco: **baixo**. Testes: `harness:agenda`. Estimativa: **P**.
Branch: `chore/remove-tz-depreciado`.

### B-4. Ignorar `.vercel/` na `main`

Aparece em todo `git status`. Só entra no `.gitignore` das branches Nitro.
Cuidado com o `stash@{0}`, que também mexe em `.gitignore`. Provavelmente
resolvido junto de A1. Estimativa: **P**. Branch: junto de `chore/vercel-nitro`.

---

## ⛔ Bloqueados

| Item | Bloqueio | Como destravar |
|---|---|---|
| **B1. E-mail transacional (A3, e A4 se for por e-mail)** | Não há domínio verificado nem provedor de envio | Decisão de negócio: contratar provedor e verificar domínio |
| **B2. Religar a cobrança (Paddle)** | `BILLING_UI_ENABLED = false`; a frente foi removida da `main` pelo PR #25 | Decisão de negócio. A infraestrutura está intacta — basta voltar a constante para `true`, mas o portal e o checkout precisam ser validados antes |
| **B3. `harness:db` sem Docker** | As 3 suítes de integração exigem Postgres local, e não podem apontar para o ambiente compartilhado | As três opções (projeto de teste dedicado, ambiente efêmero por branch, ou CI descartável) estão descritas em `DESENVOLVIMENTO_REMOTO.md` §6 — nenhuma implementada |
| **B4. Qualquer comando de banco nesta máquina** | Smart App Control do Windows bloqueia o `supabase.exe` | Máquina com CLI assinado (Scoop/winget) ou outra máquina |
| **B5. A2 (fase 2 do catálogo)** | Depende de C4 aplicada e em uso | Aplicar C4 e deixar rodar |
| **B6. Múltiplas unidades** | Anunciado como "em breve" na landing, sem nenhum código | Decisão de produto e desenho do modelo de dados |

---

## 🔧 Dívida técnica — resumo

Itens já detalhados acima, agrupados para leitura rápida:

| Dívida | Item do roadmap |
|---|---|
| Lint vermelho na base, CRLF misturado | B-1 |
| Arquivos de 1.000+ linhas | B-2 |
| Sentinela `DEFAULT_BARBERSHOP_ID` | M2 |
| Constante de fuso depreciada | B-3 |
| Documentação defasada, sem `CLAUDE.md` | M3 |
| 24 branches locais, maioria mesclada | M4 |
| Infra do Paddle viva e inalcançável | B2 |
| RPCs e operadores não implementados no mock | sem item próprio — tratar quando alguma tela precisar |
| Sem CI (`.github/workflows` não existe) | sem item próprio — depende de B3 para valer a pena |
| Sem teste de componente e sem ponta a ponta | M1 cobre o buraco por conferência manual |

---

## Ordem recomendada

```
C1 ──► C2 ──► C3 ──► A1 ──► C4 ──► C5 ──► A2
 │                    │
 └── independente     └── M1, M3, M4 podem correr em paralelo
```

**C1 vem primeiro** porque é o único item que qualquer pessoa na internet pode
explorar hoje, e não depende de nada. **C2 vem em seguida** porque sem ele o
`npm run dev` não sobe na `main` e todo o resto fica mais lento.
**C4 e C5 são os que encostam no ambiente do cliente** — deixe-os para depois de
A1, e combine janela.
