import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { logTechnicalError } from "@/lib/error-reporting";

/**
 * Horário de funcionamento na página pública de agendamento.
 *
 * Lê por `get_public_business_hours` (migration 20260805190000), nunca pela
 * tabela: `business_hours` não tem grant para `anon`, de propósito.
 *
 * TRÊS ESTADOS, e confundi-los é o erro fácil aqui:
 *
 *   • nenhum dia configurado → NÃO renderiza nada. É o comportamento de hoje,
 *     antes desta frente existir: a barbearia não passa a exibir informação
 *     que nunca teve;
 *   • dia ausente da resposta → "sem restrição cadastrada". Some da lista, e
 *     NÃO vira "Fechado" — dizer "fechado" sobre um dia não configurado seria
 *     afirmar algo falso sobre o negócio de alguém;
 *   • `is_closed` → "Fechado", este sim afirmado pelo dono.
 *
 * Falha de consulta também não renderiza: a alternativa seria mostrar um
 * expediente incompleto, e horário errado numa página de agendamento é pior do
 * que horário nenhum.
 */

const DIAS = [
  { valor: 0, nome: "Domingo" },
  { valor: 1, nome: "Segunda" },
  { valor: 2, nome: "Terça" },
  { valor: 3, nome: "Quarta" },
  { valor: 4, nome: "Quinta" },
  { valor: 5, nome: "Sexta" },
  { valor: 6, nome: "Sábado" },
] as const;

interface DiaPublico {
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

function hhmm(valor: string | null): string {
  return (valor ?? "").slice(0, 5);
}

export function BusinessHoursPublic({ barbershopId }: { barbershopId: string }) {
  const [dias, setDias] = useState<DiaPublico[]>([]);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      // Cast pontual: a RPC só entra em `types.ts` quando 20260805190000 for
      // aplicada e os tipos regerados — mesmo padrão já usado nesta base.
      const { data, error } = await (supabase as any).rpc("get_public_business_hours", {
        _barbershop_id: barbershopId,
      });
      if (cancelado) return;

      if (error) {
        logTechnicalError("BusinessHoursPublic", "carregar horário de funcionamento", error);
        setDias([]);
        setPronto(true);
        return;
      }

      setDias((data ?? []) as DiaPublico[]);
      setPronto(true);
    })();

    return () => {
      cancelado = true;
    };
  }, [barbershopId]);

  // Enquanto carrega, nada: um esqueleto aqui piscaria acima do assistente sem
  // ganho nenhum, e na maioria das barbearias a resposta é vazia mesmo.
  if (!pronto || dias.length === 0) return null;

  const porDia = new Map(dias.map((d) => [d.day_of_week, d]));

  return (
    <Card className="bg-card border-border mb-6">
      <CardContent className="p-4">
        <h2 className="text-sm font-medium text-foreground flex items-center gap-1.5 mb-3">
          <Clock className="w-4 h-4 text-primary" />
          Horário de funcionamento
        </h2>

        {/* `grid` de duas colunas em telas estreitas e três a partir de `sm`:
            sete linhas de texto curto não precisam de mais, e nada aqui tem
            largura fixa em px — o conteúdo mais longo é "Segunda 09:00–18:00". */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
          {DIAS.map((dia) => {
            const info = porDia.get(dia.valor);
            // Dia não configurado não aparece: ausência não é fechamento.
            if (!info) return null;

            return (
              <div key={dia.valor} className="flex items-baseline justify-between gap-2 min-w-0">
                <dt className="text-xs text-muted-foreground shrink-0">{dia.nome}</dt>
                <dd className="text-xs text-foreground truncate">
                  {info.is_closed ? (
                    <span className="text-muted-foreground">Fechado</span>
                  ) : (
                    `${hhmm(info.open_time)}–${hhmm(info.close_time)}`
                  )}
                </dd>
              </div>
            );
          })}
        </dl>

        <p className="text-[11px] text-muted-foreground mt-3">
          Os horários de cada profissional aparecem ao escolher quem vai atender.
        </p>
      </CardContent>
    </Card>
  );
}
