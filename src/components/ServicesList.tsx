import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign } from "lucide-react";

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  barber_id: string;
  barbershop_id: string;
}

interface ServicesListProps {
  barbershopId?: string;
}

export function ServicesList({ barbershopId }: ServicesListProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchServices() {
      let query = supabase
        .from("services")
        .select("*")
        .eq("active", true);

      if (barbershopId) {
        query = query.eq("barbershop_id", barbershopId);
      }

      const { data, error } = await query.order("name");
      if (!error && data) {
        setServices(data);
      }
      setLoading(false);
    }
    fetchServices();
  }, [barbershopId]);

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="bg-card border-border animate-pulse">
            <CardContent className="p-6 h-32" />
          </Card>
        ))}
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg">Nenhum serviço disponível no momento.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((service) => (
        <Card
          key={service.id}
          className="bg-card border-border hover:border-gold transition-colors group"
        >
          <CardContent className="p-6">
            <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-gradient-gold transition-colors">
              {service.name}
            </h3>
            <div className="mt-4 flex items-center gap-4">
              <Badge variant="secondary" className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {service.duration_minutes} min
              </Badge>
              <Badge variant="outline" className="flex items-center gap-1 border-gold text-gold">
                <DollarSign className="w-3 h-3" />
                R$ {Number(service.price).toFixed(2)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
