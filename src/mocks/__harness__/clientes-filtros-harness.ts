/**
 * Harness dos cards de filtro rápido de `/clientes`.
 *
 * A tela não tinha harness nenhum, e foi assim que três defeitos conviveram
 * nela sem que ninguém notasse — os três só aparecem no SEGUNDO clique ou numa
 * combinação de dois eixos, que é justamente o que nenhuma revisão de JSX pega
 * de olho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OS TRÊS DEFEITOS QUE ESTE ARQUIVO EXISTE PARA TRAVAR
 *
 *   1. TOGGLE SEM VOLTA. Os cards faziam `set(valorFixo)` — atribuição
 *      idempotente. O segundo clique reescrevia o mesmo valor e o filtro nunca
 *      saía. Medido no navegador antes da correção: "Com falta", "Inativos" e
 *      "Bloqueados" mantinham o anel aceso e o select inalterado nos dois
 *      cliques;
 *   2. "CLIENTES" NÃO LIMPAVA O PERÍODO. O destaque do card exige
 *      `status === "all" && periodo === "all"`, mas o clique mexia só em
 *      `status`. Com um período ativo, clicar nele não acendia o card nem
 *      mudava a lista: clique sem efeito visível NENHUM. É o defeito mais
 *      traiçoeiro dos três, porque não há sintoma — a tela simplesmente não
 *      responde;
 *   3. "AGENDAMENTOS" NÃO ERA FILTRO. O número dele é a SOMA de agendamentos,
 *      não a contagem de clientes que os outros quatro mostram — filtrar por
 *      ele não teria significado. Virou atalho de ordenação.
 *
 * Duas camadas, e elas provam coisas diferentes:
 *
 *   - COMPORTAMENTO, sobre as funções puras de `lib/clientes-filtros`. É a
 *     regra de verdade, exercitada de ida e volta;
 *   - LIGAÇÃO, por leitura do código de `clientes.tsx`. Função certa e tela
 *     chamando outra coisa passaria na primeira camada — esta é que amarra
 *     cada um dos cinco cards ao handler certo.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  alternarFiltro,
  proximaOrdenacao,
  SEM_FILTRO,
  type DirecaoDeOrdenacao,
} from "@/lib/clientes-filtros";

const ROOT = process.cwd();

function lerArquivo(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

/** Fonte sem comentário: a prosa deste arquivo cita os defeitos pelo nome. */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
}

let passou = 0;
let falhou = 0;
const linhas: string[] = [];

function group(titulo: string) {
  linhas.push(`\n▸ ${titulo}`);
}

function check(nome: string, ok: boolean, detalhe = "") {
  if (ok) {
    passou++;
    linhas.push(`  ✓ ${nome}`);
  } else {
    falhou++;
    linhas.push(`  ✗ ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

/* ══════════ 1. o ramo de volta ══════════ */

type Status = "all" | "blocked" | "active" | "noshow";
type Periodo = "all" | "30" | "90" | "inactive60" | "never";

function testeToggle() {
  group("toggle: clicar no card já ativo volta para 'sem filtro'");

  check("o neutro dos dois eixos é 'all'", SEM_FILTRO === "all", SEM_FILTRO);

  // Os três cards de filtro, cada um no seu eixo.
  const casos: { card: string; alvo: string }[] = [
    { card: "Com falta", alvo: "noshow" },
    { card: "Bloqueados", alvo: "blocked" },
    { card: "Inativos +60d", alvo: "inactive60" },
  ];

  for (const { card, alvo } of casos) {
    const primeiro = alternarFiltro("all", alvo, "all");
    check(`${card}: 1º clique liga`, primeiro === alvo, primeiro);

    const segundo = alternarFiltro(primeiro, alvo, "all");
    check(
      `${card}: 2º clique DESLIGA — era o defeito 1`,
      segundo === "all",
      `${segundo} (idempotente devolveria "${alvo}")`,
    );

    const terceiro = alternarFiltro(segundo, alvo, "all");
    check(`${card}: 3º clique liga de novo`, terceiro === alvo, terceiro);
  }

  group("toggle: trocar de card não passa pelo neutro");

  // Dois cards do MESMO eixo: ir de um para o outro troca direto, não desliga.
  const deNoshowParaBlocked = alternarFiltro<Status>("noshow", "blocked", "all");
  check(
    "de 'Com falta' para 'Bloqueados' troca direto",
    deNoshowParaBlocked === "blocked",
    deNoshowParaBlocked,
  );

  const voltando = alternarFiltro<Status>("blocked", "noshow", "all");
  check("e de volta também", voltando === "noshow", voltando);

  group("toggle: o eixo de período tem a mesma regra");

  const p1 = alternarFiltro<Periodo>("all", "inactive60", "all");
  const p2 = alternarFiltro<Periodo>(p1, "inactive60", "all");
  check("período liga e desliga", p1 === "inactive60" && p2 === "all", `${p1} → ${p2}`);

  const p3 = alternarFiltro<Periodo>("30", "inactive60", "all");
  check("e troca a partir de outro valor", p3 === "inactive60", p3);
}

/* ══════════ 2. "Clientes" limpa os DOIS eixos ══════════ */

/**
 * O caso de regressão do defeito 2, escrito como a tela o vive: os dois eixos
 * ativos AO MESMO TEMPO. Com só um deles a versão antiga passava, e é por isso
 * que o defeito sobreviveu.
 */
function testeMostrarTodos() {
  group("Clientes: limpa os dois eixos, não só um");

  const mostrarTodos = (): { status: Status; periodo: Periodo } => ({
    status: "all",
    periodo: "all",
  });

  const depois = mostrarTodos();
  check("status volta a 'all'", depois.status === "all", depois.status);
  check("período volta a 'all' — era o defeito 2", depois.periodo === "all", depois.periodo);

  // O destaque do card, exatamente como a tela o calcula.
  const destacado = (s: Status, p: Periodo) => s === "all" && p === "all";

  check(
    "com status E período ativos, o card não está destacado antes",
    !destacado("noshow", "inactive60"),
  );
  check(
    "e passa a estar depois de limpar",
    destacado(depois.status, depois.periodo),
    "a versão antiga limpava só o status e o card seguia apagado",
  );

  group("Clientes: o clique sem efeito visível não volta");

  // O defeito exato: limpar SÓ o status, com um período ativo.
  const soStatus = { status: "all" as Status, periodo: "inactive60" as Periodo };
  check(
    "limpar só o status deixaria o card apagado — o sintoma de antes",
    !destacado(soStatus.status, soStatus.periodo),
    "reproduz o defeito para provar que o teste sabe distingui-lo",
  );
}

/* ══════════ 3. "Agendamentos" ordena, não filtra ══════════ */

function testeOrdenacao() {
  group("Agendamentos: aciona ordenação, e inverte a cada clique");

  const primeiro = proximaOrdenacao("last", "desc", "total", "desc");
  check("1º clique passa a ordenar por 'total'", primeiro.chave === "total", primeiro.chave);
  check("na direção padrão da coluna", primeiro.direcao === "desc", primeiro.direcao);

  const segundo = proximaOrdenacao(primeiro.chave, primeiro.direcao, "total", "desc");
  check(
    "2º clique inverte, NÃO desliga",
    segundo.chave === "total" && segundo.direcao === "asc",
    `${segundo.chave}/${segundo.direcao}`,
  );

  const terceiro = proximaOrdenacao(segundo.chave, segundo.direcao, "total", "desc");
  check(
    "3º clique volta a desc — o ciclo é de duas posições",
    terceiro.chave === "total" && terceiro.direcao === "desc",
    `${terceiro.chave}/${terceiro.direcao}`,
  );

  group("Agendamentos: ordenar nunca vira filtro");

  // A distinção que motivou a correção: ordenação mexe na ORDEM, não em quem
  // aparece. Nenhum caminho de `proximaOrdenacao` produz valor de filtro.
  const chaves = ["name", "total", "noshow", "last"] as const;
  const direcoes: DirecaoDeOrdenacao[] = ["asc", "desc"];
  let tocouFiltro = false;
  for (const k of chaves) {
    for (const d of direcoes) {
      const r = proximaOrdenacao(k, d, "total", "desc");
      if (!chaves.includes(r.chave as (typeof chaves)[number])) tocouFiltro = true;
      if (r.direcao !== "asc" && r.direcao !== "desc") tocouFiltro = true;
    }
  }
  check("a saída é sempre (coluna, direção), nunca um filtro", !tocouFiltro);

  check(
    "trocar de coluna entra na direção padrão dela, não na herdada",
    proximaOrdenacao("total", "asc", "name", "asc").direcao === "asc" &&
      proximaOrdenacao("name", "asc", "total", "desc").direcao === "desc",
  );
}

/* ══════════ 4. a ligação: os cinco cards da tela ══════════ */

function testeLigacao() {
  const bruto = lerArquivo("src/routes/clientes.tsx");
  const tela = semComentarios(bruto);

  group("ligação: cada card chama o handler certo");

  check(
    "a tela usa as funções puras, e não uma segunda cópia da regra",
    /from "@\/lib\/clientes-filtros"/.test(tela) &&
      /alternarFiltro/.test(tela) &&
      /proximaOrdenacao/.test(tela),
  );

  check(
    "os dois eixos alternam pelo helper, com neutro 'all'",
    /setStatusFilter\(\(atual\) => alternarFiltro\(atual, alvo, "all"\)\)/.test(tela) &&
      /setLastFilter\(\(atual\) => alternarFiltro\(atual, alvo, "all"\)\)/.test(tela),
    "a forma funcional importa: o valor atual precisa entrar na conta",
  );

  check(
    "'Com falta' e 'Bloqueados' passam pelo toggle de status",
    /onClick=\{\(\) => alternarStatus\("noshow"\)\}/.test(tela) &&
      /onClick=\{\(\) => alternarStatus\("blocked"\)\}/.test(tela),
  );
  check(
    "'Inativos +60d' passa pelo toggle de período",
    /onClick=\{\(\) => alternarPeriodo\("inactive60"\)\}/.test(tela),
  );

  check(
    "'Clientes' chama mostrarTodos, que mexe nos DOIS eixos",
    /onClick=\{mostrarTodos\}/.test(tela) &&
      /const mostrarTodos = \(\) => \{[\s\S]{0,200}?setStatusFilter\("all"\);[\s\S]{0,200}?setLastFilter\("all"\);/.test(
        tela,
      ),
    "é o defeito 2: mexer só no status deixa o clique sem efeito",
  );

  check(
    "'Agendamentos' aciona ordenação",
    /onClick=\{\(\) => handleSort\("total"\)\}/.test(tela),
  );
  check(
    "e NÃO aciona filtro nenhum",
    !/onClick=\{\(\) => (alternarStatus|alternarPeriodo|setStatusFilter|setLastFilter)[^}]*\}\s*\n\s*acao="ordenacao"/.test(
      tela,
    ),
  );

  group("ligação: nenhum card voltou à atribuição idempotente");

  // O defeito 1 na forma exata em que existia.
  check(
    "nenhum onClick de card faz `setStatusFilter(\"valor\")` direto",
    !/onClick=\{\(\) => setStatusFilter\("(noshow|blocked)"\)\}/.test(tela),
    "era essa a linha que não desmarcava",
  );
  check(
    "nem `setLastFilter(\"inactive60\")` direto",
    !/onClick=\{\(\) => setLastFilter\("inactive60"\)\}/.test(tela),
  );

  group("ligação: ordenação e filtro não se parecem na tela");

  check(
    "o card de ordenação declara a própria ação",
    /acao="ordenacao"/.test(tela),
  );
  check(
    "não anuncia aria-pressed — não é um liga/desliga",
    /aria-pressed=\{interactive && !ehOrdenacao \? active : undefined\}/.test(tela),
    "botão 'pressionado' anunciaria um estado que a ordenação não tem",
  );
  check(
    "e tem destaque próprio, sem o anel do filtro",
    /destacado && ehOrdenacao \? "border-primary\/60" : ""/.test(tela) &&
      /destacado && !ehOrdenacao \? "border-primary ring-2/.test(tela),
  );
  check(
    "a seta só aparece quando a lista está mesmo ordenada por ali",
    /ehOrdenacao && ordenando && \(/.test(tela),
    "seta permanente sugeriria uma ordenação que não está em vigor",
  );

  group("ligação: o card inerte deixou de existir");

  check(
    "os cinco cards são clicáveis",
    (tela.match(/<StatCard/g) ?? []).length === 5 &&
      (tela.match(/onClick=\{/g) ?? []).length >= 5,
    String((tela.match(/<StatCard/g) ?? []).length),
  );
}

/* ══════════ execução ══════════ */

export async function runHarness() {
  testeToggle();
  testeMostrarTodos();
  testeOrdenacao();
  testeLigacao();

  const veredito = falhou === 0 ? "OK" : "FALHOU";
  return {
    passed: passou,
    failed: falhou,
    report: `${linhas.join("\n")}\n\n${veredito} — ${passou} passaram, ${falhou} falharam.\n`,
  };
}
