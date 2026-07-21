/**
 * Seleção determinística de horários livres para os harnesses.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * Os harnesses pegavam o PRIMEIRO slot livre ordenado por data/hora. Como as
 * fixtures geram disponibilidade a partir de HOJE, esse primeiro slot é o
 * início do expediente de hoje (08:00). A partir das 08:00 no fuso do tenant,
 * a regra legítima do produto
 *
 *     "Não é possível agendar em um horário que já passou."
 *
 * passava a rejeitar o agendamento e o harness falhava — não por regressão,
 * mas pela hora em que foi executado.
 *
 * SOLUÇÃO
 * -------
 * O harness passa a escolher um slot ESTRITAMENTE FUTURO, com margem. A regra
 * do produto continua intacta: nada é afastado, relaxado ou stubado — o teste
 * é que deixa de escolher um horário inválido de propósito.
 *
 * O relógio usado aqui é exatamente o mesmo de `validateAppointment`
 * (`nowInTenantTZ()` de `@/lib/tz`, que respeita o fuso ativo do tenant), então
 * a seleção acompanha qualquer timezone configurado, sem sleep e sem depender
 * da hora do dia. As fixtures cobrem 21 dias à frente, então sempre existe
 * slot futuro suficiente.
 */
import { nowInTenantTZ, timeToMinutes } from "@/lib/tz";

type SlotRow = Record<string, unknown>;

/** Margem mínima entre "agora" e o início do slot escolhido. */
export const SLOT_FUTURE_MARGIN_MINUTES = 30;

/**
 * `true` se o slot começa pelo menos `margin` minutos depois de agora, no fuso
 * do tenant. Slots de hoje já iniciados (ou prestes a iniciar) são descartados.
 */
export function isSlotSafelyInFuture(
  slot: SlotRow,
  margin: number = SLOT_FUTURE_MARGIN_MINUTES,
): boolean {
  const date = typeof slot.date === "string" ? slot.date : null;
  const start = typeof slot.start_time === "string" ? slot.start_time : null;
  if (!date || !start) return false;

  const now = nowInTenantTZ();
  if (date > now.iso) return true;
  if (date < now.iso) return false;
  return timeToMinutes(start) >= now.minutes + margin;
}

/**
 * Primeiros `count` slots futuros DISTINTOS (por data + hora de início),
 * preservando a ordem recebida. Devolve menos que `count` apenas se as
 * fixtures realmente não tiverem horários suficientes — caso em que o harness
 * deve falhar de forma visível, e não silenciosamente pular o cenário.
 */
export function pickFutureFreeSlots(
  slots: readonly SlotRow[],
  count: number,
  margin: number = SLOT_FUTURE_MARGIN_MINUTES,
): SlotRow[] {
  const seen = new Set<string>();
  const picked: SlotRow[] = [];

  for (const slot of slots) {
    if (!isSlotSafelyInFuture(slot, margin)) continue;
    const key = `${String(slot.date)} ${String(slot.start_time)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(slot);
    if (picked.length === count) break;
  }

  return picked;
}
