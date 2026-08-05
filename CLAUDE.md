# CLAUDE.md — instruções de trabalho no BarbaFlow

Este arquivo **não** descreve o projeto. Para o que existe, como funciona e o
que está aberto, leia `docs/ESTADO_ATUAL_PROJETO.md`; para o que está planejado,
`docs/ROADMAP_DESENVOLVIMENTO.md`; para banco remoto,
`docs/DESENVOLVIMENTO_REMOTO.md`.

O que está aqui são as regras que existem porque **já custaram caro**. Cada
seção aponta o erro concreto que a originou.

---

## 1. O portão, antes de todo commit

```bash
npx tsc --noEmit          # exit 0 obrigatório
npm run build             # exit 0 obrigatório
npm run harness:core      # 15 suítes, hoje 1313 verificações, 0 SKIPPED
```

Os três rodam **sem banco, sem rede e sem Docker**. Não há CI: se você não
rodar, ninguém roda. Vale inclusive para mudança só de markdown — é barato, e o
hábito é o que impede o caso em que "só um comentário" mexeu num arquivo `.ts`
sem você perceber.

Sobre o `harness:core`:

- **SKIPPED não é PASS.** Uma suíte pulada não verificou nada. Nunca some as
  verificações dela ao total, e nunca escreva "N verificações passaram" quando
  parte não executou.
- Se você criou lógica nova em `src/lib/*`, ela precisa de harness. O padrão do
  projeto é função pura + harness, não teste de componente — não existe Vitest,
  Jest, Playwright ou Cypress aqui, e **não é para introduzir um** sem decisão
  explícita.
- `npm run lint` **não** é portão: a base já sai vermelha (CRLF + Prettier em
  arquivos antigos) e a execução completa leva vários minutos. Não gaste o
  turno tentando deixá-la verde de passagem — é o item B-1 do roadmap.

`npm run harness:db` (3 suítes) exige Postgres local via `npx supabase start`,
o único uso de Docker no projeto. Não é parte do portão do dia a dia.

---

## 2. Migrations: duas fases, e o dry-run é um portão absoluto

### 2.1 Toda mudança restritiva de permissão vai em duas fases

O padrão nasceu do catálogo público (`20260727120000` e `20260730120000`) e
**vale para qualquer mudança que tire acesso de alguém**:

1. **Fase 1, aditiva.** Cria o novo caminho (RPC, policy, coluna) sem remover
   nada. Aplica no remoto. O frontend passa a usar o caminho novo, e isso vai
   para produção.
2. **Espera.** A fase 1 precisa ficar **em uso real** antes de a fase 2 existir.
3. **Fase 2, restritiva.** Só então o `DROP POLICY` / `REVOKE`.

Escreva no rodapé da migration da fase 1: o conteúdo exato da fase 2, as
verificações obrigatórias e o **rollback**. E deixe a fase 2 fora do diretório
de migrations até a hora — o harness `catalogo-publico` já falhou de propósito
para impedir que um único `db push` aplicasse as duas juntas.

Constraints em tabela com histórico nascem `NOT VALID` (senão a migration falha
na primeira linha antiga), e o `VALIDATE CONSTRAINT` é um passo separado,
depois de olhar os dados. Foi assim em `20260729120000`.

### 2.2 Qualquer migration extra no dry-run é bloqueio absoluto

```bash
npm run db:dry-run        # obrigatório, sempre, antes de qualquer push
```

Se a saída listar **qualquer migration além da sua** — mesmo uma, mesmo
aparentemente inofensiva, mesmo escrita por você numa branch anterior:

**PARE. Não faça o push. Avise o usuário e espere resposta.**

Não julgue o alcance técnico da migration alheia ("é só um índice", "é
aditiva", "eu escrevi essa"). Você não sabe o que está em voo em outra máquina,
e o banco é o mesmo que serve a produção (§4). O `db push` aplica **tudo o que
está pendente**, não só o seu arquivo. Um dry-run com item extra é um sinal de
que alguém mais está no meio de algo.

Se você precisa aplicar **uma** migration específica sem arrastar as outras, o
CLI não tem `--target`: o caminho é a Management API + `migration repair`, e
isso exige autorização explícita, uma versão por vez, com registro do que foi
feito.

`LegacyDbPushMissingRemoteError` **não** é o mesmo que "há outra pendente" —
confira com `--include-all` antes de concluir qualquer coisa.

### 2.3 Nunca, em nenhuma hipótese

| Comando | Por quê |
|---|---|
| `npx supabase db reset --linked` | **APAGA o banco que serve a produção** |
| `db push` sem dry-run limpo imediatamente antes | Aplica o que ninguém viu |
| `migration repair` sem diagnóstico | Reescreve o histórico e transforma divergência conhecida em silenciosa |
| Editar schema pelo editor SQL do Dashboard | Cria divergência invisível para o Git |
| Seed ou cleanup automático no remoto | Apaga dado de gente de verdade |
| `npx supabase stop --all` | Derruba o Supabase de outros projetos da máquina |
| Qualquer chave `service_role`/`sb_secret` com prefixo `VITE_` | Vaza para o bundle e bypassa toda a RLS |

O `db push` real **não tem script de npm, de propósito**. É sempre digitado à
mão, com autorização.

### 2.4 Tabela nova nasce SEM acesso — conceda na mesma migration

Desde `20260805150000`, `ALTER DEFAULT PRIVILEGES` de `postgres` em `public`
não concede mais nada a `anon` nem a `authenticated`. Consequência direta:

**Toda `CREATE TABLE` em `public` precisa de `GRANT` nominal na mesma
migration, ou a tabela fica invisível pela Data API.** O sintoma é `42501
permission denied for table …` no navegador, com a RLS aparentemente correta —
porque o problema não é policy, é privilégio, e o privilégio vem antes.

```sql
CREATE TABLE public.nova (...);
ALTER TABLE public.nova ENABLE ROW LEVEL SECURITY;
CREATE POLICY ... ;
GRANT SELECT ON TABLE public.nova TO authenticated;   -- explícito, sempre
```

Antes disso era o oposto, e pior: tabela nova nascia com **CRUD completo para
`anon`** — `SELECT`, `INSERT`, `UPDATE` e `DELETE` —, com só a RLS entre o
visitante e os dados. E o comentário que o schema carregava afirmava
exatamente o contrário ("Tabelas e funções novas nascem SEM acesso"). Nunca
explodiu porque nenhuma migration criou tabela entre `20260721140000` e
`20260805150000`.

Duas ressalvas que continuam valendo:

- **`service_role` mantém o default** de propósito — é a identidade do backend,
  e toda tabela nova segue legível por ele sem grant.
- **`supabase_admin` não é alterável** por `postgres` (`42501: permission
  denied to change default privileges`). Relação criada em `public` por ele
  ainda herdaria tudo. No fluxo daqui isso não acontece — migrations rodam como
  `postgres` —, mas a brecha existe e só o suporte do Supabase fecha.

---

## 3. Medir layout: force a largura **e** emule o breakpoint

Erro cometido três vezes seguidas, nos PRs #47, #48 e #49 — o #49 existe só
porque o #47 mediu errado.

**O que deu errado:** ao medir o cabeçalho, a largura do *container* foi forçada
por script, mas a *viewport* continuou em 929px. Os rótulos dos botões são
`xl:inline` — a 929px eles simplesmente não renderizavam. O grupo media 428px
na medição e 1042px na vida real, o caso crítico nunca foi exercitado, e o
defeito ("Bar…", 3 de 26 caracteres) só apareceu depois de mesclado.

**A regra:**

1. Forçar a largura do container **não** dispara media query. Emule
   explicitamente **todos** os breakpoints que a tela usa (`sm`, `md`, `xl`,
   `2xl`) junto com cada largura medida, ou meça redimensionando a viewport de
   verdade.
2. **Container e conteúdo têm de subir no mesmo breakpoint.** Rótulos que
   voltam a aparecer em `2xl` com um container que para de crescer em `1152px`
   só mudam a faixa em que o defeito acontece — não o consertam.
3. **Feche a aritmética antes de escrever o código.** `grupo de botões +
   título ≤ teto do container` em cada faixa. Se não fecha na conta, não vai
   fechar na tela.
4. **Meça as três coisas, não uma.** Sobreposição (px² de área), vazamento
   (`scrollWidth` vs `clientWidth`) e proporção do logo. Corrigir sobreposição
   costuma introduzir vazamento e vice-versa: no #48, as três primeiras
   mudanças mataram o estouro e **criaram** 832 px² de sobreposição a 390px.
5. **Uma matriz, não um ponto.** Larguras × conteúdos (nome curto e nome longo)
   × breakpoints. Os PRs bons fecharam com 12 a 18 cenários e "zero falhas em
   todos", não com um print.
6. Tailwind **não gera classe montada por interpolação**. Variantes de
   breakpoint precisam ser strings literais — foi por isso que `labelFromXl`
   virou `labelFrom: "sm" | "xl" | "2xl"` com mapa de classes literais.

---

## 4. O banco é produção. Só existe um.

Não há projeto Supabase de produção separado: **`qfcngyyzyiwotehubifx` é o
único que existe**, e é ele que `https://barbaflow-delta.vercel.app` usa.
Desenvolvimento, homologação e produção são o mesmo banco.

Consequências práticas:

- Um seed, um cleanup ou um `db push` mal medido **atinge o site no ar**.
- Qualquer escrita no banco exige autorização explícita do usuário, na hora,
  para aquela operação. Autorização dada uma vez não vale para a próxima.
- Leitura é livre: `db:status:remote`, `db:lint:remote`, `db:dry-run`,
  `types:check` não escrevem nada.
- Alteração de configuração remota do Supabase (URL Configuration, templates,
  provedores) **também** é escrita em produção. Cadastrar Redirect URL é
  aditivo; **remover** ou trocar o Site URL derruba o login de quem está
  usando. Só acrescente, e apresente o diagnóstico antes.

Ambiente de deploy: **só Produção na Vercel.** Não existe mais ambiente de
Preview separado (a branch `preview/cliente-vercel` foi encerrada em 31/07 e
apagada — **não recrie**). Variáveis `VITE_*` são **build-time por target**:
cadastrada só em Preview, ela não existe em Production, e o sintoma é o SSR
responder 200 enquanto só o cliente quebra, sem nada nos logs.

---

## 5. Branches e commits

- **Trabalho novo sempre em branch a partir da `main` atualizada.** Rode
  `git fetch origin` antes: a `main` local costuma estar atrás.
- **PR para tudo**, com uma única exceção (abaixo). O merge é **sempre do
  usuário** — nunca mescle você mesmo.

### 5.1 A única exceção: documentação pura vai direto para a `main`

Mudança que altera **apenas arquivos `.md` na raiz ou em `docs/`** pode ser
commitada direto na `main`, sem PR — **desde que o portão da §1 tenha sido
rodado antes**, markdown ou não. É barato, e é o que pega o caso em que "só um
comentário" mexeu num `.ts` sem você perceber; se o portão não rodou, a exceção
não vale e a mudança volta para o fluxo de PR.

O que **não** é documentação para efeito desta regra, e portanto segue exigindo
PR:

- comentário dentro de arquivo de código (`.ts`, `.tsx`, `.mjs`);
- comentário ou cabeçalho dentro de arquivo de migration (`.sql`) — inclusive
  quando o diff é *só* comentário: o arquivo é executável e o risco é o de
  sempre;
- qualquer configuração (`package.json`, `tsconfig`, `.env*`, scripts);
- `.md` que venha acompanhado de qualquer outro arquivo no mesmo commit. Aí o
  commit inteiro é código, não documentação.

Na dúvida sobre se algo se enquadra, é PR. A exceção existe para reduzir
cerimônia em texto, não para criar uma porta lateral.
- `gh` está autenticado nesta máquina. Use `--body-file` para o corpo do PR:
  passar markdown longo por `--body` inline quebra no PowerShell.
- Mensagens de commit **em português**, no padrão do histórico:
  `correção:`, `adição:`, `remoção:`, `estilo:`, `teste:`, `documentação:`,
  `reverte:`, `merge:`. Primeira linha curta; o corpo explica **o mecanismo do
  defeito e o que foi medido**, não só o que mudou.
- Não commite `src/routeTree.gen.ts` quando o único diff for fim de linha
  (CRLF/LF) — é ruído gerado pelo dev server.
- Branches a preservar: `feat/assinaturas-cobranca` (referência da frente de
  cobrança pausada) e `origin/security/cron-fix-preview` (única ref que preserva
  o commit `35ca4ba`). Antes de qualquer `push --delete`, liste e confira.

---

## 6. Encoding: use Node para ler e escrever arquivo com acento

Este repositório é quase todo em português — praticamente todo arquivo tem
acento.

**Não edite arquivo com `PowerShell` + `-replace`, `Set-Content`,
`Out-File` ou redirecionamento `>`.** Em Windows PowerShell 5.1
`Set-Content`/`Add-Content` gravam em ANSI por padrão e o redirecionamento de
executável nativo grava **UTF-16** — os dois corrompem acentuação, e o estrago
aparece longe do ponto da edição, num arquivo que você "nem tocou".

Foi exatamente esse o motivo de `scripts/gen-types-remote.mjs` existir:
`npx supabase gen types … > types.ts` no PowerShell gravava UTF-16 e corrompia
`types.ts` inteiro.

**O que usar:**

- Ferramentas de edição do próprio agente (Edit/Write) — sempre a primeira
  opção.
- Para transformação programática, um script Node:
  `fs.readFileSync(p, "utf8")` → transforma → `fs.writeFileSync(p, s, "utf8")`.
- Se não houver alternativa a PowerShell, `-Encoding utf8` explícito, e
  **confira o resultado** com `git diff` antes de seguir.

Depois de qualquer edição em massa: `git diff --check` e uma passada de olho
no diff procurando `Ã§`, `Ã£`, `ï»¿` e afins.

---

## 7. Contas de teste e seed

**Modo mock** (`VITE_DATA_SOURCE=mock`) — sem rede, sem banco, dados em
`localStorage`. É o ambiente certo para trabalhar em interface, e as contas
estão em `src/mocks/fixtures.ts` e `src/mocks/auth.ts`:

| Conta | Papel |
|---|---|
| `admin@barbearia.teste` | `admin_barbearia` da barbearia principal |
| `ana@barbearia.teste`, `bruno@barbearia.teste` | `barbeiro` |
| `carlos@corterapido.teste` | `admin_barbearia` puro, de outra barbearia (sem linha em `weekly_schedule`) |

**Seed no banco remoto** — `npm run seed:test`, com limpeza por
`npm run seed:test:cleanup`. Gera 2 barbearias, 1 admin + 3 barbeiros cada e 3
clientes, todos em `@barbaflow.test` e marcados com `[SEED TESTE]` no nome.
Configuração em `.env.seed` (template: `.env.seed.example`), com travas
próprias: `ALLOW_TEST_SEED=true` e `SEED_CONFIRM_PROJECT_REF` batendo com o ref
derivado da URL — sem as duas, o script recusa rodar.

⚠️ O seed **escreve no banco de produção** (§4). Só com autorização explícita,
na hora. E note que já há dados `[SEED TESTE]` vivos lá: eles aparecem como
barbearias aprovadas para qualquer visitante anônimo.

Detalhes do que o seed cria (serviços por barbearia, bloqueio modelado como
folga, cleanup por cascade) estão em `scripts/seed-barbaflow-lib.mjs`.

---

## 8. Convenções do código

- **Toda rota nova declara a própria guarda.** Não há middleware de
  autenticação: as guardas são `useEffect` por página. Rota sem guarda é rota
  pública.
- Para escopo de tenant use `useTenantScope`, **não** o campo legado
  `barbershopId` de `useBarbershop` — ele cai em `DEFAULT_BARBERSHOP_ID`, o uuid
  de uma barbearia fictícia que no Supabase real não existe.
- `src/integrations/supabase/client.server.ts` só pode ser importado por rotas
  de servidor. Um harness trava isso; se você quebrar a regra, o portão acusa.
- Autorização de rota `/hooks/*`: sempre por `authorizeCronRequest`, como
  **primeira instrução** do handler, antes de qualquer consulta ou leitura de
  chave.
- Mensagem de erro para o usuário nunca carrega detalhe técnico: use
  `logTechnicalError` (`lib/error-reporting.ts`), que redige JWT, `apikey`,
  `sb_secret`, senha e `Authorization` antes do console.
- Falha de consulta **não** pode virar estado vazio na tela: "não carregou" e
  "não tem nada" são estados diferentes e precisam renderizar diferente.

---

## 9. Antes de afirmar qualquer coisa sobre o estado do sistema

Este projeto tem histórico de documento desatualizado descrevendo defeito que
já foi corrigido. **Não herde afirmação de documento — confirme.** Custa pouco:

- Estado do banco: `npm run db:status:remote`, ou uma consulta somente leitura.
- Vulnerabilidade fechada: teste contra o ambiente real (uma requisição com a
  chave anônima, um POST sem credencial esperando `401`).
- Branch que "não pode ser tocada": `git branch -a` — ela pode nem existir mais.
- Contagem de suítes ou de verificações: rode `harness:core` e leia o resumo.
- **Privilégio de tabela: `has_table_privilege(papel, tabela, privilégio)`.**
  Nunca por comentário, changelog ou cabeçalho de migration.

O último item ganhou linha própria porque custou caro. O comentário do schema
`public` afirmou por semanas que "tabelas novas nascem SEM acesso"; o banco
concedia CRUD completo a `anon` em toda tabela nova (§2.4). A frase era plausível,
estava versionada, e era falsa — e é justamente esse tipo de frase que faz a
próxima pessoa não conferir. Uma linha resolve:

```sql
SELECT has_table_privilege('anon', 'public.x', 'SELECT');
-- e, para o mapa inteiro, aclexplode(relacl) por relação
```

Atenção: `information_schema.role_table_grants` **não serve** para auditar isto.
Ela só mostra concessões em que o papel corrente é concedente ou beneficiário,
então por um canal administrativo ela devolve vazio para tudo — e "vazio" lido
como "sem privilégio" é a conclusão errada mais fácil de tirar aqui.

E, ao relatar, separe **o que você executou** do **que é inferência**. A §14 de
`docs/ESTADO_ATUAL_PROJETO.md` é o formato esperado.
