import { useCallback, useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { todayISOInTenantTZ } from "@/lib/tz";
import type { Service, AvailabilitySlot, Barber } from "./types";

export function useBookingData(barbershopId: string) {
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return todayISOInTenantTZ();
  });
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch services
  useEffect(() => {
    supabase
      .from("services")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .then(({ data, error: err }) => {
        if (err) setError("Erro ao carregar serviços.");
        else if (data) setServices(data);
      });
  }, [barbershopId]);

  // Fetch barbers (inclui admin/dono que também atende)
  useEffect(() => {
    supabase
      .from("user_roles")
      .select("user_id")
      .eq("barbershop_id", barbershopId)
      .in("role", ["barbeiro", "admin_barbearia"])
      .then(({ data }) => {
        if (data) {
          // Deduplica caso o admin tenha as duas roles
          const unique = Array.from(new Set(data.map((r) => r.user_id))).map(
            (user_id) => ({ user_id })
          );
          setBarbers(unique);
        }
      });
  }, [barbershopId]);

  // Fetch availability for selected date
  const fetchAvailability = useCallback(
    async (barberId?: string) => {
      setLoadingSlots(true);
      setError(null);

      let query = supabase
        .from("availability")
        .select("*")
        .eq("barbershop_id", barbershopId)
        .eq("date", selectedDate)
        .order("start_time", { ascending: true });

      if (barberId) {
        query = query.eq("barber_id", barberId);
      }

      const { data, error: err } = await query;

      if (err) {
        setError("Erro ao carregar horários. Tente novamente.");
      } else {
        setAvailability(data || []);
      }

      setLoadingSlots(false);
    },
    [barbershopId, selectedDate]
  );

  // O callback usa sempre a versão mais recente de fetchAvailability sem que ela
  // entre nas dependências do efeito: como `fetchAvailability` muda a cada troca
  // de data, o canal era destruído e recriado a cada clique no calendário.
  const fetchRef = useRef(fetchAvailability);
  useEffect(() => {
    fetchRef.current = fetchAvailability;
  }, [fetchAvailability]);

  // Realtime.
  //
  // O tópico era a string fixa "availability-realtime". O cliente Supabase
  // deduplica canais por tópico e devolve o MESMO objeto já inscrito, então
  // dois consumidores simultâneos (duas telas de agendamento montadas juntas)
  // cairiam no erro "cannot add postgres_changes callbacks after subscribe()" —
  // o mesmo defeito já corrigido em usePlan. O id por instância elimina a
  // disputa; sem tenant resolvido, nenhum canal é aberto.
  const instanceId = useId();
  useEffect(() => {
    if (!barbershopId) return;

    const channel = supabase
      .channel(`availability-${barbershopId}-${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability",
          filter: `barbershop_id=eq.${barbershopId}`,
        },
        () => fetchRef.current()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [barbershopId, instanceId]);

  return {
    services,
    barbers,
    availability,
    selectedDate,
    setSelectedDate,
    loadingSlots,
    error,
    fetchAvailability,
  };
}
