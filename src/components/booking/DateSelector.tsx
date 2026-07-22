import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addDaysISO, todayISOInTenantTZ, weekdayOfISO } from "@/lib/tz";

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// Aritmética direto sobre YYYY-MM-DD. A versão anterior criava um `Date`
// ancorado em T12:00:00 LOCAL e voltava com `toISOString()`: a âncora do meio-dia
// só disfarça o problema para fusos dentro de ±12h — e ainda assim mistura o
// relógio do dispositivo numa data de calendário, que não tem fuso nenhum.
function getWeekDays(centerDate: string): string[] {
  const domingo = addDaysISO(centerDate, -weekdayOfISO(centerDate));
  return Array.from({ length: 7 }, (_, i) => addDaysISO(domingo, i));
}

function formatDay(dateStr: string) {
  return {
    weekday: WEEKDAY_SHORT[weekdayOfISO(dateStr)],
    day: Number(dateStr.slice(8, 10)),
    month: MONTH_NAMES[Number(dateStr.slice(5, 7)) - 1],
    year: Number(dateStr.slice(0, 4)),
  };
}

interface DateSelectorProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export function DateSelector({ selectedDate, onDateChange }: DateSelectorProps) {
  const today = todayISOInTenantTZ();
  const weekDays = getWeekDays(selectedDate);
  const { month, year } = formatDay(selectedDate);

  const shiftWeek = (dir: number) => onDateChange(addDaysISO(selectedDate, dir * 7));

  return (
    <div className="space-y-3">
      {/* Month / Year header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={() => shiftWeek(-1)} className="h-8 w-8">
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <h3 className="font-display text-base font-semibold text-foreground">
          {month} {year}
        </h3>
        <Button variant="ghost" size="icon" onClick={() => shiftWeek(1)} className="h-8 w-8">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Day chips — horizontally scrollable on mobile */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none -mx-1 px-1">
        {weekDays.map((dateStr) => {
          const { weekday, day } = formatDay(dateStr);
          const isSelected = dateStr === selectedDate;
          const isPast = dateStr < today;

          return (
            <button
              key={dateStr}
              disabled={isPast}
              onClick={() => onDateChange(dateStr)}
              className={`
                flex flex-col items-center justify-center min-w-[3rem] flex-1 snap-center
                rounded-xl py-2.5 px-1 transition-all text-center
                ${isPast ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
                ${
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-md scale-105"
                    : "bg-card hover:bg-secondary text-foreground"
                }
              `}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider">
                {weekday}
              </span>
              <span className={`text-lg font-display font-bold ${dateStr === today && !isSelected ? "text-primary" : ""}`}>
                {day}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
