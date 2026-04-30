// Fuso horário de operação do tenant.
// Default: America/Sao_Paulo (UTC-3, sem DST). Cada barbearia pode ter seu
// próprio fuso via coluna `barbershops.timezone`. O valor ativo é definido
// dinamicamente após o carregamento do tenant (ver setActiveTenantTZ).
export const DEFAULT_TENANT_TZ = "America/Sao_Paulo";

let _activeTenantTZ: string = DEFAULT_TENANT_TZ;

/**
 * Define o fuso ativo do tenant. Chamado uma vez quando o BarbershopProvider
 * resolve a barbearia atual. Validamos via Intl para evitar fusos inválidos.
 */
export function setActiveTenantTZ(tz: string | null | undefined): void {
  if (!tz) {
    _activeTenantTZ = DEFAULT_TENANT_TZ;
    return;
  }
  try {
    // Lança RangeError se a TZ for inválida.
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    _activeTenantTZ = tz;
  } catch {
    _activeTenantTZ = DEFAULT_TENANT_TZ;
  }
}

/** Retorna o TZ ativo do tenant (ou o default se ainda não foi definido). */
export function getActiveTenantTZ(): string {
  return _activeTenantTZ;
}

/**
 * @deprecated Use getActiveTenantTZ() para reagir ao tenant carregado.
 * Mantido como constante de compatibilidade — sempre devolve o default.
 */
export const TENANT_TZ = DEFAULT_TENANT_TZ;

/**
 * Retorna { iso, minutes } representando "agora" no fuso do tenant:
 * - iso: data local YYYY-MM-DD
 * - minutes: minutos desde 00:00 do dia local
 *
 * Usa Intl.DateTimeFormat para extrair os componentes na timezone alvo,
 * evitando depender do relógio local do navegador (que pode estar em outro fuso).
 */
export function nowInTenantTZ(tz: string = getActiveTenantTZ()): {
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
  tz: string = getActiveTenantTZ()
): boolean {
  const { iso: todayISO, minutes: nowMin } = nowInTenantTZ(tz);
  if (dateISO < todayISO) return true;
  if (dateISO > todayISO) return false;
  return timeToMinutes(startTime) <= nowMin;
}

/** YYYY-MM-DD do "hoje" no fuso do tenant. */
export function todayISOInTenantTZ(tz: string = getActiveTenantTZ()): string {
  return nowInTenantTZ(tz).iso;
}

/** True se a data (YYYY-MM-DD) é anterior ao "hoje" no fuso do tenant. */
export function isPastDateInTenantTZ(dateISO: string, tz: string = getActiveTenantTZ()): boolean {
  return dateISO < todayISOInTenantTZ(tz);
}

/**
 * Converte (date YYYY-MM-DD, time HH:MM[:SS]) interpretados no fuso do tenant
 * para o instante UTC absoluto correspondente, em milissegundos.
 *
 * Usado para comparar "quanto falta até o agendamento" de forma estável
 * independente do fuso do dispositivo do usuário.
 *
 * Implementação: descobrimos o offset do TZ na data alvo (que pode mudar com DST)
 * formatando a data como se fosse UTC e medindo a diferença.
 */
export function tenantDateTimeToUTCms(
  dateISO: string,
  time: string,
  tz: string = getActiveTenantTZ()
): number {
  const [h, m, s = "0"] = time.split(":");
  // Ponto de partida: tratamos os componentes como se fossem UTC.
  const asIfUTC = Date.UTC(
    Number(dateISO.slice(0, 4)),
    Number(dateISO.slice(5, 7)) - 1,
    Number(dateISO.slice(8, 10)),
    Number(h),
    Number(m),
    Number(s)
  );
  // Calcula o offset do TZ para esse instante. Renderizamos `asIfUTC` no TZ alvo
  // e medimos a diferença em minutos contra a leitura UTC.
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(asIfUTC));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const tzAsUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second")
  );
  const offsetMs = tzAsUTC - asIfUTC; // quanto o TZ está adiantado em relação ao UTC
  return asIfUTC - offsetMs;
}
