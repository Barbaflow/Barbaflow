import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Crown, Zap, ArrowUpRight, Settings, Loader2 } from "lucide-react";
import { usePlan } from "@/hooks/use-plan";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function PlanCard() {
  const { planName, appointmentLimit, appointmentsUsed, loading } = usePlan();
  const { user } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);

  const handleManageSubscription = async () => {
    if (!user) return;
    setPortalLoading(true);
    try {
      const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN || "";
      const environment = clientToken.startsWith("test_") ? "sandbox" : "live";
      const { data, error } = await supabase.functions.invoke("create-portal-session", {
        body: { environment },
      });
      if (error || !data?.url) {
        toast.error("Não foi possível abrir o portal de assinatura. Tente novamente.");
        return;
      }
      window.open(data.url, "_blank");
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) return null;

  const isFree = planName === "free";
  const usagePercent = appointmentLimit
    ? Math.round((appointmentsUsed / appointmentLimit) * 100)
    : 0;
  const isWarning = isFree && usagePercent >= 80;
  const isAtLimit = isFree && appointmentLimit !== null && appointmentsUsed >= appointmentLimit;

  return (
    <Card
      className={`border-border ${
        isAtLimit
          ? "border-destructive/50 bg-destructive/5"
          : isWarning
            ? "border-yellow-500/50 bg-yellow-500/5"
            : "bg-card"
      }`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isFree ? (
              <Zap className="w-4 h-4 text-primary" />
            ) : (
              <Crown className="w-4 h-4 text-primary" />
            )}
            <span className="text-xs text-muted-foreground">Seu Plano</span>
          </div>
          <Badge
            variant={isFree ? "secondary" : "default"}
            className={!isFree ? "bg-primary text-primary-foreground" : ""}
          >
            {PLAN_LABELS[planName]}
          </Badge>
        </div>

        {isFree && appointmentLimit ? (
          <>
            <div className="flex items-baseline gap-1 mb-2">
              <span className="text-2xl font-display font-bold text-foreground">
                {appointmentsUsed}
              </span>
              <span className="text-sm text-muted-foreground">/ {appointmentLimit} ags</span>
            </div>
            <Progress
              value={usagePercent}
              className={`h-2 mb-3 ${
                isAtLimit
                  ? "[&>div]:bg-destructive"
                  : isWarning
                    ? "[&>div]:bg-yellow-500"
                    : ""
              }`}
            />
            {isAtLimit ? (
              <p className="text-xs text-destructive mb-2">
                Limite atingido! Faça upgrade para continuar agendando.
              </p>
            ) : isWarning ? (
              <p className="text-xs text-yellow-500 mb-2">
                Você está chegando ao limite do plano Free.
              </p>
            ) : null}
            <Link to="/upgrade">
              <Button size="sm" className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
                <ArrowUpRight className="w-3.5 h-3.5 mr-1" />
                Upgrade Pro — R$ 99/mês
              </Button>
            </Link>
          </>
        ) : (
          <>
          <p className="text-sm text-muted-foreground mb-3">
            Agendamentos ilimitados ✨
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={handleManageSubscription}
            disabled={portalLoading}
          >
            {portalLoading ? (
              <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
            ) : (
              <Settings className="w-3.5 h-3.5 mr-1" />
            )}
            Gerenciar assinatura
          </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
