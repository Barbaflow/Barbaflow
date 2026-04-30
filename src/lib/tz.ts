// Fuso horário de operação do tenant.
// Hoje todas as barbearias operam no Brasil; usamos America/Sao_Paulo (UTC-3, sem DST).
// Se no futuro houver tenants em outros fusos, expor isto via barbershops.timezone.
export const TENANT_TZ = "America/Sao_Paulo";

/**
 * Retorna { iso, minutes } representando "agora" no fuso do tenant:
 * - iso: data local YYYY-MM-DD
 * - minutes: minutos desde 00:00 do dia local
 *
 * Usa Intl.DateTimeFormat para extrair os componentes na timezone alvo,
 * evitando depender do relógio local do navegador (que pode estar em outro fuso).
 */
export function nowInTenantTZ(tz: string = TENANT_TZ): {
  iso: string;
  minutes: number;
} {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  // Intl pode retornar "24" para meia-noite em algumas engines; normalizar para "00".
  const hourRaw = get("hour");
  const hour = hourRaw === "24" ? "00" : hourRaw;
  const minute = get("minute");

  return {
    iso: `${year}-${month}-${day}`,
    minutes: parseInt(hour, 10) * 60 + parseInt(minute, 10),
  };
}

/** Converte "HH:MM" em minutos desde 00:00. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Decide se um agendamento (date YYYY-MM-DD + start_time HH:MM) é retroativo
 * em relação ao "agora" do fuso do tenant.
 * Cobre tanto datas passadas quanto horários já passados no dia de hoje.
 */
export function isRetroactiveSlot(
  dateISO: string,
  startTime: string,
  tz: string = TENANT_TZ
): boolean {
  const { iso: todayISO, minutes: nowMin } = nowInTenantTZ(tz);
  if (dateISO < todayISO) return true;
  if (dateISO > todayISO) return false;
  return timeToMinutes(startTime) <= nowMin;
}
