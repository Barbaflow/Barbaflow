/**
 * Harness da agenda: datas/fuso e invariantes de tenant e Realtime.
 *
 *   node scripts/run-agenda-harness.mjs
 *
 * Não precisa de Docker nem de rede. Usa o Vite já instalado apenas para
 * resolver o alias `@` e compilar `src/lib/tz.ts` sob demanda — mesmo padrão do
 * harness de planos.
 *
 * Guarda três regressões concretas encontradas na auditoria da agenda:
 *
 *   1. datas de calendário derivadas de `toISOString()`. Isso converte para UTC
 *      ANTES de cortar a data: em America/Sao_Paulo (UTC−3), das 21:00 em
 *      diante o app já operava o DIA SEGUINTE — a agenda abria no dia errado,
 *      "Gerar Agenda" pulava o dia corrente e o destaque de "hoje" ia junto;
 *   2. o tenant legado `useBarbershop().barbershopId`, que cai em
 *      DEFAULT_BARBERSHOP_ID (o uuid da barbearia fictícia do mock) e no modo
 *      Supabase aponta para uma linha inexistente;
 *   3. tópicos de canal Realtime FIXOS. O cliente Supabase deduplica canais por
 *      tópico e devolve o mesmo objeto já inscrito; um segundo consumidor que
 *      chame `.on("postgres_changes", …)` recebe
 *      "cannot add postgres_changes callbacks after subscribe()".
 */
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
/** Só o código: os comentários explicam o bug e citam as APIs proibidas. */
const readCode = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const checks = [];
let currentGroup = "geral";
const group = (name) => {
  currentGroup = name;
};
const check = (name, ok, detail = "") => {
  checks.push({ group: currentGroup, name, ok, detail });
};

/* ------------------- 1. datas e fuso (funções puras) ---------------- */

function testDatas(tz) {
  const { addDaysISO, weekdayOfISO, toISODateInTenantTZ, formatISODateBR, timeToMinutes } = tz;

  group("aritmética de calendário sem fuso");
  check("somar 1 dia atravessa o fim do mês", addDaysISO("2026-07-31", 1) === "2026-08-01");
  check("somar 1 dia atravessa o fim do ano", addDaysISO("2026-12-31", 1) === "2027-01-01");
  check("subtrair dias volta corretamente", addDaysISO("2026-08-01", -1) === "2026-07-31");
  check("ano bissexto: 28/02/2028 + 1 = 29/02", addDaysISO("2028-02-28", 1) === "2028-02-29");
  check("uma semana à frente", addDaysISO("2026-07-22", 7) === "2026-07-29");

  // 15/10/2026 é a virada do horário de verão em vários fusos do hemisfério sul.
  // A conta é sobre a string, então nenhum dia pode sumir nem repetir.
  const sequencia = Array.from({ length: 5 }, (_, i) => addDaysISO("2026-10-13", i));
  check(
    "virada de horário de verão não pula nem repete dia",
    sequencia.join(",") === "2026-10-13,2026-10-14,2026-10-15,2026-10-16,2026-10-17",
    sequencia.join(","),
  );

  group("dia da semana");
  check("2026-07-22 é quarta (3)", weekdayOfISO("2026-07-22") === 3);
  check("2026-07-19 é domingo (0)", weekdayOfISO("2026-07-19") === 0);
  // A grade semanal recua até domingo a partir de qualquer dia da semana.
  const domingo = addDaysISO("2026-07-22", -weekdayOfISO("2026-07-22"));
  check("semana de 22/07 começa em 19/07", domingo === "2026-07-19", domingo);
  check("semana termina em 25/07", addDaysISO(domingo, 6) === "2026-07-25");

  group("instante → data no fuso da barbearia");
  // 2026-07-23T01:30:00Z é ainda dia 22 às 22:30 em São Paulo (UTC−3).
  // `toISOString().split("T")[0]` devolveria "2026-07-23" — o bug.
  const instante = new Date("2026-07-23T01:30:00Z");
  check(
    "22:30 em São Paulo continua sendo dia 22",
    toISODateInTenantTZ(instante, "America/Sao_Paulo") === "2026-07-22",
    toISODateInTenantTZ(instante, "America/Sao_Paulo"),
  );
  check(
    "o mesmo instante em UTC já é dia 23 (prova que o corte por UTC erra)",
    instante.toISOString().slice(0, 10) === "2026-07-23",
  );
  check(
    "fuso da barbearia manda, não o do dispositivo",
    toISODateInTenantTZ(instante, "Asia/Tokyo") === "2026-07-23",
  );

  group("formatação e horas");
  check("rótulo pt-BR curto", formatISODateBR("2026-07-05") === "05/07");
  check("HH:MM em minutos", timeToMinutes("09:30") === 570);
}

/* --------------------- 2. invariantes de código --------------------- */

function testTenantEAgendaReal() {
  group("tenant real na agenda");
  const agenda = readCode("src/routes/agenda.tsx");
  check("usa useTenantScope", agenda.includes("useTenantScope("));
  check(
    "não passa mais o barbershopId legado adiante",
    !/const \{[^}]*\bbarbershopId\b/.test(agenda),
    "useBarbershop().barbershopId cai em DEFAULT_BARBERSHOP_ID",
  );
  check("aceita seleção explícita de tenant por ?barbershop=", agenda.includes("validateSearch"));
  check(
    "não monta a agenda enquanto o tenant resolve",
    agenda.includes("resolving") && agenda.includes('scope.access === "checking"'),
  );
  check(
    "sem tenant concedido, explica em vez de mostrar agenda vazia",
    agenda.includes("tenantAccessMessage"),
  );

  group("datas de calendário");
  const arquivosDeAgenda = [
    "src/components/ScheduleManager.tsx",
    "src/components/ScheduleBlocks.tsx",
    "src/components/WeeklyScheduleEditor.tsx",
    "src/components/BarberDashboard.tsx",
    "src/components/AppointmentHistory.tsx",
    "src/components/booking/DateSelector.tsx",
    "src/components/booking/PublicBookingWizard.tsx",
    "src/components/booking/useBookingData.ts",
  ];
  for (const arquivo of arquivosDeAgenda) {
    const codigo = readCode(arquivo);
    check(
      `${path.basename(arquivo)} não deriva data de toISOString()`,
      !/toISOString\(\)\s*\.\s*(split\("T"\)|slice\(0,\s*10\))/.test(codigo),
    );
  }
}

function testRealtimeDaAgenda() {
  group("canais Realtime da agenda");
  const canais = [
    ["src/components/ScheduleManager.tsx", "schedule-"],
    ["src/components/booking/useBookingData.ts", "availability-"],
  ];
  for (const [arquivo, prefixo] of canais) {
    const codigo = readCode(arquivo);
    const nome = path.basename(arquivo);
    // O tópico precisa variar por tenant E por instância do componente.
    check(
      `${nome}: tópico inclui tenant e instância`,
      new RegExp(`channel\\(\`${prefixo}\\$\\{barbershopId\\}-\\$\\{instanceId\\}\``).test(codigo),
    );
    check(`${nome}: instância vem de useId()`, /useId\(\)/.test(codigo));
    check(
      `${nome}: não abre canal sem tenant`,
      /if \(!barbershopId\) return;/.test(codigo),
    );
    check(`${nome}: remove o canal no cleanup`, /removeChannel\(channel\)/.test(codigo));
    // O efeito do canal não pode depender da função de fetch: ela muda a cada
    // troca de data/semana e derrubaria o canal a cada clique.
    check(
      `${nome}: efeito do canal não depende da função de fetch`,
      /\}, \[barbershopId, instanceId\]\);/.test(codigo),
    );
  }

  group("conflito traduzido na interface");
  const erros = readCode("src/lib/agenda-errors.ts");
  check("reconhece SQLSTATE 23P01", erros.includes('"23P01"'));
  check("reconhece a constraint por nome", erros.includes("appointments_no_overlap_per_barber"));
  for (const arquivo of [
    "src/components/booking/PublicBookingWizard.tsx",
    "src/components/ManualAppointmentDialog.tsx",
    "src/components/RescheduleDialog.tsx",
  ]) {
    check(
      `${path.basename(arquivo)} traduz o conflito do banco`,
      readCode(arquivo).includes("agendaErrorMessage("),
    );
  }

  group("tenant real no fluxo administrativo da agenda");
  // O campo `barbershopId` de useBarbershop NUNCA é null: cai em
  // DEFAULT_BARBERSHOP_ID, que é o uuid da barbearia fictícia do mock. No modo
  // Supabase isso vira consulta — e INSERT — num tenant que não existe.
  const painel = readCode("src/components/BarberDashboard.tsx");
  check(
    "BarberDashboard: a agenda usa resolvedBarbershopId",
    painel.includes("resolvedBarbershopId: barbershopId"),
  );
  check(
    "BarberDashboard: não consulta a agenda com tenant null",
    painel.includes("if (!barbershopId) {") && painel.includes("if (!user || !barbershopId) return;"),
  );
  const rotaPainel = readCode("src/routes/dashboard.tsx");
  check(
    "dashboard.tsx: não lê mais o campo de tenant legado",
    !/\bbarbershopId\b/.test(rotaPainel),
    "useBarbershop().barbershopId cai em DEFAULT_BARBERSHOP_ID",
  );
  // O encaixe manual e o reagendamento recebem o tenant por prop, vindo do
  // painel — se a origem estiver certa, os dois estão.
  for (const arquivo of [
    "src/components/ManualAppointmentDialog.tsx",
    "src/components/RescheduleDialog.tsx",
  ]) {
    check(
      `${path.basename(arquivo)}: recebe o tenant por prop, não do contexto legado`,
      !readCode(arquivo).includes("useBarbershop("),
    );
  }

  group("disponibilidade pública não depende de ação manual");
  const wizardTenant = readCode("src/components/booking/PublicBookingWizard.tsx");
  check(
    "janelas vêm da grade semanal via RPC, não da tabela availability",
    wizardTenant.includes("get_public_availability_windows") &&
      !/from\("availability"\)/.test(wizardTenant),
    "availability só é preenchida por quem clica em 'Gerar Agenda'",
  );
  check(
    "o mock implementa a RPC de janelas",
    read("src/mocks/client.ts").includes("get_public_availability_windows"),
  );

  group("duplo clique não duplica");
  // `setState` só vale no próximo render: sem uma trava síncrona, dois cliques
  // no mesmo tick entram os dois no handler e gravam dois atendimentos.
  for (const [arquivo, ref] of [
    ["src/components/booking/PublicBookingWizard.tsx", "bookingRef"],
    ["src/components/ManualAppointmentDialog.tsx", "submittingRef"],
    ["src/components/RescheduleDialog.tsx", "submittingRef"],
  ]) {
    const codigo = readCode(arquivo);
    check(
      `${path.basename(arquivo)}: trava reentrante síncrona`,
      codigo.includes(`if (${ref}.current) return;`) &&
        codigo.includes(`${ref}.current = true;`) &&
        codigo.includes(`${ref}.current = false;`),
    );
  }

  group("disponibilidade pública não mente para anônimo");
  const wizard = readCode("src/components/booking/PublicBookingWizard.tsx");
  check(
    "ocupados vêm da RPC pública, não de SELECT em appointments",
    // O `insert` em appointments continua legítimo — o que não pode voltar é a
    // LEITURA, que para visitante anônimo responde "permission denied" e fazia
    // a grade inteira parecer livre.
    wizard.includes("get_public_busy_intervals") &&
      !/from\("appointments"\)\s*\.?\s*\n?\s*\.select\(/.test(wizard),
    "appointments é fechada para anon (permission denied)",
  );
  check(
    "falha ao ler ocupados não vira grade toda livre",
    wizard.includes("busyError") && wizard.includes("setSlotsError("),
  );
  check(
    "o mock implementa a mesma RPC",
    read("src/mocks/client.ts").includes("get_public_busy_intervals"),
  );
}

/* ------------------------------ runner ----------------------------- */

async function main() {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { "@": path.resolve(root, "src") } },
  });

  try {
    const tz = await server.ssrLoadModule("/src/lib/tz.ts");
    testDatas(tz);
    testTenantEAgendaReal();
    testRealtimeDaAgenda();
  } catch (err) {
    check("harness executou sem exceção", false, err instanceof Error ? err.message : String(err));
  } finally {
    await server.close();
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
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
