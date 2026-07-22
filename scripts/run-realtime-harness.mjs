/**
 * Harness do ciclo de vida dos canais Realtime (sem framework de teste).
 *
 *   node scripts/run-realtime-harness.mjs
 *
 * Existe por causa de um erro concreto: `/configuracoes` monta
 * BarbershopSettings e TeamManager juntos, os dois usavam `usePlan(tenantId)`,
 * e o hook abria `supabase.channel("barbershop-plan-<id>")`. O cliente Supabase
 * DEDUPLICA canais por tópico (RealtimeClient.channel → `channels.find(...)`),
 * então o segundo componente recebia o MESMO RealtimeChannel — já inscrito — e
 * o `.on("postgres_changes", …)` seguinte lançava
 * "cannot add `postgres_changes` callbacks … after `subscribe()`", derrubando a
 * rota inteira no errorComponent do router.
 *
 * Duas famílias de verificação:
 *   1. estáticas — `usePlan` não pode voltar a abrir canal;
 *   2. de ciclo de vida — contra o cliente Supabase REAL (offline: nada é
 *      enviado, só o estado local dos canais é observado), reproduzindo o erro
 *      do padrão antigo e provando que o padrão que ficou no app não acumula
 *      canais ao montar, desmontar e trocar de tenant.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
/** Só o código: os comentários explicam o bug e citam as APIs proibidas. */
const readCode = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ---------------------------- asserções ---------------------------- */

const checks = [];
let currentGroup = "geral";
const group = (name) => {
  currentGroup = name;
};
const check = (name, ok, detail = "") => {
  checks.push({ group: currentGroup, name, ok, detail });
};

/* ------------------------- 1. estáticas ---------------------------- */

function testFonteDoUsePlan() {
  group("usePlan não abre canal");
  const src = readCode("src/hooks/use-plan.tsx");

  check("não chama .channel(", !/\.channel\(/.test(src));
  check("não registra postgres_changes", !src.includes("postgres_changes"));
  check("não chama .subscribe(", !/\.subscribe\(/.test(src));
  check("não chama removeChannel(", !src.includes("removeChannel("));

  group("estados do usePlan");
  for (const estado of ["loading", "no-tenant", "ready", "not-found", "error"]) {
    check(`distingue "${estado}"`, src.includes(`| "${estado}"`) || src.includes(`"${estado}"`));
  }
  check("expõe refreshPlan", src.includes("refreshPlan"));
  check(
    "erro de consulta não vira plano carregado",
    src.includes('status: "error"') && src.includes("fail(error.message)"),
  );

  group("modo mock não abre Realtime");
  const mock = read("src/mocks/client.ts");
  check("channel() do mock é no-op local", mock.includes("createMockChannel"));
  check("mock não importa realtime-js", !/@supabase\/realtime-js/.test(mock));
}

/* --------------------- 2. ciclo de vida real ----------------------- */

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const SYSTEM_ID = "00000000-0000-0000-0000-000000000000";

function novoCliente() {
  return createClient("https://harness.invalid", "chave-de-harness");
}

/** Reproduz o efeito de um hook: cria, registra callbacks e inscreve. */
function montarEfeito(supabase, topico) {
  const channel = supabase
    .channel(topico)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "barbershops" }, () => {})
    .subscribe();
  return () => supabase.removeChannel(channel);
}

function testPadraoAntigoReproduzOErro() {
  group("padrão antigo (regressão que causou o bug)");
  const supabase = novoCliente();
  const topico = `barbershop-plan-${TENANT_A}`;

  montarEfeito(supabase, topico);
  const primeiro = supabase.getChannels()[0];
  const reaproveitado = supabase.channel(topico);
  check(
    "cliente devolve o MESMO canal para o mesmo tópico",
    reaproveitado === primeiro,
    "a deduplicação por tópico é o que fazia dois componentes colidirem",
  );

  let mensagem = "";
  try {
    montarEfeito(supabase, topico);
  } catch (err) {
    mensagem = err instanceof Error ? err.message : String(err);
  }
  check(
    "segundo consumidor do mesmo tópico lança o erro relatado",
    mensagem.includes("cannot add `postgres_changes` callbacks") &&
      mensagem.includes("after `subscribe()`"),
    mensagem || "nenhum erro foi lançado",
  );

  supabase.realtime.disconnect();
}

async function testNavegacaoNaoAcumulaCanais() {
  group("navegação repetida");
  const supabase = novoCliente();

  // Um canal por tenant, como `use-barbershop` faz hoje: montar e desmontar
  // cinco vezes (Equipe → Configurações → Serviços …) tem de voltar a zero.
  for (let i = 0; i < 5; i += 1) {
    const limpar = montarEfeito(supabase, `barbershop-context-${TENANT_A}`);
    if (supabase.getChannels().length !== 1) {
      check(`ciclo ${i + 1}: exatamente 1 canal montado`, false, `${supabase.getChannels().length}`);
    }
    await limpar();
  }
  check("5 ciclos montar/desmontar deixam 0 canais", supabase.getChannels().length === 0, `${supabase.getChannels().length} canal(is) órfão(s)`);

  group("troca de tenant (super_admin)");
  const limparA = montarEfeito(supabase, `barbershop-context-${TENANT_A}`);
  await limparA();
  montarEfeito(supabase, `barbershop-context-${TENANT_B}`);
  const topicos = supabase.getChannels().map((c) => c.topic);
  check("apenas o canal do novo tenant permanece", topicos.length === 1 && topicos[0].endsWith(TENANT_B), topicos.join(", "));

  await supabase.removeAllChannels();
  check("logout (removeAllChannels) zera os canais", supabase.getChannels().length === 0, `${supabase.getChannels().length}`);

  group("tenants que não podem gerar canal");
  // `usePlan` não abre mais canal; `use-barbershop` só abre com barbershop?.id
  // resolvido, que nunca é a sentinela `_system` nem o uuid do mock.
  const contexto = read("src/hooks/use-barbershop.tsx");
  check("canal do contexto só existe com id resolvido", contexto.includes("if (!barbershop?.id) return;"));
  check(
    "resolução ignora a sentinela _system",
    contexto.includes('.neq("barbershop_id", "00000000-0000-0000-0000-000000000000")') &&
      contexto.includes('.neq("subdomain", "_system")'),
  );
  check("sentinela conhecida bate com a do use-tenant-scope", read("src/hooks/use-tenant-scope.tsx").includes(SYSTEM_ID));

  supabase.realtime.disconnect();
}

/* ------------------------------ runner ----------------------------- */

async function main() {
  const grupos = [
    ["fonte", async () => testFonteDoUsePlan()],
    ["padrao-antigo", async () => testPadraoAntigoReproduzOErro()],
    ["ciclo-de-vida", testNavegacaoNaoAcumulaCanais],
  ];

  for (const [nome, fn] of grupos) {
    try {
      await fn();
    } catch (err) {
      check(`grupo "${nome}" executou sem exceção`, false, err instanceof Error ? err.message : String(err));
    }
  }

  const linhas = [];
  let passed = 0;
  let failed = 0;
  let printed = "";

  for (const item of checks) {
    if (item.group !== printed) {
      linhas.push(`\n▸ ${item.group}`);
      printed = item.group;
    }
    if (item.ok) passed += 1;
    else failed += 1;
    linhas.push(`${item.ok ? "  ✓" : "  ✗"} ${item.name}${item.detail && !item.ok ? `  — ${item.detail}` : ""}`);
  }

  linhas.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  console.log(linhas.join("\n"));

  // O cliente real mantém timers de reconexão: encerramos explicitamente.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
