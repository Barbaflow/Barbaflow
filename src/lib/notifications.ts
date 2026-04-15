import { supabase } from "@/integrations/supabase/client";

/**
 * Notification helper for appointment events.
 * Currently logs notifications and shows toasts.
 * When email domain is configured, this will send emails via the transactional email system.
 */

interface AppointmentNotificationData {
  appointmentId: string;
  clientEmail?: string;
  clientName?: string;
  serviceName: string;
  date: string;
  startTime: string;
  barbershopName?: string;
}

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function formatDateBR(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getDate()} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
}

/**
 * Sends a booking confirmation notification.
 * Will send email when email infrastructure is configured.
 */
export async function notifyBookingConfirmed(data: AppointmentNotificationData) {
  console.log("[Notification] Booking confirmed:", {
    appointmentId: data.appointmentId,
    service: data.serviceName,
    date: formatDateBR(data.date),
    time: data.startTime.slice(0, 5),
  });

  // TODO: When email domain is configured, uncomment:
  // await sendTransactionalEmail({
  //   templateName: 'booking-confirmation',
  //   recipientEmail: data.clientEmail!,
  //   idempotencyKey: `booking-confirm-${data.appointmentId}`,
  //   templateData: {
  //     clientName: data.clientName,
  //     serviceName: data.serviceName,
  //     date: formatDateBR(data.date),
  //     time: data.startTime.slice(0, 5),
  //     barbershopName: data.barbershopName,
  //   },
  // });
}

/**
 * Sends a booking cancellation notification.
 * Will send email when email infrastructure is configured.
 */
export async function notifyBookingCancelled(data: AppointmentNotificationData) {
  console.log("[Notification] Booking cancelled:", {
    appointmentId: data.appointmentId,
    service: data.serviceName,
    date: formatDateBR(data.date),
    time: data.startTime.slice(0, 5),
  });

  // TODO: When email domain is configured, uncomment:
  // await sendTransactionalEmail({
  //   templateName: 'booking-cancellation',
  //   recipientEmail: data.clientEmail!,
  //   idempotencyKey: `booking-cancel-${data.appointmentId}`,
  //   templateData: {
  //     clientName: data.clientName,
  //     serviceName: data.serviceName,
  //     date: formatDateBR(data.date),
  //     time: data.startTime.slice(0, 5),
  //     barbershopName: data.barbershopName,
  //   },
  // });
}

/**
 * Fetches appointment details needed for notifications.
 */
export async function getAppointmentNotificationData(
  appointmentId: string
): Promise<AppointmentNotificationData | null> {
  const { data, error } = await supabase
    .from("appointments")
    .select(`
      id, date, start_time, 
      service:services(name),
      barbershop:barbershops(name)
    `)
    .eq("id", appointmentId)
    .single();

  if (error || !data) return null;

  const service = data.service as unknown as { name: string } | null;
  const barbershop = data.barbershop as unknown as { name: string } | null;

  return {
    appointmentId: data.id,
    serviceName: service?.name ?? "Serviço",
    date: data.date,
    startTime: data.start_time,
    barbershopName: barbershop?.name,
  };
}
