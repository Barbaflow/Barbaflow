# Desenvolvimento remoto (remote-first)

O BarbaFlow é desenvolvido com **frontend local + Supabase remoto**. Não é
preciso Docker, nem `supabase start`, nem um Postgres na sua máquina.

O que roda na sua máquina: o Vite e os testes. O que roda na nuvem: o banco,
o Auth, o Storage e as Edge Functions.

---

## Ambientes

| Ambiente | Project ref | Uso |
|---|---|---|
| **Desenvolvimento / homologação** | `qfcngyyzyiwotehubifx` | É onde você trabalha. Todos os scripts deste repositório apontam para cá. |
| **Produção** | não configurado neste repositório | Nenhum script daqui toca produção. O deploy de produção é um processo à parte, com autorização própria. |

> `qfcngyyzyiwotehubifx` **não é produção**. É o ambiente de
> desenvolvimento/homologação — mas é **compartilhado**: o que você aplicar lá
> afeta as outras pessoas do time. Trate migrations com o mesmo cuidado.

O modo `mock` (`VITE_DATA_SOURCE=mock`) roda o app inteiro com dados fictícios,
sem rede e sem banco. Use quando quiser mexer só na interface.

---

## 1. Preparação da máquina

Requisitos: **Node 20+** (o projeto foi validado no v24), npm e Git.
Docker **não** é requisito.

```bash
git clone https://github.com/Barbaflow/Barbaflow.git
cd Barbaflow
git switch fix/tratamento-erros-e-role-cliente   # ou a branch em que você vai trabalhar
npm ci
```

### Arquivos locais que não vêm do Git

Estes arquivos são ignorados de propósito — copie-os por um canal privado
(gerenciador de segredos, pendrive, mensagem cifrada). **Nunca por commit.**

| Arquivo | Para quê | Template |
|---|---|---|
| `.env.local` | Rodar o frontend e os scripts remotos | `.env.example` |
| `.env.seed` | Só se você for rodar o seed de teste | `.env.seed.example` |

Preencha a partir dos templates. O que cada variável significa está comentado
lá — em especial a divisão entre a seção **frontend** (prefixo `VITE_`, vai
para o navegador) e a seção **servidor/scripts** (sem prefixo, nunca no bundle).

Para o fluxo remoto você vai precisar, no mínimo:

```
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=https://qfcngyyzyiwotehubifx.supabase.co
VITE_SUPABASE_PROJECT_ID=qfcngyyzyiwotehubifx
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_DB_PASSWORD=...          # só para os comandos de banco
```

---

## 2. Rodar o frontend

```bash
npm run dev
```

Só isso. O app fala direto com o Supabase remoto.

---

## 3. Vincular o Supabase CLI

O vínculo é **por máquina**: ele vive em `supabase/.temp/`, que é ignorado pelo
Git. Numa máquina nova, faça uma vez:

```bash
npx supabase login
npx supabase link --project-ref qfcngyyzyiwotehubifx
```

Todos os scripts de banco deste repositório recusam rodar se o projeto
vinculado não for exatamente `qfcngyyzyiwotehubifx`.

### Se o CLI não executar no Windows

Sintoma: `spawnSync ... supabase.exe UNKNOWN`, ou a mensagem
*"Uma política de Controle de Aplicativo bloqueou este arquivo"*.

Causa: o **Smart App Control** do Windows 11 bloqueia binários sem assinatura
reconhecida — e o `supabase.exe` baixado pelo npm é um deles. Não é problema do
projeto nem dos scripts.

Como verificar:

```powershell
(Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy").VerifiedAndReputablePolicyState
# 0 = desligado · 1 = ligado · 2 = avaliação
```

Se retornar `1`, o CLI não vai rodar nessa máquina. Alternativas: instalar o
CLI por um canal com binário assinado (Scoop/winget), ou desligar o Smart App
Control — o que **exige reinstalar o Windows para religar**, então decida com
calma. O frontend (`npm run dev`) e todos os testes **não** dependem do CLI e
funcionam normalmente.

---

## 4. Migrations

As migrations são versionadas em `supabase/migrations/`. O arquivo é a fonte da
verdade — **nunca edite o schema pelo editor SQL do Dashboard**. Uma alteração
feita direto no remoto não existe para o Git, e a próxima pessoa a rodar um
`db push` vai encontrar um histórico divergente que ninguém sabe explicar.

Para criar uma migration:

```bash
npx supabase migration new nome_descritivo
# edite o arquivo criado em supabase/migrations/
```

### Ver o que está aplicado

```bash
npm run db:status:remote
```

Somente leitura. Mostra, lado a lado, o que existe localmente e o que já foi
aplicado no remoto.

### Lint do schema

```bash
npm run db:lint:remote
```

Somente leitura. Aponta view com `SECURITY DEFINER`, função sem `search_path`
fixo, tabela exposta sem RLS. Substitui o antigo `db lint --local`.

### Simular o envio

```bash
npm run db:dry-run
```

Lista o que *seria* aplicado. **Não escreve nada.**

### Aplicar de verdade

Não existe script de npm para isto, e é intencional: o push real é sempre um
ato deliberado, digitado à mão, depois de um dry-run limpo e com autorização.

```bash
# 1. obrigatório antes:
npm run db:dry-run

# 2. só com autorização explícita:
npx supabase db push --linked
```

---

## 5. Gerar os tipos

```bash
npm run types:remote
```

Lê o schema do projeto vinculado e grava
`src/integrations/supabase/types.ts` em UTF-8 sem BOM. Substitui o antigo
`gen types --local`.

Para apenas verificar se os tipos versionados estão em dia (útil em CI), sem
gravar:

```bash
npm run types:check
```

A escrita é **atômica e condicional**: a saída do CLI é validada em memória
(precisa conter `export type Json` e `export type Database`), gravada num
arquivo temporário ao lado do destino e só então renomeada por cima. Uma
mensagem de erro do CLI, um HTML de proxy ou uma saída truncada **nunca**
substituem `types.ts` — e uma falha no meio da escrita deixa o arquivo antigo
intacto, não um híbrido corrompido.

> Não use `npx supabase gen types ... > types.ts` no PowerShell: o
> redirecionamento grava **UTF-16** e corrompe o arquivo. O script existe
> exatamente para evitar isso — ele grava os bytes crus do CLI.

Depois de gerar, **revise o diff**. Se aparecer uma tabela ou coluna que não
está em nenhuma migration deste repositório, alguém alterou o remoto por fora —
resolva isso antes de commitar (ver *Divergência*, abaixo).

---

## 6. Testes

As suítes são divididas pelo que **exigem para rodar**, não pelo assunto.

| Comando | O que roda | Precisa de banco? |
|---|---|---|
| `npm run harness:core` | 8 suítes determinísticas | Não |
| `npm run harness:db` | 3 suítes de integração | **Sim** (Postgres local) |
| `npm run harness:all` | as duas acima | Sim — e não fica verde sem elas |

O fluxo padrão de desenvolvimento é:

```bash
npm ci
npm run dev
npm run harness:core
```

Mais `npx tsc --noEmit` e `npm run build`, que também não precisam de banco.

### Os quatro estados de um resultado

O runner distingue explicitamente — e o total de verificações conta **apenas o
que executou**:

| Estado | Significa |
|---|---|
| **PASS** | A suíte rodou e todas as verificações passaram. |
| **FAIL** | A suíte rodou e algo falhou. |
| **SKIPPED** | A suíte **não rodou** (banco indisponível). Nada foi verificado. |
| **NOT RUN** | A suíte não pôde nem começar (arquivo ausente, falha de spawn). |

> Uma suíte SKIPPED **não passou** — ela não aconteceu. Nunca some as
> verificações de uma suíte pulada ao total, e nunca relate "N verificações
> passaram" quando parte das suítes não executou.

### `harness:core` — 8 suítes, sem banco

`plan`, `agenda`, `relatorios`, `dashboard`, `erros`, `notifications`,
`realtime`, `remote-scripts`. Rodam em qualquer máquina: sem Docker, sem
Postgres, sem rede.

### `harness:db` — 3 suítes de integração

`cliente`, `comandas`, `agenda-concorrencia`. Validam triggers, constraints e
concorrência real via `docker exec` contra um Postgres local.

**Banco indisponível é FALHA (exit ≠ 0), não sucesso.** Este é o padrão.

Para rodá-las, suba um stack local — o único caso em que Docker é usado:

```bash
npx supabase start
npm run harness:db
```

Se você precisa seguir sem elas e está ciente de que **nada será verificado**:

```bash
HARNESS_ALLOW_DB_SKIP=true npm run harness:db
```

```powershell
$env:HARNESS_ALLOW_DB_SKIP = "true"; npm run harness:db
```

Isso imprime `SKIPPED` e sai 0 — mas o relatório mostra `0 verificações
executadas`, sem inventar cobertura.

### `harness:all` — o portão

`harness:all` **ignora** `HARNESS_ALLOW_DB_SKIP`: qualquer `SKIPPED` ou
`NOT RUN` faz o comando sair ≠ 0. "Tudo passou" só vale quando tudo executou.

### Por que os testes de banco NÃO apontam para `qfcngyyzyiwotehubifx`

Pode parecer que a solução óbvia para "não tenho Docker" seja apontar essas
três suítes para o projeto remoto. **Não é.** `qfcngyyzyiwotehubifx` é um
ambiente **compartilhado** de desenvolvimento/homologação, e essas suítes:

- criam dados temporários (barbearias, clientes, comandas, agendamentos);
- alteram estado de linhas existentes;
- provocam **concorrência real** — transações simultâneas disputando a mesma
  linha, com `pg_sleep` segurando locks;
- dependem de um schema em estado conhecido, próximo de um reset;
- testam constraints **inserindo dados deliberadamente inválidos**;
- fazem cleanup destrutivo ao final.

Rodar isso contra o ambiente compartilhado significaria: dados de teste
aparecendo no app de outra pessoa, locks travando o trabalho alheio, e falhas
intermitentes impossíveis de diagnosticar — porque duas pessoas rodando a suíte
ao mesmo tempo disputariam as mesmas linhas.

Enquanto não houver a infraestrutura abaixo, o caminho suportado é: **Postgres
local via `npx supabase start`, ou `SKIPPED` assumido de forma explícita.**

#### Próximo passo (a decidir — não implementado)

| Opção | Descrição |
|---|---|
| **A** | Projeto Supabase remoto **exclusivo** para testes automatizados, descartável e sem dados de ninguém. |
| **B** | Ambiente **efêmero/preview** de banco, criado por branch e destruído ao fim. |
| **C** | Execução **isolada em CI**, com Postgres/Supabase descartável por job. |

Nenhuma das três está implementada. Até lá, `harness:db` roda apenas contra um
banco local.

---

## 7. Comandos proibidos

| Comando | Por quê |
|---|---|
| `npx supabase db reset --linked` | **APAGA o banco remoto.** Nunca, em nenhuma hipótese. |
| `npx supabase db push` sem dry-run antes | Aplica migrations sem ninguém ter visto o que são. |
| Editar schema pelo Dashboard | Cria divergência invisível para o Git. |
| `npx supabase migration repair` sem diagnóstico | Reescreve o histórico. Ver abaixo. |
| Qualquer chave `service_role`/`sb_secret` no frontend | Bypassa RLS por completo. Só em `scripts/*.mjs` e Edge Functions. |
| Seed automático no remoto | O seed tem travas próprias e roda só à mão, com confirmação do ref. |
| `npx supabase stop --all` | Derruba o Supabase de **outros projetos** na mesma máquina. |

---

## 8. Divergência de histórico

Se `db:status:remote` ou `db:dry-run` acusarem histórico divergente,
**não rode `migration repair` às cegas.** O `repair` não conserta o banco: ele
apenas reescreve a tabela de controle para dizer que uma migration foi (ou não
foi) aplicada. Usado sem diagnóstico, transforma uma divergência conhecida numa
divergência silenciosa.

Diagnostique primeiro:

1. `npm run db:status:remote` — quais migrations divergem, e em que direção?
2. **Remoto tem uma migration que o repositório não tem?** Alguém aplicou algo
   fora do Git. Descubra o quê e traga para uma migration versionada antes de
   qualquer outra coisa.
3. **Repositório tem uma migration marcada como aplicada, mas o efeito não está
   no banco?** Compare com `npm run db:lint:remote` e com os tipos gerados
   (`npm run types:remote` e o diff resultante).
4. Só depois disso, com a causa entendida e **autorização explícita**, considere
   `migration repair --status applied|reverted <versão>` — nomeando a versão
   exata, uma por vez.

Registre o que foi feito. Divergência resolvida sem registro volta.

---

## 9. Resumo do fluxo

```bash
npm ci                              # 1. dependências
cp .env.example .env.local          # 2. e preencher (valores por canal privado)
npm run dev                         # 3. frontend
npm run harness:core                # 4. testes que não precisam de banco

npx supabase login                  # 5. uma vez por máquina
npx supabase link --project-ref qfcngyyzyiwotehubifx

npm run db:status:remote            # 6. o que está aplicado
npm run db:lint:remote              # 7. saúde do schema
npm run db:dry-run                  # 8. o que seria aplicado
# npx supabase db push --linked     # 9. só com autorização
npm run types:remote                # 10. tipos a partir do remoto
```

Nenhum comando acima inicia Docker, roda `supabase start` ou executa
`db reset`. O `db push` real é a única operação de escrita, e é manual.

## 10. Estado de validação dos scripts remotos

Os scripts de banco remoto foram validados quanto a **sintaxe, guardas,
tratamento de erro e escrita segura** (`npm run harness:remote-scripts`, 41
verificações). A **execução real contra o Supabase ainda não aconteceu**: a
máquina onde foram escritos tem o Smart App Control bloqueando o CLI.

A primeira execução real de `db:status:remote`, `db:lint:remote`, `db:dry-run`
e `types:remote` deve ser feita numa máquina com o CLI funcionando — e o
resultado, conferido antes de confiar neles.
