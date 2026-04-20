import { CalendarClock, XCircle, ShieldAlert } from "lucide-react";

function formatHours(h: number) {
  if (h <= 0) return "sem limite";
  if (h >= 24 && h % 24 === 0) {
    const d = h / 24;
    return d === 1 ? "1 dia" : `${d} dias`;
  }
  return `${h}h`;
}

interface PoliciesBannerProps {
  rescheduleMinHours: number;
  cancelMinHours: number;
  noshowEnabled?: boolean;
  noshowMaxCount?: number;
  noshowBlockDays?: number;
}

export function PoliciesBanner({
  rescheduleMinHours,
  cancelMinHours,
  noshowEnabled,
  noshowMaxCount,
  noshowBlockDays,
}: PoliciesBannerProps) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-card/60 backdrop-blur-sm p-4">
      <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-body mb-3">
        Políticas da barbearia
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div className="flex items-start gap-2.5">
          <CalendarClock className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="leading-snug">
            <div className="text-foreground font-medium">Reagendamento</div>
            <div className="text-muted-foreground text-xs">
              até <span className="text-foreground">{formatHours(rescheduleMinHours)}</span>
              {rescheduleMinHours > 0 && " antes do horário"}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <XCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
          <div className="leading-snug">
            <div className="text-foreground font-medium">Cancelamento</div>
            <div className="text-muted-foreground text-xs">
              até <span className="text-foreground">{formatHours(cancelMinHours)}</span>
              {cancelMinHours > 0 && " antes do horário"}
            </div>
          </div>
        </div>
        {noshowEnabled && noshowMaxCount && noshowBlockDays ? (
          <div className="flex items-start gap-2.5 sm:col-span-2 pt-2 border-t border-border/50">
            <ShieldAlert className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="leading-snug">
              <div className="text-foreground font-medium">Política de no-show</div>
              <div className="text-muted-foreground text-xs">
                {noshowMaxCount} {noshowMaxCount === 1 ? "falta" : "faltas"} em 30 dias bloqueia novos
                agendamentos por <span className="text-foreground">{noshowBlockDays} {noshowBlockDays === 1 ? "dia" : "dias"}</span>.
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
