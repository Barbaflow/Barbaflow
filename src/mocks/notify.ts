/**
 * Gatilhos internos de notificação do modo offline.
 *
 * Espelham os triggers `notify_appointment_change`,
 * `notify_appointment_rescheduled` e `notify_review_reply` do banco real:
 * quando um agendamento é criado, tem o status alterado ou é reagendado — ou
 * quando uma avaliação recebe resposta — inserem linhas em `notifications`
 * para os destinatários corretos (cliente, profissional, admins).
 *
 * Escrevem direto no store (como um trigger SECURITY DEFINER), sem passar pela
 * autorização de escrita do cliente. Nada é enviado para fora: nenhum email,
 * SMS, WhatsApp ou push. São best-effort — nunca lançam para não derrubar a
 * escrita que os disparou.
 */
import { getTableRows, setTableRows, type MockRow } from "./store";

interface NotificationDraft {
  user_id: string;
  barbershop_id: string;
  appointment_id: string | null;
  type: string;
  title: string;
  message: string;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mock-notif-${Date.now().toString(16)}-${Math.floor(Math.random() * 1e9).toString(16)}`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function profileName(userId: string | null): string {
  if (!userId) return "Cliente";
  const profile = getTableRows("profiles").find((row) => row.user_id === userId);
  const name = asString(profile?.full_name);
  return name ?? "Cliente";
}

function serviceName(serviceId: string | null): string {
  if (!serviceId) return "atendimento";
  const service = getTableRows("services").find((row) => row.id === serviceId);
  return asString(service?.name) ?? "atendimento";
}

function barbershopName(barbershopId: string | null): string {
  if (!barbershopId) return "a barbearia";
  const shop = getTableRows("barbershops").find((row) => row.id === barbershopId);
  return asString(shop?.name) ?? "a barbearia";
}

/** "YYYY-MM-DD" → "DD/MM"; "HH:MM:SS" → "HH:MM". */
function shortDate(date: string | null): string {
  if (!date) return "";
  const [, month, day] = date.split("-");
  return month && day ? `${day}/${month}` : date;
}
function shortTime(time: string | null): string {
  return time ? time.slice(0, 5) : "";
}

/** Grava as notificações (best-effort). Um destinatário nulo é ignorado. */
function commit(drafts: NotificationDraft[]): void {
  const valid = drafts.filter((draft) => draft.user_id && draft.barbershop_id);
  if (valid.length === 0) return;

  const now = new Date().toISOString();
  const rows: MockRow[] = valid.map((draft) => ({
    id: newId(),
    user_id: draft.user_id,
    barbershop_id: draft.barbershop_id,
    appointment_id: draft.appointment_id,
    type: draft.type,
    title: draft.title,
    message: draft.message,
    read: false,
    created_at: now,
  }));

  setTableRows("notifications", [...getTableRows("notifications"), ...rows]);
}

/** Admins (admin_barbearia) da barbearia, exceto os ids informados. */
function adminsOf(barbershopId: string, exclude: Array<string | null>): string[] {
  const excluded = new Set(exclude.filter((id): id is string => Boolean(id)));
  return getTableRows("user_roles")
    .filter(
      (row) =>
        row.barbershop_id === barbershopId &&
        row.role === "admin_barbearia" &&
        !excluded.has(String(row.user_id)),
    )
    .map((row) => String(row.user_id));
}

/**
 * Novo agendamento: notifica o profissional, os admins e confirma para o
 * cliente. Espelha o ramo INSERT de `notify_appointment_change`.
 */
export function notifyOnAppointmentInsert(appointment: MockRow): void {
  try {
    const barbershopId = asString(appointment.barbershop_id);
    const clientId = asString(appointment.client_id);
    const barberId = asString(appointment.barber_id);
    const appointmentId = asString(appointment.id);
    if (!barbershopId || !clientId) return;

    const when = `${shortDate(asString(appointment.date))} às ${shortTime(
      asString(appointment.start_time),
    )}`;
    const service = serviceName(asString(appointment.service_id));
    const client = profileName(clientId);
    const drafts: NotificationDraft[] = [];

    const staffMessage = `${client} agendou ${service} para ${when}`;

    if (barberId && barberId !== clientId) {
      drafts.push({
        user_id: barberId,
        barbershop_id: barbershopId,
        appointment_id: appointmentId,
        type: "new_appointment",
        title: "Novo agendamento",
        message: staffMessage,
      });
    }

    for (const adminId of adminsOf(barbershopId, [clientId, barberId])) {
      drafts.push({
        user_id: adminId,
        barbershop_id: barbershopId,
        appointment_id: appointmentId,
        type: "new_appointment",
        title: "Novo agendamento",
        message: staffMessage,
      });
    }

    drafts.push({
      user_id: clientId,
      barbershop_id: barbershopId,
      appointment_id: appointmentId,
      type: "appointment_confirmed",
      title: "Agendamento confirmado",
      message: `Seu agendamento de ${service} em ${barbershopName(
        barbershopId,
      )} foi confirmado para ${when}`,
    });

    commit(drafts);
  } catch {
    // best-effort: nunca derruba a escrita do agendamento
  }
}

/**
 * Mudança em um agendamento existente. Se o status mudou, notifica
 * cancelamento/conclusão; se apenas o encaixe mudou (data/horário/profissional),
 * notifica o reagendamento. Espelha o ramo UPDATE de
 * `notify_appointment_change` + `notify_appointment_rescheduled`.
 */
export function notifyOnAppointmentUpdate(previous: MockRow, next: MockRow): void {
  try {
    const barbershopId = asString(next.barbershop_id);
    const clientId = asString(next.client_id);
    const appointmentId = asString(next.id);
    if (!barbershopId || !clientId) return;

    const service = serviceName(asString(next.service_id));
    const when = `${shortDate(asString(next.date))} às ${shortTime(asString(next.start_time))}`;
    const drafts: NotificationDraft[] = [];

    const statusChanged = previous.status !== next.status;

    if (statusChanged) {
      const barberId = asString(next.barber_id);
      if (next.status === "cancelled") {
        drafts.push({
          user_id: clientId,
          barbershop_id: barbershopId,
          appointment_id: appointmentId,
          type: "appointment_cancelled",
          title: "Agendamento cancelado",
          message: `Seu agendamento de ${service} em ${when} foi cancelado.`,
        });
        if (barberId && barberId !== clientId) {
          drafts.push({
            user_id: barberId,
            barbershop_id: barbershopId,
            appointment_id: appointmentId,
            type: "appointment_cancelled",
            title: "Agendamento cancelado",
            message: `${profileName(clientId)} cancelou o agendamento de ${service} em ${when}`,
          });
        }
      } else if (next.status === "completed") {
        drafts.push({
          user_id: clientId,
          barbershop_id: barbershopId,
          appointment_id: appointmentId,
          type: "appointment_completed",
          title: "Serviço concluído",
          message: `Seu ${service} em ${barbershopName(barbershopId)} foi concluído. Obrigado!`,
        });
      }
      commit(drafts);
      return;
    }

    // Sem mudança de status: reagendamento se data/horário/profissional mudaram.
    const barberChanged = previous.barber_id !== next.barber_id;
    const scheduleChanged =
      previous.date !== next.date ||
      previous.start_time !== next.start_time ||
      previous.end_time !== next.end_time ||
      barberChanged;
    if (!scheduleChanged) return;

    const newBarberId = asString(next.barber_id);
    const oldBarberId = asString(previous.barber_id);

    drafts.push({
      user_id: clientId,
      barbershop_id: barbershopId,
      appointment_id: appointmentId,
      type: "appointment_rescheduled",
      title: "Agendamento reagendado",
      message: `Seu ${service} foi reagendado para ${when}${
        barberChanged ? ` com ${profileName(newBarberId)}` : ""
      }`,
    });

    if (newBarberId && newBarberId !== clientId) {
      drafts.push({
        user_id: newBarberId,
        barbershop_id: barbershopId,
        appointment_id: appointmentId,
        type: "appointment_rescheduled",
        title: barberChanged ? "Agendamento transferido para você" : "Agendamento reagendado",
        message: `${profileName(clientId)} — ${service} em ${when}`,
      });
    }

    if (barberChanged && oldBarberId && oldBarberId !== clientId) {
      drafts.push({
        user_id: oldBarberId,
        barbershop_id: barbershopId,
        appointment_id: appointmentId,
        type: "appointment_rescheduled",
        title: "Agendamento transferido",
        message: `${profileName(clientId)} foi transferido para ${profileName(
          newBarberId,
        )} (${when}).`,
      });
    }

    commit(drafts);
  } catch {
    // best-effort
  }
}

/**
 * Resposta a uma avaliação: notifica o autor da avaliação. Espelha
 * `notify_review_reply` (dispara quando `reply` passa a existir ou muda e o
 * autor não é quem respondeu).
 */
export function notifyOnReviewReply(previous: MockRow, next: MockRow): void {
  try {
    const reply = asString(next.reply);
    if (!reply) return;
    if (previous.reply === next.reply) return;

    const clientId = asString(next.client_id);
    const barbershopId = asString(next.barbershop_id);
    if (!clientId || !barbershopId) return;
    if (asString(next.replied_by) === clientId) return;

    const excerpt = reply.length > 117 ? `${reply.slice(0, 117)}…` : reply;
    commit([
      {
        user_id: clientId,
        barbershop_id: barbershopId,
        appointment_id: asString(next.appointment_id),
        type: "review_reply",
        title: previous.reply ? "Resposta atualizada" : "Resposta à sua avaliação",
        message: `${barbershopName(barbershopId)} respondeu à sua avaliação: "${excerpt}"`,
      },
    ]);
  } catch {
    // best-effort
  }
}
