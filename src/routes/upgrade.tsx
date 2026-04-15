import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePlan } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Crown,
  Zap,
  Building2,
  ArrowLeft,
  Infinity,
} from "lucide-react";

export const Route = createFileRoute("/upgrade")({
  head: () => ({
    meta: [
      { title: "Upgrade — BarbaFlow" },
      { name: "description", content: "Escolha o plano ideal para sua barbearia." },
    ],
  }),
  component: UpgradePage,
});

interface Plan {
  id: string;
  name: string;
  appointment_limit: number | null;
  has_subscriptions: boolean;
  price: number;
}

const PLAN_CONFIG: Record<string, {
  icon: typeof Zap;
  color: string;
  features: string[];
  popular?: boolean;
}> = {
  free: {
    icon: Zap,
    color: "text-muted-foreground",
    features: [
      "50 agendamentos/mês",
      "Agenda online",
      "Link de agendamento",
      "1 barbeiro",
    ],
  },
  pro: {
    icon: Crown,
    color: "text-primary",
    popular: true,
    features: [
      "Agendamentos ilimitados",
      "Assinaturas de clientes",
      "Relatórios avançados",
      "Equipe ilimitada",
      "Suporte prioritário",
    ],
  },
  enterprise: {
    icon: Building2,
    color: "text-primary",
    features: [
      "Tudo do Pro",
      "Multi-unidades",
      "API dedicada",
      "Gerente de conta",
      "SLA garantido",
      "Personalização avançada",
    ],
  },
};

function UpgradePage() {
  const { user } = useAuth();
  const { planName } = usePlan();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("plans")
      .select("*")
      .order("price", { ascending: true })
      .then(({ data }) => {
        setPlans((data as Plan[]) || []);
        setLoading(false);
      });
  }, []);

  const handleUpgrade = (plan: Plan) => {
    // TODO: Integrate with payment provider after enabling
    // For now show a toast
    import("sonner").then(({ toast }) => {
      toast.info("Integração de pagamento em breve! Entre em contato para upgrade.");
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8 md:py-16">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft className="w-4 h-4" />
          Voltar ao dashboard
        </Link>

        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-3">
            Escolha o plano ideal
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Escale sua barbearia com as ferramentas certas. Comece grátis e faça upgrade quando precisar.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((plan) => {
              const config = PLAN_CONFIG[plan.name] || PLAN_CONFIG.free;
              const Icon = config.icon;
              const isCurrent = planName === plan.name;
              const isUpgrade = !isCurrent && (
                (planName === "free" && (plan.name === "pro" || plan.name === "enterprise")) ||
                (planName === "pro" && plan.name === "enterprise")
              );

              return (
                <Card
                  key={plan.id}
                  className={`relative border-border transition-all ${
                    config.popular
                      ? "border-primary shadow-lg shadow-primary/10 scale-[1.02]"
                      : ""
                  } ${isCurrent ? "ring-2 ring-primary/30" : ""}`}
                >
                  {config.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground text-xs">
                        Mais popular
                      </Badge>
                    </div>
                  )}
                  <CardHeader className="text-center pb-4">
                    <div className={`mx-auto mb-3 h-10 w-10 rounded-full bg-secondary flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <CardTitle className="font-display text-xl capitalize">
                      {plan.name}
                    </CardTitle>
                    <div className="mt-2">
                      {Number(plan.price) === 0 ? (
                        <span className="text-3xl font-display font-bold text-foreground">Grátis</span>
                      ) : (
                        <div>
                          <span className="text-3xl font-display font-bold text-foreground">
                            R$ {Number(plan.price).toFixed(0)}
                          </span>
                          <span className="text-sm text-muted-foreground">/mês</span>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2.5">
                      {config.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                          <span className="text-foreground">{f}</span>
                        </li>
                      ))}
                    </ul>

                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Plano atual
                      </Button>
                    ) : isUpgrade ? (
                      <Button
                        className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                        onClick={() => handleUpgrade(plan)}
                      >
                        Fazer upgrade
                      </Button>
                    ) : (
                      <Button variant="outline" className="w-full" disabled>
                        —
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
