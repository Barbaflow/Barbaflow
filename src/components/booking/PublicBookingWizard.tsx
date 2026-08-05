import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { notifyBookingConfirmed } from "@/lib/notifications";
import { DateSelector } from "./DateSelector";
import { TimeSlotGrid } from "./TimeSlotGrid";
import { BookingConfirmation } from "./BookingConfirmation";
import type { AvailabilitySlot, Service } from "./types";
import { nowInTenantTZ, todayISOInTenantTZ } from "@/lib/tz";
import { agendaErrorMessage, isSlotConflict } from "@/lib/agenda-errors";
import { logTechnicalError } from "@/lib/error-reporting";
import {
  Store,
  User,
  Scissors,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  MapPin,
  Search,
  Crown,
  Star,
  ShieldAlert,
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface Barbershop {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  subdomain: string;
  reschedule_min_hours?: number;
  cancel_min_hours?: number;
}

interface BarberWithProfile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  rating_avg?: number;
  rating_count?: number;
  /**
   * Vem calculado pela RPC `get_public_barbers_v2` (migration 20260804120000).
   * Antes a tela comparava `barbershop.owner_id === barbeiro.user_id`, o que
   * obrigava a expor o UUID do dono no caminho público.
   */
  is_owner: boolean;
}

type Step = "barbershop" | "barber" | "service" | "datetime";

interface PublicBookingWizardProps {
  preselectedBarbershopId?: string;
}

export function PublicBookingWizard({ preselectedBarbershopId }: PublicBookingWizardProps = {}) {
  const { user } = useAuth();
  const { barbershop: tenantBarbershop, isDefault } = useBarbershop();

  // Skip barbershop selection if preselected via route param OR tenant context
  const skipBarbershopStep = !!preselectedBarbershopId || (!isDefault && !!tenantBarbershop);

  const [step, setStep] = useState<Step>(skipBarbershopStep ? "barber" : "barbershop");
  const [barbershops, setBarbershops] = useState<Barbershop[]>([]);
  const [selectedBarbershop, setSelectedBarbershop] = useState<Barbershop | null>(
    (!preselectedBarbershopId && skipBarbershopStep) ? tenantBarbershop as unknown as Barbershop : null
  );
  const [barbers, setBarbers] = useState<BarberWithProfile[]>([]);
  /**
   * A consulta das notas falhou. É estado próprio, e não `rating_count = 0`,
   * porque "não deu para carregar" não é "este profissional não tem avaliação"
   * — a segunda é uma afirmação sobre a pessoa, e era o que a tela dizia
   * quando o erro era descartado.
   */
  const [ratingsUnavailable, setRatingsUnavailable] = useState(false);
  const [selectedBarber, setSelectedBarber] = useState<BarberWithProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => todayISOInTenantTZ());
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  // Trava reentrante síncrona. `setBooking(true)` só surte efeito no próximo
  // render, então dois cliques no MESMO tick (duplo clique rápido, tecla Enter
  // repetida, dois disparos de evento) entravam os dois em handleBook e
  // gravavam dois atendimentos. O `disabled` do botão continua valendo para o
  // feedback visual; esta guarda é a que de fato impede a duplicação.
  const bookingRef = useRef(false);
  const [loadingStep, setLoadingStep] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [noshowBlock, setNoshowBlock] = useState<{
    blocked: boolean;
    noshow_count?: number;
    max_count?: number;
    block_days?: number;
    unblock_at?: string | null;
  } | null>(null);

  // Load preselected barbershop by ID (from route param)
  useEffect(() => {
    if (!preselectedBarbershopId) return;
    // Vitrine pública (view), não a tabela larga: o caminho é anônimo.
    (supabase as any)
      .from("barbearias_publicas")
      .select("id, name, logo_url, primary_color, subdomain, reschedule_min_hours, cancel_min_hours")
      .eq("id", preselectedBarbershopId)
      .maybeSingle()
      .then(({ data }: { data: Barbershop | null }) => {
        if (data) setSelectedBarbershop(data);
      });
  }, [preselectedBarbershopId]);

  // Fetch barbershops
  useEffect(() => {
    if (skipBarbershopStep) return;
    setLoadingStep(true);
    // A view já filtra `approved` e exclui `_system`; os filtros continuam
    // aqui como defesa em profundidade, não porque a view possa devolver outra
    // coisa.
    (supabase as any)
      .from("barbearias_publicas")
      .select("id, name, logo_url, primary_color, subdomain, reschedule_min_hours, cancel_min_hours")
      .eq("status", "approved")
      .neq("subdomain", "_system")
      .order("name")
      .then(({ data }: { data: Barbershop[] | null }) => {
        if (data) setBarbershops(data);
        setLoadingStep(false);
      });
  }, [skipBarbershopStep]);

  // Fetch barbers when barbershop selected
  useEffect(() => {
    if (!selectedBarbershop) return;
    setLoadingStep(true);
    // RPC SECURITY DEFINER: o visitante anônimo lista os profissionais de uma
    // barbearia aprovada. A v2 (migration 20260804120000) devolve `is_owner`
    // calculado no servidor, evitando expor `owner_id` no caminho público.
    (supabase as any)
      .rpc("get_public_barbers_v2", { _barbershop_id: selectedBarbershop.id })
      .then(async ({ data: roles }: { data: Array<{ user_id: string; is_owner: boolean }> | null }) => {
        const ownerFlag = new Map<string, boolean>(
          (roles || []).map((r) => [r.user_id, Boolean(r.is_owner)]),
        );
        const userIds = Array.from(ownerFlag.keys());
        if (userIds.length === 0) {
          setBarbers([]);
          setLoadingStep(false);
          return;
        }
        // Use SECURITY DEFINER RPC to fetch real names (falls back to auth email local-part)
        const { data: names } = await supabase
          .rpc("get_barber_display_names", { _user_ids: userIds });

        // Nota por profissional, agregada no servidor.
        //
        // Antes isto era `.from("reviews").select("rating, appointments!inner(barber_id)")`,
        // e não funcionava para ninguém que importasse: `anon` nunca teve SELECT
        // em `appointments` (42501), e para o cliente logado a RLS da tabela só
        // libera os agendamentos DELE — o `!inner` descartava o resto e a média
        // exibida vinha só das avaliações do próprio visitante. A RPC
        // (migration 20260805140000) devolve o agregado pronto e igual para
        // todo mundo, sem expor nada de `appointments`.
        const { data: ratingRows, error: ratingError } = await (supabase as any).rpc(
          "get_public_barber_ratings",
          { _barbershop_id: selectedBarbershop.id },
        );

        // "Não carregou" e "não tem avaliação" são estados diferentes e
        // renderizam diferente (§8 do CLAUDE.md). Antes o erro era descartado e
        // a falha virava "Sem avaliações" — uma afirmação falsa sobre o
        // profissional. A lista de barbeiros continua sendo montada: a nota é
        // complemento, não pode derrubar o passo de escolha.
        if (ratingError) {
          logTechnicalError("PublicBookingWizard", "carregar notas dos profissionais", ratingError);
        }
        setRatingsUnavailable(Boolean(ratingError));

        const ratingMap = new Map<string, { avg: number; count: number }>();
        (
          (ratingRows ?? []) as Array<{
            barber_id: string;
            rating_avg: number | string;
            rating_count: number;
          }>
        ).forEach((r) => {
          if (!r.barber_id) return;
          ratingMap.set(r.barber_id, {
            // `numeric` do Postgres chega como string no supabase-js.
            avg: Number(r.rating_avg),
            count: Number(r.rating_count),
          });
        });

        // Map names from RPC, with safe fallback per id
        const nameMap = new Map(
          (names as Array<{ user_id: string; display_name: string; avatar_url: string | null }> | null ?? [])
            .map((n) => [n.user_id, n])
        );
        const barberList: BarberWithProfile[] = userIds.map((id) => {
          const n = nameMap.get(id);
          const r = ratingMap.get(id);
          return {
            user_id: id,
            full_name: n?.display_name ?? null,
            avatar_url: n?.avatar_url ?? null,
            rating_avg: r?.avg ?? 0,
            rating_count: r?.count ?? 0,
            is_owner: ownerFlag.get(id) ?? false,
          };
        });
        setBarbers(barberList);
        setLoadingStep(false);
      });
  }, [selectedBarbershop]);

  // Fetch services when barber selected
  useEffect(() => {
    if (!selectedBarbershop || !selectedBarber) return;
    setLoadingStep(true);
    supabase
      .from("services")
      .select("id, name, duration_minutes, price, barber_id")
      .eq("barbershop_id", selectedBarbershop.id)
      .eq("barber_id", selectedBarber.user_id)
      .eq("active", true)
      .then(({ data }) => {
        if (data) setServices(data);
        setLoadingStep(false);
      });
  }, [selectedBarbershop, selectedBarber]);

  // Helper: convert "HH:MM[:SS]" to minutes
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };

  const fmtTime = (mins: number) => {
    const h = Math.floor(mins / 60).toString().padStart(2, "0");
    const m = (mins % 60).toString().padStart(2, "0");
    return `${h}:${m}:00`;
  };

  // Fetch availability windows + existing appointments, then slice each window
  // into discrete slots of `service.duration_minutes`. A slot is "ocupado" if it
  // overlaps an existing appointment, falls outside any "livre" window, is in the
  // past, or lies inside a window that the barber/admin marked as ocupado/folga.
  const fetchAvailability = useCallback(async () => {
    if (!selectedBarbershop || !selectedBarber || !selectedService) return;
    setLoadingSlots(true);

    // Os intervalos ocupados vêm por RPC, não por SELECT em `appointments`:
    // a tabela é fechada para anônimo (`permission denied`), e o erro era
    // engolido aqui — visitante sem login via TODOS os horários como livres,
    // inclusive os já reservados. A RPC devolve só início e fim, sem nenhum
    // dado de cliente. Ver migration 20260722190000.
    const [
      { data: windowRows, error: windowsError },
      { data: busyRows, error: busyError },
    ] = await Promise.all([
      // As janelas vêm da grade semanal (menos os bloqueios do dia), somadas às
      // exceções lançadas na agenda. Antes isto lia a tabela `availability`,
      // que só existe depois de alguém clicar em "Gerar Agenda": uma barbearia
      // recém-configurada tinha a agenda interna funcionando e a página pública
      // mostrando zero horários. Ver migration 20260722210000.
      supabase.rpc("get_public_availability_windows", {
        _barbershop_id: selectedBarbershop.id,
        _barber_id: selectedBarber.user_id,
        _date: selectedDate,
      }),
      supabase.rpc("get_public_busy_intervals", {
        _barbershop_id: selectedBarbershop.id,
        _barber_id: selectedBarber.user_id,
        _date: selectedDate,
      }),
    ]);

    // Falha em qualquer uma das duas não pode virar "tudo livre": sem saber as
    // janelas ou os ocupados, a grade mentiria. Mostramos o erro e nenhum
    // horário selecionável.
    if (windowsError || busyError) {
      setSlotsError("Não foi possível carregar os horários. Tente novamente.");
      setAvailability([]);
      setLoadingSlots(false);
      return;
    }
    setSlotsError(null);

    const windows = (windowRows ?? []) as Array<{
      start_time: string;
      end_time: string;
      status: string;
    }>;
    const bookings = (busyRows ?? []) as Array<{ start_time: string; end_time: string }>;
    const duration = selectedService.duration_minutes;

    const busy = bookings.map((b) => ({ s: toMin(b.start_time), e: toMin(b.end_time) }));
    const blocks = windows
      .filter((w) => w.status !== "livre")
      .map((w) => ({ s: toMin(w.start_time), e: toMin(w.end_time) }));
    const freeWindows = windows.filter((w) => w.status === "livre");

    // "Agora" no fuso do tenant — para que clientes em outro fuso (ou com relógio errado)
    // ainda vejam slots passados como ocupados consistentemente com o resto do app.
    const { iso: todayISO, minutes: nowMin } = nowInTenantTZ();
    const isToday = selectedDate === todayISO;

    // Build distinct discrete slots from every "livre" window
    const seen = new Set<number>();
    const generated: AvailabilitySlot[] = [];

    for (const win of freeWindows) {
      const winStart = toMin(win.start_time);
      const winEnd = toMin(win.end_time);
      // step = service duration ensures we don't offer impossible mid-times
      for (let t = winStart; t + duration <= winEnd; t += duration) {
        if (seen.has(t)) continue;
        seen.add(t);

        const slotEnd = t + duration;
        const isPast = isToday && t < nowMin;
        const conflictsAppt = busy.some((b) => t < b.e && slotEnd > b.s);
        const conflictsBlock = blocks.some((b) => t < b.e && slotEnd > b.s);

        generated.push({
          // Id sintético estável por fetch: as janelas agora são derivadas e não
          // têm id próprio, então a chave é o intervalo da janela + o offset.
          id: `${win.start_time}-${win.end_time}-${t}`,
          barber_id: selectedBarber.user_id,
          date: selectedDate,
          start_time: fmtTime(t),
          end_time: fmtTime(slotEnd),
          status: isPast || conflictsAppt || conflictsBlock ? "ocupado" : "livre",
        });
      }
    }

    generated.sort((a, b) => toMin(a.start_time) - toMin(b.start_time));
    setAvailability(generated);
    setLoadingSlots(false);
  }, [selectedBarbershop, selectedBarber, selectedDate, selectedService]);

  useEffect(() => {
    if (step === "datetime") {
      fetchAvailability();
    }
  }, [step, fetchAvailability]);

  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate]);

  // Check no-show block when client + barbershop are known
  useEffect(() => {
    if (!user || !selectedBarbershop) {
      setNoshowBlock(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("check_client_noshow_block", {
        _client_id: user.id,
        _barbershop_id: selectedBarbershop.id,
      })
      .then(({ data, error: err }) => {
        if (cancelled || err || !data) return;
        setNoshowBlock(data as typeof noshowBlock);
      });
    return () => {
      cancelled = true;
    };
  }, [user, selectedBarbershop]);

  const handleSelectBarbershop = (bs: Barbershop) => {
    setSelectedBarbershop(bs);
    setSelectedBarber(null);
    setSelectedService(null);
    setSelectedSlot(null);
    setStep("barber");
  };

  const handleSelectBarber = (b: BarberWithProfile) => {
    setSelectedBarber(b);
    setSelectedService(null);
    setSelectedSlot(null);
    setStep("service");
  };

  const handleSelectService = (s: Service) => {
    setSelectedService(s);
    setSelectedSlot(null);
    setStep("datetime");
  };

  const handleBook = async () => {
    if (!selectedSlot || !selectedService || !user || !selectedBarbershop) return;
    if (bookingRef.current) return;
    bookingRef.current = true;
    setBooking(true);

    const startMin = toMin(selectedSlot.start_time);
    const endMin = startMin + selectedService.duration_minutes;
    const endTime = `${Math.floor(endMin / 60).toString().padStart(2, "0")}:${(endMin % 60).toString().padStart(2, "0")}:00`;

    const { error } = await supabase.from("appointments").insert({
      barbershop_id: selectedBarbershop.id,
      client_id: user.id,
      barber_id: selectedSlot.barber_id,
      service_id: selectedService.id,
      date: selectedSlot.date,
      start_time: selectedSlot.start_time,
      end_time: endTime,
    });

    if (error) {
      // Conflito é o caso esperado numa disputa de horário: a constraint
      // `appointments_no_overlap_per_barber` recusa o perdedor. Explicamos o
      // que houve e recarregamos a grade, em vez de "erro ao agendar".
      const { title, description } = agendaErrorMessage(error, "Erro ao agendar. Tente novamente.");
      toast.error(title, { description });
      if (isSlotConflict(error)) {
        setSelectedSlot(null);
        fetchAvailability();
      }
    } else {
      toast.success("Agendamento confirmado! 🎉");
      notifyBookingConfirmed({
        appointmentId: crypto.randomUUID(),
        serviceName: selectedService.name,
        date: selectedSlot.date,
        startTime: selectedSlot.start_time,
      }).catch(console.error);

      setSelectedSlot(null);
      // Refetch will recompute slot statuses by overlapping with the new appointment
      fetchAvailability();
    }
    bookingRef.current = false;
    setBooking(false);
  };

  const goBack = () => {
    if (step === "datetime") setStep("service");
    else if (step === "service") setStep("barber");
    else if (step === "barber" && !skipBarbershopStep) setStep("barbershop");
  };

  const STEPS: { key: Step; label: string }[] = skipBarbershopStep
    ? [
        { key: "barber", label: "Barbeiro" },
        { key: "service", label: "Serviço" },
        { key: "datetime", label: "Horário" },
      ]
    : [
        { key: "barbershop", label: "Barbearia" },
        { key: "barber", label: "Barbeiro" },
        { key: "service", label: "Serviço" },
        { key: "datetime", label: "Horário" },
      ];

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="space-y-6">
      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
            <button
              disabled={i > stepIndex}
              onClick={() => i < stepIndex && setStep(s.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                i === stepIndex
                  ? "bg-primary text-primary-foreground"
                  : i < stepIndex
                    ? "bg-primary/20 text-primary cursor-pointer hover:bg-primary/30"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <span className="font-bold">{i + 1}</span>
              {s.label}
            </button>
            {i < STEPS.length - 1 && (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            )}
          </div>
        ))}
      </div>

      {/* Back button */}
      {stepIndex > 0 && (
        <Button variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Button>
      )}

      {/* Step: Barbershop */}
      {step === "barbershop" && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Escolha a Barbearia</h2>

          {/* Search */}
          {!loadingStep && barbershops.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-card border-border"
              />
            </div>
          )}

          {loadingStep ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : (() => {
            const filtered = barbershops.filter((bs) =>
              bs.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              bs.subdomain.toLowerCase().includes(searchQuery.toLowerCase())
            );
            return filtered.length === 0 ? (
              <p className="text-muted-foreground text-sm py-10 text-center">
                {searchQuery ? "Nenhuma barbearia encontrada." : "Nenhuma barbearia disponível."}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filtered.map((bs) => (
                  <Card
                    key={bs.id}
                    className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group"
                    onClick={() => handleSelectBarbershop(bs)}
                  >
                    <CardContent className="p-4 flex items-center gap-4">
                      {bs.logo_url ? (
                        <img
                          src={bs.logo_url}
                          alt={bs.name}
                          className="h-14 w-14 rounded-xl object-cover flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="h-14 w-14 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: bs.primary_color + "22" }}
                        >
                          <Store className="w-6 h-6" style={{ color: bs.primary_color }} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors">
                          {bs.name}
                        </h3>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {bs.subdomain}
                        </p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Step: Barber */}
      {step === "barber" && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Escolha o Barbeiro</h2>
          {loadingStep ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : barbers.length === 0 ? (
            <p className="text-muted-foreground text-sm py-10 text-center">Nenhum barbeiro disponível.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {barbers
                .slice()
                .sort((a, b) => {
                  // A RPC já devolve o proprietário primeiro; a ordenação fica
                  // como garantia local, agora sobre o booleano do servidor.
                  const aOwner = a.is_owner ? 0 : 1;
                  const bOwner = b.is_owner ? 0 : 1;
                  return aOwner - bOwner;
                })
                .map((b) => {
                  const isOwner = b.is_owner;
                  const displayName = b.full_name || `Barbeiro ${b.user_id.slice(0, 6)}`;
                  return (
                    <Card
                      key={b.user_id}
                      className="bg-card border-border hover:border-primary/60 hover:shadow-lg transition-all cursor-pointer group relative overflow-hidden"
                      onClick={() => handleSelectBarber(b)}
                    >
                      {isOwner && (
                        <div className="absolute top-2 right-2 z-10">
                          <Badge className="bg-primary text-primary-foreground text-[10px] px-2 py-0.5 h-5 shadow-md flex items-center gap-1">
                            <Crown className="w-2.5 h-2.5" />
                            Proprietário
                          </Badge>
                        </div>
                      )}
                      <CardContent className="p-4 flex flex-col items-center text-center gap-3">
                        <div className="relative">
                          {b.avatar_url ? (
                            <img
                              src={b.avatar_url}
                              alt={displayName}
                              className={`h-20 w-20 rounded-full object-cover ${
                                isOwner ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""
                              }`}
                            />
                          ) : (
                            <div
                              className={`h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center ${
                                isOwner ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""
                              }`}
                            >
                              <User className="w-8 h-8 text-primary" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 w-full">
                          <h3 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors text-sm leading-tight truncate">
                            {displayName}
                          </h3>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {isOwner ? "Dono & Barbeiro" : "Profissional"}
                          </p>
                          <div className="flex items-center justify-center gap-1 mt-1.5 h-4">
                            {ratingsUnavailable ? (
                              // Nem "tem nota" nem "não tem": não foi possível
                              // saber. Dizer "Sem avaliações" aqui seria afirmar
                              // algo falso sobre o profissional.
                              <span className="text-[10px] text-muted-foreground italic">
                                Avaliações indisponíveis
                              </span>
                            ) : b.rating_count && b.rating_count > 0 ? (
                              <>
                                <Star className="w-3 h-3 fill-primary text-primary" />
                                <span className="text-[11px] font-semibold text-foreground">
                                  {b.rating_avg?.toFixed(1)}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  ({b.rating_count})
                                </span>
                              </>
                            ) : (
                              <span className="text-[10px] text-muted-foreground italic">
                                Sem avaliações
                              </span>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* Step: Service */}
      {step === "service" && (
        <div className="space-y-3">
          <h2 className="font-display text-lg font-semibold text-foreground">Escolha o Serviço</h2>
          {loadingStep ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : services.length === 0 ? (
            <p className="text-muted-foreground text-sm py-10 text-center">Nenhum serviço disponível para este barbeiro.</p>
          ) : (
            <div className="space-y-2">
              {services.map((s) => (
                <Card
                  key={s.id}
                  className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group"
                  onClick={() => handleSelectService(s)}
                >
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Scissors className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-medium text-foreground group-hover:text-primary transition-colors">
                          {s.name}
                        </h3>
                        <p className="text-xs text-muted-foreground">{s.duration_minutes} min</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="font-display font-semibold">
                        R$ {Number(s.price).toFixed(2)}
                      </Badge>
                      <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step: Date & Time */}
      {step === "datetime" && (
        <div className="space-y-5">
          <h2 className="font-display text-lg font-semibold text-foreground">Escolha Data e Horário</h2>

          {/* Summary chips */}
          <div className="flex flex-wrap gap-2">
            {selectedBarbershop && (
              <Badge variant="outline" className="text-xs">
                <Store className="w-3 h-3 mr-1" />
                {selectedBarbershop.name}
              </Badge>
            )}
            {selectedBarber && (
              <Badge variant="outline" className="text-xs">
                <User className="w-3 h-3 mr-1" />
                {selectedBarber.full_name || `Barbeiro ${selectedBarber.user_id.slice(0, 6)}`}
              </Badge>
            )}
            {selectedService && (
              <Badge variant="outline" className="text-xs">
                <Scissors className="w-3 h-3 mr-1" />
                {selectedService.name} — R$ {Number(selectedService.price).toFixed(2)}
              </Badge>
            )}
          </div>

          {noshowBlock?.blocked && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1 text-sm">
                <p className="font-semibold text-destructive">
                  Agendamento online temporariamente bloqueado
                </p>
                <p className="text-foreground/80 leading-relaxed">
                  Você acumulou {noshowBlock.noshow_count} {noshowBlock.noshow_count === 1 ? "falta" : "faltas"} nos últimos 30 dias
                  nesta barbearia. Por isso, novos agendamentos por aqui estão pausados
                  {noshowBlock.unblock_at && (
                    <> até <strong>{new Date(noshowBlock.unblock_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</strong></>
                  )}.
                </p>
                <p className="text-muted-foreground text-xs pt-1">
                  Entre em contato direto com a barbearia se quiser remarcar — eles podem encaixar você manualmente.
                </p>
              </div>
            </div>
          )}

          <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />

          <TimeSlotGrid
            slots={availability}
            selectedSlotId={selectedSlot?.id ?? null}
            onSelect={setSelectedSlot}
            loading={loadingSlots}
            error={slotsError}
          />

          {selectedSlot && selectedService && !noshowBlock?.blocked && (
            <BookingConfirmation
              slot={selectedSlot}
              service={selectedService}
              isLoggedIn={!!user}
              booking={booking}
              onConfirm={handleBook}
              onCancel={() => setSelectedSlot(null)}
              rescheduleMinHours={selectedBarbershop?.reschedule_min_hours ?? 2}
              cancelMinHours={selectedBarbershop?.cancel_min_hours ?? 2}
            />
          )}

          {selectedSlot && selectedService && !noshowBlock?.blocked && (
            <div className="h-36 md:hidden" />
          )}
        </div>
      )}
    </div>
  );
}
