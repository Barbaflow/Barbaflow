import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Service, AvailabilitySlot, Barber } from "./types";

export function useBookingData(barbershopId: string) {
  const [services, setServices] = useState<Service[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return new Date().toISOString().split("T")[0];
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

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("availability-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability",
          filter: `barbershop_id=eq.${barbershopId}`,
        },
        () => fetchAvailability()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barbershopId, fetchAvailability]);

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
