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
    supabase
      .from("user_roles")
      .select("user_id")
      .eq("barbershop_id", selectedBarbershop.id)
      .in("role", ["barbeiro", "admin_barbearia"])
      .then(async ({ data: roles }) => {
        // Dedupe user_ids (a user can have both 'barbeiro' and 'admin_barbearia' roles)
        const userIds = Array.from(new Set((roles || []).map((r) => r.user_id)));
        if (userIds.length === 0) {
          setBarbers([]);
          setLoadingStep(false);
          return;
        }
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, avatar_url")
          .in("user_id", userIds);
        // Ensure every user_id has an entry, even if profile is missing
        const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
        const barberList: BarberWithProfile[] = userIds.map(
          (id) => profileMap.get(id) ?? { user_id: id, full_name: null, avatar_url: null }
        );
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

  // Fetch availability
  const fetchAvailability = useCallback(async () => {
    if (!selectedBarbershop || !selectedBarber) return;
    setLoadingSlots(true);
    const { data } = await supabase
      .from("availability")
      .select("*")
      .eq("barbershop_id", selectedBarbershop.id)
      .eq("barber_id", selectedBarber.user_id)
      .eq("date", selectedDate)
      .order("start_time", { ascending: true });
    setAvailability(data || []);
    setLoadingSlots(false);
  }, [selectedBarbershop, selectedBarber, selectedDate]);

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

    const [h, m] = selectedSlot.start_time.split(":").map(Number);
    const endMinutes = h * 60 + m + selectedService.duration_minutes;
    const endTime = `${Math.floor(endMinutes / 60).toString().padStart(2, "0")}:${(endMinutes % 60).toString().padStart(2, "0")}:00`;

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
      await supabase
        .from("availability")
        .update({ status: "ocupado" })
        .eq("id", selectedSlot.id);

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {barbers.map((b) => (
                <Card
                  key={b.user_id}
                  className="bg-card border-border hover:border-primary/50 transition-colors cursor-pointer group"
                  onClick={() => handleSelectBarber(b)}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    {b.avatar_url ? (
                      <img
                        src={b.avatar_url}
                        alt={b.full_name || "Barbeiro"}
                        className="h-12 w-12 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <User className="w-5 h-5 text-primary" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors">
                        {b.full_name || `Barbeiro ${b.user_id.slice(0, 6)}`}
                      </h3>
                      <p className="text-xs text-muted-foreground">Profissional</p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                  </CardContent>
                </Card>
              ))}
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
