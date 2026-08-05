import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { AlertTriangle, Clock, Lock } from "lucide-react";
import { logTechnicalError } from "@/lib/error-reporting";

/**
 * Expediente da barbearia — o envelope que limita a grade de cada profissional.
 *
 * A tabela `business_hours` (migration 20260805170000) guarda UM envelope por
 * dia. Duas semânticas que a tela precisa mostrar sem confundir:
 *
 *   • LINHA AUSENTE = SEM RESTRIÇÃO. Não é "fechado". Enquanto o dia não for
 *     configurado, qualquer turno pessoal é aceito nele — é o que mantém as
 *     barbearias que já existiam funcionando;
 *   • `is_closed` = "não abrimos neste dia", e aí nenhum turno é aceito.
 *
 * Por isso o estado de cada dia tem TRÊS valores possíveis na tela, e não dois:
 * não configurado, aberto (com faixa) e fechado.
 */

const DIAS = [
  { valor: 0, nome: "Domingo", curto: "Dom" },
  { valor: 1, nome: "Segunda-feira", curto: "Seg" },
  { valor: 2, nome: "Terça-feira", curto: "Ter" },
  { valor: 3, nome: "Quarta-feira", curto: "Qua" },
  { valor: 4, nome: "Quinta-feira", curto: "Qui" },
  { valor: 5, nome: "Sexta-feira", curto: "Sex" },
  { valor: 6, nome: "Sábado", curto: "Sáb" },
] as const;

/** SQLSTATE `check_violation` — os triggers desta frente usam esta. */
const CHECK_VIOLATION = "23514";

interface Envelope {
  id: string;
  day_of_week: number;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

/** Turno de outra pessoa que ficaria fora do expediente sendo salvo. */
interface Conflito {
  id: string;
  barber_id: string;
  start_time: string;
  end_time: string;
  nome: string;
}

interface EstadoDoDia {
  configurado: boolean;
  fechado: boolean;
  abre: string;
  fecha: string;
}

function hhmm(valor: string | null | undefined): string {
  return (valor ?? "").slice(0, 5);
}

function estadoInicial(envelope: Envelope | undefined): EstadoDoDia {
  if (!envelope) return { configurado: false, fechado: false, abre: "09:00", fecha: "18:00" };
  return {
    configurado: true,
    fechado: envelope.is_closed,
    abre: hhmm(envelope.open_time) || "09:00",
    fecha: hhmm(envelope.close_time) || "18:00",
  };
}

export function BusinessHoursEditor({
  barbershopId,
  canEdit,
}: {
  barbershopId: string;
  /** Falso para barbeiro: a seção vira leitura, mostrando o limite vigente. */
  canEdit: boolean;
}) {
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [estados, setEstados] = useState<Record<number, EstadoDoDia>>({});
  const [salvando, setSalvando] = useState<number | null>(null);
  /** Conflitos por dia, preenchidos só quando o banco recusa o salvamento. */
  const [conflitos, setConflitos] = useState<Record<number, Conflito[]>>({});
  const [mensagemDeConflito, setMensagemDeConflito] = useState<Record<number, string>>({});

  const carregar = useCallback(async () => {
    setLoading(true);
    setErroCarga(null);

    const { data, error } = await supabase
      .from("business_hours")
      .select("id, day_of_week, open_time, close_time, is_closed")
      .eq("barbershop_id", barbershopId)
      .order("day_of_week", { ascending: true });

    if (error) {
      // Falha de consulta não pode virar "nenhum dia configurado": os dois
      // estados levam a decisões opostas para quem olha.
      logTechnicalError("BusinessHoursEditor", "carregar expediente", error);
      setErroCarga("Não foi possível carregar o horário de funcionamento.");
      setEnvelopes([]);
      setLoading(false);
      return;
    }

    const linhas = (data ?? []) as Envelope[];
    setEnvelopes(linhas);
    const mapa: Record<number, EstadoDoDia> = {};
    for (const dia of DIAS) {
      mapa[dia.valor] = estadoInicial(linhas.find((l) => l.day_of_week === dia.valor));
    }
    setEstados(mapa);
    setConflitos({});
    setMensagemDeConflito({});
    setLoading(false);
  }, [barbershopId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * Turnos ATIVOS daquele dia que ficariam fora do envelope proposto.
   *
   * A lista é CALCULADA por consulta, não extraída da mensagem do trigger. A
   * mensagem é ótima para o usuário ler, e péssima como fonte de dados: é uma
   * frase em português, e depender do formato dela seria depender de prosa.
   */
  const buscarConflitos = useCallback(
    async (dia: number, estado: EstadoDoDia): Promise<Conflito[]> => {
      const { data, error } = await supabase
        .from("weekly_schedule")
        .select("id, barber_id, start_time, end_time")
        .eq("barbershop_id", barbershopId)
        .eq("day_of_week", dia)
        .eq("is_active", true);

      if (error || !data) return [];

      const foraDoEnvelope = data.filter((t) => {
        if (estado.fechado) return true;
        return hhmm(t.start_time) < estado.abre || hhmm(t.end_time) > estado.fecha;
      });
      if (foraDoEnvelope.length === 0) return [];

      // Nome vem da RPC de resumo público — `profiles` é privada desde
      // 20260722240000, e esta tela mostra gente que não é o usuário logado.
      const { fetchProfileSummaries } = await import("@/lib/profile-summaries");
      const resumos = await fetchProfileSummaries(foraDoEnvelope.map((t) => t.barber_id));

      return foraDoEnvelope.map((t) => ({
        id: t.id,
        barber_id: t.barber_id,
        start_time: hhmm(t.start_time),
        end_time: hhmm(t.end_time),
        nome: resumos[t.barber_id]?.full_name?.trim() || "Profissional",
      }));
    },
    [barbershopId],
  );

  const salvar = useCallback(
    async (dia: number, desativarConflitos: boolean) => {
      const estado = estados[dia];
      if (!estado) return;

      if (!estado.fechado && estado.abre >= estado.fecha) {
        toast.error("O horário de abertura precisa ser anterior ao de fechamento.");
        return;
      }

      setSalvando(dia);

      // Sempre pela RPC: ela é a única forma de desativar turno alheio (a
      // policy de UPDATE de weekly_schedule não inclui admin_barbearia) e de
      // fazer as duas coisas numa transação só. Sem `_deactivate_conflicts`
      // ela se comporta como um salvamento comum, com os mesmos triggers.
      // Cast pontual: `apply_business_hours` só entra em `types.ts` quando a
      // migration 20260805180000 for aplicada e os tipos regerados. Mesmo
      // padrão já usado para `barbearias_publicas` antes de ela existir lá.
      const { error } = await (supabase as any).rpc("apply_business_hours", {
        _barbershop_id: barbershopId,
        _day_of_week: dia,
        _open_time: estado.fechado ? null : `${estado.abre}:00`,
        _close_time: estado.fechado ? null : `${estado.fecha}:00`,
        _is_closed: estado.fechado,
        _deactivate_conflicts: desativarConflitos,
      });

      if (error) {
        if (error.code === CHECK_VIOLATION) {
          // A regra de negócio falou. A mensagem do trigger é escrita para ser
          // lida por quem usa — mostrá-la é melhor do que "tente novamente".
          const lista = await buscarConflitos(dia, estado);
          setConflitos((atual) => ({ ...atual, [dia]: lista }));
          setMensagemDeConflito((atual) => ({ ...atual, [dia]: error.message }));
          if (lista.length === 0) toast.error(error.message);
        } else {
          logTechnicalError("BusinessHoursEditor", "salvar expediente", error);
          toast.error("Não foi possível salvar o horário. Tente novamente.");
        }
        setSalvando(null);
        return;
      }

      toast.success(
        desativarConflitos
          ? "Expediente salvo e turnos em conflito desativados."
          : "Horário de funcionamento salvo.",
      );
      setSalvando(null);
      await carregar();
    },
    [barbershopId, estados, buscarConflitos, carregar],
  );

  const limparConflito = (dia: number) => {
    setConflitos((atual) => ({ ...atual, [dia]: [] }));
    setMensagemDeConflito((atual) => ({ ...atual, [dia]: "" }));
  };

  if (loading) {
    return <Skeleton className="h-64 rounded-xl" />;
  }

  if (erroCarga) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="p-4 flex items-center gap-2 text-sm">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
          <span className="text-muted-foreground">{erroCarga}</span>
          <Button variant="ghost" size="sm" onClick={carregar}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const nenhumConfigurado = envelopes.length === 0;

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4 space-y-3">
        {!canEdit && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            Definido pela administração. Sua agenda precisa caber neste horário.
          </p>
        )}

        {nenhumConfigurado && (
          <p className="text-xs text-muted-foreground">
            Nenhum dia configurado. Enquanto assim,{" "}
            <span className="text-foreground">não há limite</span> para os horários da equipe.
          </p>
        )}

        <div className="space-y-2">
          {DIAS.map((dia) => {
            const estado = estados[dia.valor] ?? estadoInicial(undefined);
            const listaDeConflito = conflitos[dia.valor] ?? [];
            const temConflito = listaDeConflito.length > 0;

            return (
              <div key={dia.valor} className="rounded-lg border border-border/60 p-3">
                {/* `flex-wrap` + larguras mínimas: em telas estreitas a linha
                    quebra em vez de estourar o card. A §3 do CLAUDE.md pede
                    fechar a aritmética antes — aqui nada tem largura fixa em
                    px, então não há conta a fechar: cada bloco tem mínimo e o
                    resto flui. */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-sm text-foreground min-w-[7.5rem]">
                    <span className="hidden sm:inline">{dia.nome}</span>
                    <span className="sm:hidden">{dia.curto}</span>
                  </span>

                  {canEdit ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={!estado.fechado}
                        onCheckedChange={(aberto) =>
                          setEstados((atual) => ({
                            ...atual,
                            [dia.valor]: { ...estado, fechado: !aberto, configurado: true },
                          }))
                        }
                        aria-label={`${dia.nome}: aberto ou fechado`}
                      />
                      {estado.fechado ? "Fechado" : "Aberto"}
                    </label>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {!estado.configurado ? "Sem restrição" : estado.fechado ? "Fechado" : "Aberto"}
                    </span>
                  )}

                  {!estado.fechado && estado.configurado && (
                    <div className="flex items-center gap-2">
                      {canEdit ? (
                        <>
                          <Input
                            type="time"
                            value={estado.abre}
                            onChange={(e) =>
                              setEstados((atual) => ({
                                ...atual,
                                [dia.valor]: { ...estado, abre: e.target.value, configurado: true },
                              }))
                            }
                            className="w-[7.5rem] bg-background"
                            aria-label={`${dia.nome}: abertura`}
                          />
                          <span className="text-muted-foreground text-xs">às</span>
                          <Input
                            type="time"
                            value={estado.fecha}
                            onChange={(e) =>
                              setEstados((atual) => ({
                                ...atual,
                                [dia.valor]: { ...estado, fecha: e.target.value, configurado: true },
                              }))
                            }
                            className="w-[7.5rem] bg-background"
                            aria-label={`${dia.nome}: fechamento`}
                          />
                        </>
                      ) : (
                        <span className="text-sm text-foreground flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {estado.abre} às {estado.fecha}
                        </span>
                      )}
                    </div>
                  )}

                  {!estado.configurado && canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEstados((atual) => ({
                          ...atual,
                          [dia.valor]: { ...estado, configurado: true },
                        }))
                      }
                    >
                      Definir horário
                    </Button>
                  )}

                  {canEdit && estado.configurado && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={salvando === dia.valor}
                      onClick={() => salvar(dia.valor, false)}
                      className="ml-auto"
                    >
                      {salvando === dia.valor ? "Salvando..." : "Salvar"}
                    </Button>
                  )}
                </div>

                {/* Conflito: nunca resolve sozinho. Mostra quem fica de fora e
                    exige um segundo clique, deliberado, para desativar. */}
                {temConflito && (
                  <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-xs text-foreground flex items-start gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <span>{mensagemDeConflito[dia.valor]}</span>
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 pl-5">
                      {listaDeConflito.map((c) => (
                        <li key={c.id}>
                          {c.nome} — {c.start_time} às {c.end_time}
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={salvando === dia.valor}
                        onClick={() => salvar(dia.valor, true)}
                      >
                        Desativar esses turnos e salvar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => limparConflito(dia.valor)}>
                        Cancelar
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Os turnos não são apagados — ficam desativados, e cada profissional pode
                      recadastrá-los dentro do novo horário.
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
