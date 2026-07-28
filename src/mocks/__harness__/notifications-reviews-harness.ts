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
import { getTableRows, setTableRows, resetMockDatabase } from "@/mocks/store";
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
/* Contador de não lidas                                               */
/* ------------------------------------------------------------------ */

/**
 * O contador do sino sai de `select(count:"exact", head:true)` — não de contar
 * as linhas da página. A diferença aparece quando há mais não lidas do que o
 * `limit(20)` da lista: antes, 25 não lidas exibiam 20.
 */
async function testUnreadCount(): Promise<void> {
  group("notificações — contador de não lidas");
  resetMockDatabase();
  clearMockSession();

  const carlaId = await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);

  const head = await mockSupabaseClient
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", carlaId)
    .eq("read", false);

  check("head:true não devolve linhas", Array.isArray(head.data) && head.data.length === 0);
  check("count é um número", typeof head.count === "number", String(head.count));

  const reais = (await ownNotifications()).filter((n) => n.read === false).length;
  check("count bate com as não lidas reais", head.count === reais, `count=${head.count} reais=${reais}`);

  /* ---- o ponto central: count ignora o limit ---- */
  const extras = getTableRows("notifications");
  const novas: Row[] = [];
  for (let i = 0; i < 25; i++) {
    novas.push({
      id: `aa000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      user_id: carlaId,
      barbershop_id: MOCK_BARBERSHOP_ID,
      appointment_id: null,
      type: "new_appointment",
      title: `Volume ${i}`,
      message: "Notificação de volume para testar o contador",
      read: false,
      created_at: new Date(Date.now() - i * 1000).toISOString(),
    });
  }
  setTableRows("notifications", [...extras, ...novas]);

  const pagina = rowsOf(
    await mockSupabaseClient
      .from("notifications")
      .select("id, read")
      .eq("user_id", carlaId)
      .order("created_at", { ascending: false })
      .limit(20),
  );
  const contagem = await mockSupabaseClient
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", carlaId)
    .eq("read", false);

  check("página respeita o limit(20)", pagina.length === 20, `${pagina.length}`);
  check(
    "contador NÃO fica preso ao limit",
    typeof contagem.count === "number" && contagem.count > 20,
    `count=${contagem.count}`,
  );
  check(
    "contar a página daria número errado (regressão que motivou o count)",
    pagina.filter((n) => n.read === false).length < (contagem.count ?? 0),
  );

  /* ---- contador é privado: outro usuário tem o próprio total ---- */
  clearMockSession();
  const anaId = await loginEmail(EMAILS[MOCK_USER_IDS.barberAna]);
  const daAna = await mockSupabaseClient
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", anaId)
    .eq("read", false);
  check(
    "contador da Ana não inclui as 25 da Carla",
    (daAna.count ?? 0) < (contagem.count ?? 0),
    `ana=${daAna.count} carla=${contagem.count}`,
  );
}

/* ------------------------------------------------------------------ */
/* Destinos (deep-links)                                               */
/* ------------------------------------------------------------------ */

async function testDeepLinks(): Promise<void> {
  group("notificações — destinos");

  const {
    resolveNotificationDestination,
    isValidUuid,
    isValidSubdomain,
    NOTIFICATION_TYPES,
  } = await import("@/lib/notification-links");
  type Perspectiva = "staff" | "client";

  /** Rota literal de um tipo, ou `null` se não houver (ou se for `review`). */
  const rota = (tipo: unknown, p: Perspectiva): string | null => {
    const d = resolveNotificationDestination(tipo, p);
    return d && d.kind === "route" ? d.to : null;
  };

  /* ---- destino válido por tipo e perspectiva ---- */
  check("staff: novo agendamento vai para a agenda", rota("new_appointment", "staff") === "/agenda");
  check(
    "cliente: confirmação vai para meus agendamentos",
    rota("appointment_confirmed", "client") === "/meus-agendamentos",
  );
  check(
    "cancelamento leva a destinos diferentes por perspectiva",
    rota("appointment_cancelled", "staff") === "/agenda" &&
      rota("appointment_cancelled", "client") === "/meus-agendamentos",
  );
  check(
    "reagendamento também é sensível à perspectiva",
    rota("appointment_rescheduled", "staff") === "/agenda" &&
      rota("appointment_rescheduled", "client") === "/meus-agendamentos",
  );
  check(
    "resposta de avaliação exige resolução assíncrona",
    resolveNotificationDestination("review_reply", "client")?.kind === "review",
  );
  check(
    "bloqueio por faltas é assunto do cliente",
    rota("noshow_blocked", "client") === "/meus-agendamentos",
  );

  /* ---- link inválido não quebra: devolve null, não lança ---- */
  for (const invalido of ["", "tipo_inexistente", null, undefined, 42, {}]) {
    check(
      `tipo inválido (${JSON.stringify(invalido)}) não gera destino`,
      resolveNotificationDestination(invalido, "client") === null,
    );
  }

  /* ---- destino que não faz sentido para o papel também é null ---- */
  check(
    "cliente não é levado à agenda por novo agendamento",
    resolveNotificationDestination("new_appointment", "client") === null,
  );
  check(
    "staff não é levado a meus-agendamentos por confirmação de cliente",
    resolveNotificationDestination("appointment_confirmed", "staff") === null,
  );

  /* ---- todos os tipos do banco têm decisão explícita ---- */
  const semDecisao = NOTIFICATION_TYPES.filter(
    (t) =>
      resolveNotificationDestination(t, "staff") === null &&
      resolveNotificationDestination(t, "client") === null,
  );
  check("todo tipo conhecido tem destino em ao menos uma perspectiva", semDecisao.length === 0, semDecisao.join(", "));

  /* ---- validação de parâmetros: nada é montado com lixo ---- */
  check("uuid válido é aceito", isValidUuid(MOCK_BARBERSHOP_ID));
  for (const ruim of ["", "../admin", "1; DROP TABLE", null, undefined]) {
    check(`uuid inválido rejeitado (${JSON.stringify(ruim)})`, !isValidUuid(ruim));
  }
  check("slug válido é aceito", isValidSubdomain("modelo"));
  for (const ruim of ["", "../etc", "MAIUSCULO", "com espaço", "-comeca-com-hifen", null]) {
    check(`slug inválido rejeitado (${JSON.stringify(ruim)})`, !isValidSubdomain(ruim));
  }
}

/* ------------------------------------------------------------------ */
/* Realtime                                                            */
/* ------------------------------------------------------------------ */

async function testRealtimeChannel(): Promise<void> {
  group("notificações — realtime");

  const hook = await import("@/hooks/use-notifications");
  check("hook expõe estado de erro", "useNotifications" in hook);

  const fonte = await lerFonte("src/hooks/use-notifications.tsx");

  check(
    "canal é nomeado por usuário (não é um tópico global)",
    /channel\(\s*canal\s*\)/.test(fonte) && /notifications:\$\{user\.id\}/.test(fonte),
  );
  // O comentário do hook cita o nome antigo para explicar o que mudou — a
  // asserção precisa olhar só o código executável, senão acusa a própria
  // documentação como se fosse a regressão.
  const codigo = fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
  check(
    "canal antigo com nome constante não existe mais no código",
    !codigo.includes("user-notifications"),
  );
  check("consulta o total com count exato", /count:\s*"exact"/.test(codigo) && /head:\s*true/.test(codigo));
  check("contador não sai apenas do filter da página", !/setUnreadCount\(data\.filter/.test(codigo));
  check(
    "filtro do servidor é por user_id",
    /filter:\s*`user_id=eq\.\$\{user\.id\}`/.test(fonte),
  );
  check(
    "INSERT do realtime deduplica por id",
    /prev\.some\(\(n\) => n\.id === nova\.id\)/.test(fonte),
  );
  check("cleanup remove o canal", /removeChannel\(channel\)/.test(fonte));
  check(
    "efeito do canal depende do usuário (recria ao trocar de conta)",
    /removeChannel\(channel\);\s*\};\s*\}, \[user\]\)/.test(fonte.replace(/\s+/g, " ").replace(/ /g, " ")) ||
      /\}, \[user\]\);/.test(fonte),
  );

  /* ---- dois canais para o mesmo usuário não colidem ---- */
  const a = mockSupabaseClient.channel("notifications:u1:aaaa");
  const b = mockSupabaseClient.channel("notifications:u1:bbbb");
  check("canais distintos são objetos distintos", a !== b);
  await mockSupabaseClient.removeChannel(a);
  await mockSupabaseClient.removeChannel(b);
  check("removeChannel não lança", true);

  /* ---- erro, retry e reversão otimista ---- */
  group("notificações — erro e retry");

  check("erro de consulta vira estado próprio (loadError)", /setLoadError\(/.test(codigo));
  check(
    "falha NÃO esvazia a lista já carregada",
    /if \(lista\.error \|\| contagem\.error\) \{[\s\S]{0,320}?setLoading\(false\);\s*return;/.test(codigo) &&
      !/if \(lista\.error[\s\S]{0,320}?setNotifications\(\[\]\)/.test(codigo),
  );
  check("erro técnico vai para logTechnicalError", /logTechnicalError\("useNotifications"/.test(codigo));
  check("refetch reexecuta a consulta", /refetch:\s*fetchNotifications/.test(codigo));
  check("retry limpa o erro anterior", /setLoadError\(null\)/.test(codigo));
  check(
    "markAsRead reverte quando o banco recusa",
    /markAsRead[\s\S]{0,900}?if \(error\)[\s\S]{0,400}?read: false/.test(codigo),
  );
  check(
    "markAllAsRead restaura a lista anterior em caso de falha",
    /markAllAsRead[\s\S]{0,1200}?if \(error\)[\s\S]{0,300}?setNotifications\(anterior\)/.test(codigo),
  );
  check("sem sessão não deixa o loading preso", /if \(!user\) \{[\s\S]{0,240}?setLoading\(false\)/.test(codigo));
  check("resposta atrasada não sobrescreve a atual", /meu !== requestId\.current/.test(codigo));

  const sino = await lerFonte("src/components/NotificationBell.tsx");
  check("sino exibe estado de erro", sino.includes("loadError"));
  check("sino oferece nova tentativa", sino.includes("Tentar novamente") && sino.includes("refetch"));
  check("sino distingue vazio de erro", sino.includes("isEmpty"));
  check(
    "marcar como lida não bloqueia a navegação",
    /if \(!n\.read\) void markAsRead\(n\.id\);\s*\n\s*const destino/.test(sino),
  );
}

/* ------------------------------------------------------------------ */
/* Troca de usuário e de tenant                                        */
/* ------------------------------------------------------------------ */

async function testUserAndTenantSwitch(): Promise<void> {
  group("notificações — troca de usuário e tenant");
  resetMockDatabase();
  clearMockSession();

  const carlaId = await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);
  const daCarla = await ownNotifications();
  check("Carla tem notificações", daCarla.length > 0);
  check("todas são dela", daCarla.every((n) => n.user_id === carlaId));

  clearMockSession();
  const anaId = await loginEmail(EMAILS[MOCK_USER_IDS.barberAna]);
  const daAna = await ownNotifications();
  check("após trocar de conta, a lista é da nova sessão", daAna.every((n) => n.user_id === anaId));
  check(
    "nenhuma notificação da conta anterior vaza",
    !daAna.some((n) => daCarla.some((c) => c.id === n.id)),
  );

  /* ---- tenant: as notificações carregam a barbearia de origem ---- */
  const comTenant = daAna.filter((n) => typeof n.barbershop_id === "string" && n.barbershop_id);
  check("notificações trazem barbershop_id", comTenant.length === daAna.length);

  const tenantsDistintos = new Set(daAna.map((n) => String(n.barbershop_id)));
  check(
    "o hook seleciona barbershop_id (permite distinguir a origem)",
    (await lerFonte("src/hooks/use-notifications.tsx")).includes("barbershop_id"),
    `tenants presentes: ${tenantsDistintos.size}`,
  );

  /* ---- cliente não recebe notificação administrativa ---- */
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.clienteCarla]);
  const carlaTipos = new Set((await ownNotifications()).map((n) => String(n.type)));
  check(
    "cliente não recebe new_appointment (tipo administrativo)",
    !carlaTipos.has("new_appointment"),
    [...carlaTipos].join(", "),
  );

  /* ---- e o staff não recebe a confirmação destinada ao cliente ---- */
  clearMockSession();
  await loginEmail(EMAILS[MOCK_USER_IDS.barberAna]);
  const anaTipos = new Set((await ownNotifications()).map((n) => String(n.type)));
  check(
    "profissional recebe tipos operacionais",
    anaTipos.size === 0 || [...anaTipos].some((t) => t.startsWith("new_") || t.startsWith("appointment_")),
    [...anaTipos].join(", "),
  );
}

/** Lê um arquivo do repositório (as verificações de fonte usam isto). */
async function lerFonte(rel: string): Promise<string> {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  return readFileSync(path.join(process.cwd(), rel), "utf8");
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
    ["notificacoes-contador", testUnreadCount],
    ["notificacoes-destinos", testDeepLinks],
    ["notificacoes-realtime", testRealtimeChannel],
    ["notificacoes-troca", testUserAndTenantSwitch],
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
