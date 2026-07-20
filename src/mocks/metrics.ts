/**
 * Agregações do modo offline.
 *
 * Funções puras que replicam exatamente as regras já usadas pelos
 * componentes (BarberReports, BarberDashboard), para que as RPCs e os testes
 * headless partam da mesma fonte. Nada aqui lê o store: as linhas entram por
 * parâmetro, o que torna cada função testável isoladamente.
 *
 * Regra de faturamento (a mesma de BarberReports.fetchMonthData):
 *   - só agendamentos com status "completed" geram receita;
 *   - quando existe comanda fechada, vale o total da comanda;
 *   - sem comanda, vale o preço do serviço.
 */

/** Status válidos no schema. Nenhum outro valor é considerado. */
export const APPOINTMENT_STATUSES = ["scheduled", "completed", "cancelled", "no_show"] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Recorte de agendamento suficiente para todas as métricas. */
export interface MetricAppointment {
  id: string;
  date: string;
  start_time: string;
  status: AppointmentStatus;
  barber_id: string;
  client_id: string;
  service_id: string;
  servicePrice: number;
  serviceName: string | null;
  /** Total da comanda fechada, quando houver. */
  ticketTotal?: number;
}

export interface MetricsSummary {
  total: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Faturamento bruto estimado (somente concluídos). */
  revenue: number;
  /** revenue / completed — 0 quando não há concluídos. */
  avgTicket: number;
  /** cancelled / total — 0 quando não há agendamentos. */
  cancellationRate: number;
  /** noShow / total — 0 quando não há agendamentos. */
  noShowRate: number;
  uniqueClients: number;
}

export interface GroupPerformance {
  key: string;
  label: string;
  total: number;
  completed: number;
  cancelled: number;
  noShow: number;
  revenue: number;
}

/* ------------------------------------------------------------------ */
/* Helpers numéricos                                                   */
/* ------------------------------------------------------------------ */

/**
 * Divisão segura: nunca devolve NaN nem Infinity.
 * Toda razão exibida na interface passa por aqui.
 */
export function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator === 0) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ------------------------------------------------------------------ */
/* Receita                                                             */
/* ------------------------------------------------------------------ */

/** Receita de um agendamento isolado, segundo a regra do projeto. */
export function revenueOf(appointment: MetricAppointment): number {
  if (appointment.status !== "completed") return 0;
  if (appointment.ticketTotal !== undefined) return toNumber(appointment.ticketTotal);
  return toNumber(appointment.servicePrice);
}

/* ------------------------------------------------------------------ */
/* Resumo                                                              */
/* ------------------------------------------------------------------ */

export function summarize(appointments: readonly MetricAppointment[]): MetricsSummary {
  const countOf = (status: AppointmentStatus) =>
    appointments.filter((item) => item.status === status).length;

  const total = appointments.length;
  const completed = countOf("completed");
  const cancelled = countOf("cancelled");
  const noShow = countOf("no_show");
  const revenue = appointments.reduce((sum, item) => sum + revenueOf(item), 0);

  return {
    total,
    scheduled: countOf("scheduled"),
    completed,
    cancelled,
    noShow,
    revenue,
    avgTicket: safeRatio(revenue, completed),
    cancellationRate: safeRatio(cancelled, total),
    noShowRate: safeRatio(noShow, total),
    uniqueClients: new Set(appointments.map((item) => item.client_id)).size,
  };
}

/* ------------------------------------------------------------------ */
/* Período                                                             */
/* ------------------------------------------------------------------ */

/** Filtra por intervalo de datas ISO, inclusivo nas duas pontas. */
export function filterByPeriod(
  appointments: readonly MetricAppointment[],
  startDate: string,
  endDate: string,
): MetricAppointment[] {
  return appointments.filter((item) => item.date >= startDate && item.date <= endDate);
}

/** Intervalo [início, fim] dos últimos `days` dias, terminando hoje. */
export function lastDaysRange(days: number, today = new Date()): { start: string; end: string } {
  const end = new Date(today);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Intervalo do mês (month: 0-11), no formato usado por BarberReports. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const lastDay = new Date(year, month + 1, 0).getDate();
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  return { start: `${prefix}-01`, end: `${prefix}-${String(lastDay).padStart(2, "0")}` };
}

/* ------------------------------------------------------------------ */
/* Agrupamentos                                                        */
/* ------------------------------------------------------------------ */

function groupBy(
  appointments: readonly MetricAppointment[],
  keyOf: (item: MetricAppointment) => string,
  labelOf: (item: MetricAppointment) => string,
): GroupPerformance[] {
  const groups = new Map<string, GroupPerformance>();

  for (const item of appointments) {
    const key = keyOf(item);
    const current =
      groups.get(key) ??
      ({
        key,
        label: labelOf(item),
        total: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        revenue: 0,
      } satisfies GroupPerformance);

    current.total += 1;
    if (item.status === "completed") current.completed += 1;
    if (item.status === "cancelled") current.cancelled += 1;
    if (item.status === "no_show") current.noShow += 1;
    current.revenue += revenueOf(item);

    groups.set(key, current);
  }

  return [...groups.values()].sort((a, b) => b.total - a.total || b.revenue - a.revenue);
}

/** Desempenho por serviço, ordenado por volume. */
export function performanceByService(
  appointments: readonly MetricAppointment[],
): GroupPerformance[] {
  return groupBy(
    appointments,
    (item) => item.service_id,
    (item) => item.serviceName ?? "Serviço removido",
  );
}

/** Desempenho por profissional, ordenado por volume. */
export function performanceByBarber(
  appointments: readonly MetricAppointment[],
  displayNames: Readonly<Record<string, string>> = {},
): GroupPerformance[] {
  return groupBy(
    appointments,
    (item) => item.barber_id,
    (item) => displayNames[item.barber_id] ?? "Profissional",
  );
}

/** Serviço mais agendado, ou `null` quando não há dados. */
export function topService(appointments: readonly MetricAppointment[]): GroupPerformance | null {
  return performanceByService(appointments)[0] ?? null;
}

/** Profissional com mais atendimentos, ou `null` quando não há dados. */
export function topBarber(
  appointments: readonly MetricAppointment[],
  displayNames: Readonly<Record<string, string>> = {},
): GroupPerformance | null {
  return performanceByBarber(appointments, displayNames)[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Distribuições                                                       */
/* ------------------------------------------------------------------ */

export interface DayBucket {
  date: string;
  count: number;
  revenue: number;
}

/**
 * Distribuição por dia. Quando `start`/`end` são informados, todos os dias do
 * intervalo aparecem — inclusive os zerados, para o gráfico não ter buracos.
 */
export function distributionByDay(
  appointments: readonly MetricAppointment[],
  start?: string,
  end?: string,
): DayBucket[] {
  const buckets = new Map<string, DayBucket>();

  if (start && end) {
    const cursor = new Date(`${start}T12:00:00`);
    const last = new Date(`${end}T12:00:00`);
    while (cursor <= last && buckets.size < 400) {
      const date = cursor.toISOString().slice(0, 10);
      buckets.set(date, { date, count: 0, revenue: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  const bounded = start && end;

  for (const item of appointments) {
    // Com intervalo explícito, o que está fora dele não vira barra no gráfico.
    if (bounded && (item.date < start || item.date > end)) continue;

    const bucket = buckets.get(item.date) ?? { date: item.date, count: 0, revenue: 0 };
    bucket.count += 1;
    bucket.revenue += revenueOf(item);
    buckets.set(item.date, bucket);
  }

  return [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface HourBucket {
  hour: number;
  count: number;
}

/** Distribuição por hora do dia (0–23), só com as horas que têm agendamento. */
export function distributionByHour(appointments: readonly MetricAppointment[]): HourBucket[] {
  const buckets = new Map<number, number>();

  for (const item of appointments) {
    const hour = Number(item.start_time.slice(0, 2));
    if (!Number.isFinite(hour)) continue;
    buckets.set(hour, (buckets.get(hour) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour - b.hour);
}

/* ------------------------------------------------------------------ */
/* Comparação entre períodos                                           */
/* ------------------------------------------------------------------ */

export interface PeriodComparison {
  current: MetricsSummary;
  previous: MetricsSummary;
  /** Variação relativa da receita (0 quando o período anterior é zero). */
  revenueChange: number;
  /** Variação relativa do total de agendamentos. */
  totalChange: number;
}

/**
 * Compara um intervalo com o intervalo imediatamente anterior de mesma
 * duração. Usa `safeRatio`, então nunca devolve NaN nem Infinity.
 */
export function comparePeriods(
  appointments: readonly MetricAppointment[],
  startDate: string,
  endDate: string,
): PeriodComparison {
  const start = new Date(`${startDate}T12:00:00`);
  const end = new Date(`${endDate}T12:00:00`);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - (spanDays - 1));

  const current = summarize(filterByPeriod(appointments, startDate, endDate));
  const previous = summarize(
    filterByPeriod(
      appointments,
      previousStart.toISOString().slice(0, 10),
      previousEnd.toISOString().slice(0, 10),
    ),
  );

  return {
    current,
    previous,
    revenueChange: safeRatio(current.revenue - previous.revenue, previous.revenue),
    totalChange: safeRatio(current.total - previous.total, previous.total),
  };
}
