/**
 * Harness automatizado de notificações internas + avaliações do modo offline.
 *
 * Exercita a mesma superfície do app (mockSupabaseClient), sem rede. Rodado por
 * `scripts/run-notifications-reviews-harness.mjs` (Vite SSR + localStorage em
 * memória). Não é um teste de framework — é um script de verificação.
 *
 * Cobre: isolamento e leitura/escrita de notificações, geração de notificações
 * em criar/cancelar/reagendar, avaliação válida, duplicada, rating inválido,
 * status incompatível, cliente incompatível, isolamento por tenant, média sem e
 * com avaliações, persistência e restauração.
 */
import { mockSupabaseClient } from "@/mocks/client";
import { getTableRows, resetMockDatabase } from "@/mocks/store";
import { clearMockSession } from "@/mocks/auth";
import {
  MOCK_ADMIN_EMAIL,
  MOCK_APPOINTMENT_IDS,
  MOCK_BARBERSHOP_C_ID,
  MOCK_BARBERSHOP_ID,
  MOCK_NOTIFICATION_IDS,
  MOCK_SERVICE_IDS,
  MOCK_USER_IDS,
  ratingAggregateFor,
} from "@/mocks/fixtures";
import { pickFutureFreeSlots } from "@/mocks/__harness__/slots";

type Row = Record<string, unknown>;

interface Check {
  group: string;
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
let currentGroup = "geral";

function group(name: string): void {
  currentGroup = name;
}
function check(name: string, ok: boolean, detail = ""): void {
  checks.push({ group: currentGroup, name, ok, detail });
}

interface MockResultLike {
  data: unknown;
  error: { message: string; code: string } | null;
}
function firstRow(result: MockResultLike): Row | null {
  const { data } = result;
  if (Array.isArray(data)) return (data[0] as Row) ?? null;
  return (data as Row) ?? null;
}
function rowsOf(result: MockResultLike): Row[] {
  const { data } = result;
  return Array.isArray(data) ? (data as Row[]) : data ? [data as Row] : [];
}

const PASSWORD = "qualquer-senha";

/** Contas fictícias precisam estar em MOCK_ACCOUNTS; usamos os e-mails. */
const EMAILS: Record<string, string> = {
  [MOCK_USER_IDS.clienteCarla]: "carla@cliente.teste",
  [MOCK_USER_IDS.clienteCaio]: "caio@cliente.teste",
  [MOCK_USER_IDS.barberAna]: "ana@barbearia.teste",
  [MOCK_USER_IDS.admin]: MOCK_ADMIN_EMAIL,
};

async function loginEmail(email: string): Promise<string> {
  const res = await mockSupabaseClient.auth.signInWithPassword({ email, password: PASSWORD });
  if (res.error || !res.data.session) {
    throw new Error(`Falha no login fictício: ${email} — ${res.error?.message ?? "sem sessão"}`);
  }
  return res.data.session.user.id;
}

async function ownNotifications(): Promise<Row[]> {
  return rowsOf(await mockSupabaseClient.from("notifications").select("*"));
}

/* ------------------------------------------------------------------ */
/* Notificações                                                        */
/* ------------------------------------------------------------------ */

async function testNotificationsBasics(): Promise<void> {
  group("notificações — leitura e isolamento");
  resetMockDatabase();
  clearMockSession();

  const carlaId = await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);

  const mine = await ownNotifications();
  check(
    "cliente vê somente as próprias notificações",
    mine.length > 0 && mine.every((n) => n.user_id === carlaId),
    `total=${mine.length}`,
  );

  // Mesmo consultando o user_id de outro, a leitura só devolve as próprias.
  const cross = rowsOf(
    await mockSupabaseClient
      .from("notifications")
      .select("*")
      .eq("user_id", MOCK_USER_IDS.clienteBento),
  );
  check("isolamento de leitura: não enxerga notificações de outro usuário", cross.length === 0);

  const unreadBefore = mine.filter((n) => n.read === false).length;
  check("há notificações não lidas no seed", unreadBefore > 0, `não lidas=${unreadBefore}`);

  /* ---- marcar UMA como lida ---- */
  const markOne = await mockSupabaseClient
    .from("notifications")
    .update({ read: true })
    .eq("id", MOCK_NOTIFICATION_IDS.carlaUnread);
  check("marca uma notificação como lida", markOne.error === null, markOne.error?.message ?? "");

  const one = firstRow(
    await mockSupabaseClient.from("notifications").select("*").eq("id", MOCK_NOTIFICATION_IDS.carlaUnread),
  );
  check("notificação agora está lida", one?.read === true, String(one?.read));

  /* ---- persistência: a marcação sobrevive ao reload ---- */
  const persisted =
    typeof localStorage !== "undefined"
      ? (() => {
          const raw = localStorage.getItem("barbaflow.mock.db.v1") ?? "";
          try {
            const db = JSON.parse(raw) as { notifications?: Row[] };
            return (db.notifications ?? []).some(
              (n) => n.id === MOCK_NOTIFICATION_IDS.carlaUnread && n.read === true,
            );
          } catch {
            return false;
          }
        })()
      : getTableRows("notifications").some(
          (n) => n.id === MOCK_NOTIFICATION_IDS.carlaUnread && n.read === true,
        );
  check("marcação como lida persiste no localStorage", persisted);

  /* ---- marcar TODAS como lidas ---- */
  const markAll = await mockSupabaseClient
    .from("notifications")
    .update({ read: true })
    .eq("user_id", carlaId)
    .eq("read", false);
  check("marca todas como lidas", markAll.error === null, markAll.error?.message ?? "");

  const stillUnread = (await ownNotifications()).filter((n) => n.read === false).length;
  check("nenhuma notificação da Carla continua não lida", stillUnread === 0, `restantes=${stillUnread}`);

  /* ---- outro usuário NÃO altera notificações alheias ---- */
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.barberAna]);
  const foreign = await mockSupabaseClient
    .from("notifications")
    .update({ read: true })
    .eq("id", "0a1a2a02-0000-4000-8000-000000000001"); // notificação do Bento (B)
  check(
    "usuário não altera notificação de outro (MOCK_FORBIDDEN)",
    foreign.error !== null && foreign.error?.code === "MOCK_FORBIDDEN",
    foreign.error?.message ?? "sem erro",
  );

  /* ---- cliente não pode CRIAR notificação (só o sistema) ---- */
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);
  const manualInsert = await mockSupabaseClient.from("notifications").insert({
    user_id: carlaId,
    barbershop_id: MOCK_BARBERSHOP_ID,
    title: "Falsa",
    message: "Não deveria existir",
    type: "custom",
  });
  check(
    "cliente não cria notificação diretamente (MOCK_FORBIDDEN)",
    manualInsert.error !== null && manualInsert.error?.code === "MOCK_FORBIDDEN",
    manualInsert.error?.message ?? "sem erro",
  );
}

/**
 * Retorna horários livres distintos do Ana na Barbearia A, sempre no FUTURO
 * com margem (ver `__harness__/slots.ts`). A regra "não agendar no passado"
 * segue valendo; o harness é que deixa de escolher um horário já vencido, o
 * que o tornava dependente da hora de execução.
 */
async function freeAnaSlots(count: number): Promise<Row[]> {
  const slots = rowsOf(
    await mockSupabaseClient
      .from("availability")
      .select("*")
      .eq("barbershop_id", MOCK_BARBERSHOP_ID)
      .eq("barber_id", MOCK_USER_IDS.barberAna)
      .eq("status", "livre")
      .order("date")
      .order("start_time"),
  );
  return pickFutureFreeSlots(slots, count) as Row[];
}

async function testNotificationEvents(): Promise<void> {
  group("notificações — ciclo do agendamento");
  resetMockDatabase();
  clearMockSession();

  const carlaId = await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);
  const slots = await freeAnaSlots(2);
  if (slots.length < 2) {
    check("há ao menos 2 horários livres do Ana no seed", false, `encontrados=${slots.length}`);
    return;
  }

  /* ---- criar agendamento gera notificações previstas ---- */
  const booked = await mockSupabaseClient
    .from("appointments")
    .insert({
      barbershop_id: MOCK_BARBERSHOP_ID,
      barber_id: MOCK_USER_IDS.barberAna,
      client_id: carlaId,
      service_id: MOCK_SERVICE_IDS.corte,
      date: slots[0].date,
      start_time: slots[0].start_time,
      end_time: slots[0].end_time,
      status: "scheduled",
    })
    .select()
    .single();
  const appt = firstRow(booked);
  check("cria agendamento (cliente Carla, barbeira Ana)", booked.error === null && appt !== null, booked.error?.message ?? "");
  const apptId = appt ? String(appt.id) : "";

  // Cliente recebe "appointment_confirmed".
  const carlaConfirmed = (await ownNotifications()).filter(
    (n) => n.appointment_id === apptId && n.type === "appointment_confirmed",
  );
  check("cliente é notificado (appointment_confirmed)", carlaConfirmed.length === 1, `qtd=${carlaConfirmed.length}`);

  // Barbeira recebe "new_appointment".
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.barberAna]);
  const anaNew = (await ownNotifications()).filter(
    (n) => n.appointment_id === apptId && n.type === "new_appointment",
  );
  check("profissional é notificado (new_appointment)", anaNew.length === 1, `qtd=${anaNew.length}`);

  // Admin recebe "new_appointment".
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.admin]);
  const adminNew = (await ownNotifications()).filter(
    (n) => n.appointment_id === apptId && n.type === "new_appointment",
  );
  check("admin é notificado (new_appointment)", adminNew.length === 1, `qtd=${adminNew.length}`);

  /* ---- reagendar gera notificação de reagendamento ---- */
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);
  const reschedule = await mockSupabaseClient
    .from("appointments")
    .update({ date: slots[1].date, start_time: slots[1].start_time, end_time: slots[1].end_time })
    .eq("id", apptId);
  check("reagenda o agendamento", reschedule.error === null, reschedule.error?.message ?? "");

  const carlaResched = (await ownNotifications()).filter(
    (n) => n.appointment_id === apptId && n.type === "appointment_rescheduled",
  );
  check("cliente notificado do reagendamento", carlaResched.length === 1, `qtd=${carlaResched.length}`);

  /* ---- cancelar gera notificação de cancelamento ---- */
  const cancel = await mockSupabaseClient
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("id", apptId);
  check("cancela o agendamento", cancel.error === null, cancel.error?.message ?? "");

  const carlaCancelled = (await ownNotifications()).filter(
    (n) => n.appointment_id === apptId && n.type === "appointment_cancelled",
  );
  check("cliente notificado do cancelamento", carlaCancelled.length === 1, `qtd=${carlaCancelled.length}`);

  /* ---- repetir a mesma operação NÃO duplica notificações ---- */
  await mockSupabaseClient.from("appointments").update({ status: "cancelled" }).eq("id", apptId);
  const afterRepeat = (await ownNotifications()).filter(
    (n) => n.appointment_id === apptId && n.type === "appointment_cancelled",
  );
  check("cancelar de novo não duplica a notificação", afterRepeat.length === 1, `qtd=${afterRepeat.length}`);
}

/* ------------------------------------------------------------------ */
/* Avaliações                                                          */
/* ------------------------------------------------------------------ */

async function testReviews(): Promise<void> {
  group("avaliações");
  resetMockDatabase();
  clearMockSession();

  /* ---- média/contagem iniciais derivadas do store ---- */
  const aReviews = rowsOf(
    await mockSupabaseClient.from("reviews").select("*").eq("barbershop_id", MOCK_BARBERSHOP_ID),
  );
  const expected = ratingAggregateFor(MOCK_BARBERSHOP_ID, aReviews);
  const pubA = firstRow(
    await mockSupabaseClient
      .from("barbearias_publicas")
      .select("rating_avg, rating_count")
      .eq("id", MOCK_BARBERSHOP_ID)
      .maybeSingle(),
  );
  check(
    "página pública: contagem = nº de avaliações do store",
    Number(pubA?.rating_count) === expected.rating_count,
    `pub=${String(pubA?.rating_count)} store=${expected.rating_count}`,
  );
  check(
    "página pública: média = média do store",
    Number(pubA?.rating_avg) === expected.rating_avg,
    `pub=${String(pubA?.rating_avg)} store=${expected.rating_avg}`,
  );

  /* ---- média sem avaliações (barbearia C) ---- */
  const pubC = firstRow(
    await mockSupabaseClient
      .from("barbearias_publicas")
      .select("rating_avg, rating_count")
      .eq("id", MOCK_BARBERSHOP_C_ID)
      .maybeSingle(),
  );
  check(
    "média sem avaliações = 0/0 (barbearia C)",
    Number(pubC?.rating_avg) === 0 && Number(pubC?.rating_count) === 0,
    `avg=${String(pubC?.rating_avg)} count=${String(pubC?.rating_count)}`,
  );

  /* ---- isolamento por tenant: A não recebe reviews da B ---- */
  const onlyA = aReviews.every((r) => r.barbershop_id === MOCK_BARBERSHOP_ID);
  check("isolamento: avaliações de A não incluem as da B", onlyA);

  /* ---- cliente avalia atendimento concluído ---- */
  clearMockSession();
  const caioId = await loginEmail(EMAILS[MOCK_USER_IDS.clienteCaio]);
  const validReview = await mockSupabaseClient.from("reviews").insert({
    appointment_id: MOCK_APPOINTMENT_IDS.completedUnreviewedA,
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: caioId,
    rating: 5,
    comment: "Excelente!",
  });
  check("cliente avalia atendimento concluído", validReview.error === null, validReview.error?.message ?? "");

  /* ---- média recalculada após nova avaliação ---- */
  const aReviews2 = rowsOf(
    await mockSupabaseClient.from("reviews").select("*").eq("barbershop_id", MOCK_BARBERSHOP_ID),
  );
  const expected2 = ratingAggregateFor(MOCK_BARBERSHOP_ID, aReviews2);
  const pubA2 = firstRow(
    await mockSupabaseClient
      .from("barbearias_publicas")
      .select("rating_avg, rating_count")
      .eq("id", MOCK_BARBERSHOP_ID)
      .maybeSingle(),
  );
  check(
    "média recalculada após nova avaliação",
    Number(pubA2?.rating_count) === expected2.rating_count &&
      Number(pubA2?.rating_avg) === expected2.rating_avg &&
      expected2.rating_count === expected.rating_count + 1,
    `count ${expected.rating_count} -> ${expected2.rating_count}, avg ${String(pubA2?.rating_avg)}`,
  );

  /* ---- segunda avaliação do mesmo atendimento é recusada ---- */
  const dup = await mockSupabaseClient.from("reviews").insert({
    appointment_id: MOCK_APPOINTMENT_IDS.completedUnreviewedA,
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: caioId,
    rating: 4,
  });
  check(
    "segunda avaliação do mesmo atendimento recusada",
    dup.error !== null && dup.error?.code === "MOCK_RULE",
    dup.error?.message ?? "sem erro",
  );

  /* ---- rating fora de 1..5 é recusado ---- */
  const badRatingHigh = await mockSupabaseClient.from("reviews").insert({
    appointment_id: null,
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: caioId,
    rating: 6,
  });
  check("rating > 5 recusado", badRatingHigh.error !== null, badRatingHigh.error?.message ?? "sem erro");

  const badRatingLow = await mockSupabaseClient.from("reviews").insert({
    appointment_id: null,
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: caioId,
    rating: 0,
  });
  check("rating < 1 recusado", badRatingLow.error !== null, badRatingLow.error?.message ?? "sem erro");

  /* ---- avaliação de atendimento agendado (não concluído) recusada ---- */
  clearMockSession();
  const carlaId = await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);
  const notCompleted = await mockSupabaseClient.from("reviews").insert({
    appointment_id: MOCK_APPOINTMENT_IDS.scheduledA,
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: carlaId,
    rating: 5,
  });
  check(
    "avaliar atendimento agendado (não concluído) recusado",
    notCompleted.error !== null && notCompleted.error?.code === "MOCK_RULE",
    notCompleted.error?.message ?? "sem erro",
  );

  /* ---- cliente não avalia atendimento de OUTRO cliente ---- */
  const foreignAppt = await mockSupabaseClient.from("reviews").insert({
    appointment_id: MOCK_APPOINTMENT_IDS.completedUnreviewedA, // agendamento do Caio
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: carlaId,
    rating: 5,
  });
  check(
    "cliente não avalia atendimento de outro cliente (MOCK_RULE)",
    foreignAppt.error !== null && foreignAppt.error?.code === "MOCK_RULE",
    foreignAppt.error?.message ?? "sem erro",
  );

  const asOther = await mockSupabaseClient.from("reviews").insert({
    appointment_id: MOCK_APPOINTMENT_IDS.completedUnreviewedA,
    barbershop_id: MOCK_BARBERSHOP_ID,
    client_id: MOCK_USER_IDS.clienteCaio, // tenta usar o id de outro cliente
    rating: 5,
  });
  check(
    "cliente não avalia em nome de outro (MOCK_FORBIDDEN)",
    asOther.error !== null && asOther.error?.code === "MOCK_FORBIDDEN",
    asOther.error?.message ?? "sem erro",
  );
}

async function testRestore(): Promise<void> {
  group("restaurar dados");
  resetMockDatabase();
  clearMockSession();

  const unread = firstRow(
    await mockSupabaseClient.from("notifications").select("read").eq("id", MOCK_NOTIFICATION_IDS.carlaUnread),
  );
  // Sem sessão o guard de leitura devolve vazio; validamos direto no store.
  const raw = getTableRows("notifications").find((n) => n.id === MOCK_NOTIFICATION_IDS.carlaUnread);
  check("após restaurar: notificação volta a NÃO lida", raw?.read === false, String(raw?.read));
  void unread;

  const aReviews = getTableRows("reviews").filter((r) => r.barbershop_id === MOCK_BARBERSHOP_ID);
  const shopA = getTableRows("barbershops").find((s) => s.id === MOCK_BARBERSHOP_ID);
  const expected = ratingAggregateFor(MOCK_BARBERSHOP_ID, aReviews);
  check(
    "após restaurar: média/contagem de A voltam ao seed derivado",
    Number(shopA?.rating_count) === expected.rating_count &&
      Number(shopA?.rating_avg) === expected.rating_avg,
    `count=${String(shopA?.rating_count)} avg=${String(shopA?.rating_avg)}`,
  );
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

export interface HarnessOutcome {
  passed: number;
  failed: number;
  report: string;
}

export async function runHarness(): Promise<HarnessOutcome> {
  const groups: Array<[string, () => Promise<void>]> = [
    ["notificacoes-basico", testNotificationsBasics],
    ["notificacoes-eventos", testNotificationEvents],
    ["avaliacoes", testReviews],
    ["restaurar", testRestore],
  ];

  for (const [name, fn] of groups) {
    try {
      await fn();
    } catch (err) {
      check(`grupo "${name}" executou sem exceção`, false, err instanceof Error ? err.message : String(err));
    }
  }

  const lines: string[] = [];
  let passed = 0;
  let failed = 0;
  let printedGroup = "";

  for (const item of checks) {
    if (item.group !== printedGroup) {
      lines.push(`\n▸ ${item.group}`);
      printedGroup = item.group;
    }
    if (item.ok) passed += 1;
    else failed += 1;
    const mark = item.ok ? "  ✓" : "  ✗";
    const detail = item.detail && !item.ok ? `  — ${item.detail}` : "";
    lines.push(`${mark} ${item.name}${detail}`);
  }

  lines.push(`\n${failed === 0 ? "OK" : "FALHOU"} — ${passed} passaram, ${failed} falharam.`);
  return { passed, failed, report: lines.join("\n") };
}
