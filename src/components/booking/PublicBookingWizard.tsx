import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Input } from "@/components/ui/input";

interface Barbershop {
  id: string;
  name: string;
  logo_url: string | null;
  primary_color: string;
  subdomain: string;
  owner_id: string | null;
}

interface BarberWithProfile {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  rating_avg?: number;
  rating_count?: number;
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
  const [selectedBarber, setSelectedBarber] = useState<BarberWithProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState(false);
  const [loadingStep, setLoadingStep] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Load preselected barbershop by ID (from route param)
  useEffect(() => {
    if (!preselectedBarbershopId) return;
    supabase
      .from("barbershops")
      .select("id, name, logo_url, primary_color, subdomain, owner_id")
      .eq("id", preselectedBarbershopId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSelectedBarbershop(data);
      });
  }, [preselectedBarbershopId]);

  // Fetch barbershops
  useEffect(() => {
    if (skipBarbershopStep) return;
    setLoadingStep(true);
    supabase
      .from("barbershops")
      .select("id, name, logo_url, primary_color, subdomain, owner_id")
      .eq("status", "approved")
      .neq("subdomain", "_system")
      .order("name")
      .then(({ data }) => {
        if (data) setBarbershops(data);
        setLoadingStep(false);
      });
  }, [skipBarbershopStep]);

  // Fetch barbers when barbershop selected
  useEffect(() => {
    if (!selectedBarbershop) return;
    setLoadingStep(true);
    // Use SECURITY DEFINER RPC so anonymous visitors can list barbers of approved shops
    supabase
      .rpc("get_public_barbers", { _barbershop_id: selectedBarbershop.id })
      .then(async ({ data: roles }) => {
        const userIds = Array.from(new Set((roles || []).map((r: { user_id: string }) => r.user_id)));
        if (userIds.length === 0) {
          setBarbers([]);
          setLoadingStep(false);
          return;
        }
        // Use SECURITY DEFINER RPC to fetch real names (falls back to auth email local-part)
        const { data: names } = await supabase
          .rpc("get_barber_display_names", { _user_ids: userIds });

        // Fetch reviews joined with appointments to compute per-barber ratings
        const { data: reviewRows } = await supabase
          .from("reviews")
          .select("rating, appointments!inner(barber_id)")
          .eq("barbershop_id", selectedBarbershop.id)
          .in("appointments.barber_id", userIds);

        const ratingMap = new Map<string, { sum: number; count: number }>();
        (reviewRows as unknown as Array<{ rating: number; appointments: { barber_id: string } | null }>)?.forEach((r) => {
          const bid = r.appointments?.barber_id;
          if (!bid) return;
          const cur = ratingMap.get(bid) ?? { sum: 0, count: 0 };
          cur.sum += r.rating;
          cur.count += 1;
          ratingMap.set(bid, cur);
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
            rating_avg: r ? Math.round((r.sum / r.count) * 10) / 10 : 0,
            rating_count: r?.count ?? 0,
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

    const [{ data: slots }, { data: appts }] = await Promise.all([
      supabase
        .from("availability")
        .select("*")
        .eq("barbershop_id", selectedBarbershop.id)
        .eq("barber_id", selectedBarber.user_id)
        .eq("date", selectedDate)
        .order("start_time", { ascending: true }),
      supabase
        .from("appointments")
        .select("start_time, end_time, status")
        .eq("barbershop_id", selectedBarbershop.id)
        .eq("barber_id", selectedBarber.user_id)
        .eq("date", selectedDate)
        .neq("status", "cancelled"),
    ]);

    const windows = (slots ?? []) as AvailabilitySlot[];
    const bookings = (appts ?? []) as Array<{ start_time: string; end_time: string }>;
    const duration = selectedService.duration_minutes;

    const busy = bookings.map((b) => ({ s: toMin(b.start_time), e: toMin(b.end_time) }));
    const blocks = windows
      .filter((w) => w.status !== "livre")
      .map((w) => ({ s: toMin(w.start_time), e: toMin(w.end_time) }));
    const freeWindows = windows.filter((w) => w.status === "livre");

    const now = new Date();
    const isToday = selectedDate === now.toISOString().split("T")[0];
    const nowMin = now.getHours() * 60 + now.getMinutes();

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
          // Synthetic id keyed by window+offset so React keys stay stable per fetch
          id: `${win.id}-${t}`,
          barber_id: win.barber_id,
          date: win.date,
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
      toast.error("Erro ao agendar. Tente novamente.");
    } else {
      // Mark every availability slot covered by the appointment as ocupado
      const slotIdsToOccupy = availability
        .filter((s) => {
          const sStart = toMin(s.start_time);
          const sEnd = toMin(s.end_time);
          return sStart < endMin && sEnd > startMin;
        })
        .map((s) => s.id);

      if (slotIdsToOccupy.length > 0) {
        await supabase
          .from("availability")
          .update({ status: "ocupado" })
          .in("id", slotIdsToOccupy);
      }

      toast.success("Agendamento confirmado! 🎉");
      notifyBookingConfirmed({
        appointmentId: crypto.randomUUID(),
        serviceName: selectedService.name,
        date: selectedSlot.date,
        startTime: selectedSlot.start_time,
      }).catch(console.error);

      setSelectedSlot(null);
      fetchAvailability();
    }
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
                  const aOwner = selectedBarbershop?.owner_id === a.user_id ? 0 : 1;
                  const bOwner = selectedBarbershop?.owner_id === b.user_id ? 0 : 1;
                  return aOwner - bOwner;
                })
                .map((b) => {
                  const isOwner = selectedBarbershop?.owner_id === b.user_id;
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
                            {b.rating_count && b.rating_count > 0 ? (
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

          <DateSelector selectedDate={selectedDate} onDateChange={setSelectedDate} />

          <TimeSlotGrid
            slots={availability}
            selectedSlotId={selectedSlot?.id ?? null}
            onSelect={setSelectedSlot}
            loading={loadingSlots}
            error={null}
          />

          {selectedSlot && selectedService && (
            <BookingConfirmation
              slot={selectedSlot}
              service={selectedService}
              isLoggedIn={!!user}
              booking={booking}
              onConfirm={handleBook}
              onCancel={() => setSelectedSlot(null)}
            />
          )}

          {selectedSlot && selectedService && (
            <div className="h-36 md:hidden" />
          )}
        </div>
      )}
    </div>
  );
}
