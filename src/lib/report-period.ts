/**
 * Períodos dos relatórios de vendas, calculados NO FUSO DA BARBEARIA.
 *
 * O faturamento é recortado por `closed_at` (timestamptz). Para não errar a
 * data por causa do fuso do dispositivo, todas as bordas são calculadas com os
 * helpers de src/lib/tz.ts:
 *   • as datas do período são YYYY-MM-DD no fuso da barbearia;
 *   • o instante inicial é a meia-noite local do primeiro dia (INCLUSIVO);
 *   • o instante final é a meia-noite local do dia SEGUINTE ao último
 *     (EXCLUSIVO) — nenhuma venda do último dia fica de fora, nenhuma do dia
 *     seguinte entra. Isso evita a virada indevida do `toISOString`.
 */

import {
  addDaysISO,
  formatISODateBR,
  tenantDateTimeToUTCms,
  todayISOInTenantTZ,
} from "@/lib/tz";

export type PeriodPreset = "today" | "last7" | "month" | "prevMonth" | "custom";

export interface ReportPeriod {
  preset: PeriodPreset;
  /** Primeiro dia (YYYY-MM-DD, fuso da barbearia), inclusivo. */
  startISO: string;
  /** Último dia (YYYY-MM-DD, fuso da barbearia), inclusivo. */
  endISO: string;
  /** Instante UTC inclusivo (meia-noite local do primeiro dia). */
  startInstant: string;
  /** Instante UTC exclusivo (meia-noite local do dia seguinte ao último). */
  endInstant: string;
  /** Rótulo pt-BR para exibir na interface. */
  label: string;
  /** Todos os dias YYYY-MM-DD do intervalo (para preencher zeros no gráfico). */
  days: string[];
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Primeiro dia do mês de uma data YYYY-MM-DD. */
function firstOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Último dia do mês (YYYY-MM-DD) de um ano/mês. */
function lastOfMonth(year: number, monthIdx0: number): string {
  const day = new Date(Date.UTC(year, monthIdx0 + 1, 0)).getUTCDate();
  return `${year}-${String(monthIdx0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Lista de dias YYYY-MM-DD de start a end, inclusive (cap de segurança). */
function daysBetween(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  let cursor = startISO;
  for (let i = 0; i < 800 && cursor <= endISO; i++) {
    out.push(cursor);
    cursor = addDaysISO(cursor, 1);
  }
  return out;
}

function buildPeriod(preset: PeriodPreset, startISO: string, endISO: string, tz: string): ReportPeriod {
  const startInstant = new Date(tenantDateTimeToUTCms(startISO, "00:00", tz)).toISOString();
  // Fim exclusivo: meia-noite local do dia seguinte ao último dia.
  const endInstant = new Date(tenantDateTimeToUTCms(addDaysISO(endISO, 1), "00:00", tz)).toISOString();
  return {
    preset,
    startISO,
    endISO,
    startInstant,
    endInstant,
    label: labelFor(preset, startISO, endISO),
    days: daysBetween(startISO, endISO),
  };
}

function labelFor(preset: PeriodPreset, startISO: string, endISO: string): string {
  switch (preset) {
    case "today":
      return `Hoje (${formatISODateBR(startISO)})`;
    case "last7":
      return `Últimos 7 dias (${formatISODateBR(startISO)} – ${formatISODateBR(endISO)})`;
    case "month": {
      const m = Number(startISO.slice(5, 7)) - 1;
      return `${MONTHS[m]} de ${startISO.slice(0, 4)}`;
    }
    case "prevMonth": {
      const m = Number(startISO.slice(5, 7)) - 1;
      return `${MONTHS[m]} de ${startISO.slice(0, 4)}`;
    }
    default:
      return `${formatISODateBR(startISO)} – ${formatISODateBR(endISO)}`;
  }
}

/** Resolve um preset (ou custom) para um período concreto no fuso da barbearia. */
export function resolvePeriod(
  preset: PeriodPreset,
  tz: string,
  custom?: { startISO: string; endISO: string },
): ReportPeriod {
  const today = todayISOInTenantTZ(tz);

  switch (preset) {
    case "today":
      return buildPeriod("today", today, today, tz);
    case "last7":
      return buildPeriod("last7", addDaysISO(today, -6), today, tz);
    case "month":
      // Mês atual: do dia 1 até HOJE (não projeta dias futuros).
      return buildPeriod("month", firstOfMonth(today), today, tz);
    case "prevMonth": {
      const year = Number(today.slice(0, 4));
      const monthIdx0 = Number(today.slice(5, 7)) - 1;
      const prevYear = monthIdx0 === 0 ? year - 1 : year;
      const prevMonth = monthIdx0 === 0 ? 11 : monthIdx0 - 1;
      const start = `${prevYear}-${String(prevMonth + 1).padStart(2, "0")}-01`;
      return buildPeriod("prevMonth", start, lastOfMonth(prevYear, prevMonth), tz);
    }
    case "custom": {
      const startISO = custom?.startISO ?? today;
      const endISO = custom?.endISO ?? today;
      // Garante ordem: início nunca depois do fim.
      const [a, b] = startISO <= endISO ? [startISO, endISO] : [endISO, startISO];
      return buildPeriod("custom", a, b, tz);
    }
  }
}

/**
 * Período imediatamente anterior, de MESMA duração, para comparação. Ex.: um
 * período de 7 dias compara com os 7 dias anteriores; "hoje" compara com ontem.
 */
export function previousPeriod(period: ReportPeriod, tz: string): ReportPeriod {
  const length = period.days.length;
  const prevEnd = addDaysISO(period.startISO, -1);
  const prevStart = addDaysISO(prevEnd, -(length - 1));
  return buildPeriod("custom", prevStart, prevEnd, tz);
}
