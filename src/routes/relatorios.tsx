import type { ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BarberReports } from "@/components/BarberReports";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { useTenantScope, tenantAccessMessage } from "@/hooks/use-tenant-scope";
import { useCanAccessFeature } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Crown, ArrowLeft, ShieldAlert } from "lucide-react";
import { BILLING_UI_ENABLED } from "@/lib/billing-ui";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — BarbaFlow" },
      { name: "description", content: "Relatórios e métricas detalhadas da sua barbearia." },
      { property: "og:title", content: "Relatórios — BarbaFlow" },
      { property: "og:description", content: "Relatórios e métricas detalhadas da sua barbearia." },
      { property: "og:image", content: "https://barbaflow-delta.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Relatórios — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-delta.vercel.app/og-image.jpg" },
    ],
  }),
  // Seleção explícita de tenant pelo super_admin (ação do AdminDashboard).
  // Honrada apenas para super_admin — ver useTenantScope.
  validateSearch: (search: Record<string, unknown>): { barbershop?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
  }),
  component: RelatoriosPage,
});

/**
 * Relatórios de vendas de UM tenant.
 *
 * Duas barreiras, nesta ordem:
 *   1. TENANT (useTenantScope): o tenant nunca vem do `barbershopId` legado.
 *      Enquanto sessão/papel/tenant resolvem, mostramos carregando — nunca
 *      "acesso negado" prematuro.
 *   2. PLANO (useCanAccessFeature): relatórios são um recurso do Pro. O
 *      super_admin é equipe da plataforma e NÃO é barrado pelo plano do tenant
 *      que ele inspeciona; admin/barbeiro dependem do plano da própria barbearia.
 */
function RelatoriosPage() {
  const { user, loading: authLoading } = useAuth();
  const { barbershop, tenantStatus } = useBarbershop();
  const { barbershop: requestedId } = Route.useSearch();
  const scope = useTenantScope({ requestedBarbershopId: requestedId ?? null });
  const plan = useCanAccessFeature("reports");

  const isForeignTenant = Boolean(scope.tenantId && scope.tenantId !== barbershop?.id);

  // O plano só barra quem NÃO é super_admin. Enquanto isSuper é null, ainda não
  // sabemos — seguimos resolvendo.
  const planGateApplies = scope.isSuper === false;

  const resolving =
    authLoading ||
    !user ||
    scope.isSuper === null ||
    tenantStatus === "loading" ||
    scope.access === "checking" ||
    (planGateApplies && plan.loading);

  const tenantId = scope.access === "granted" ? scope.tenantId : null;

  if (resolving) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Barreira de tenant.
  if (!tenantId) {
    const { titulo, texto } = tenantAccessMessage(scope.access, scope.accessError, "os relatórios");
    return (
      <CenteredCard>
        <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-display font-bold text-foreground">{titulo || "Sem acesso"}</h1>
        <p className="text-muted-foreground font-body">{texto}</p>
        <BackToDashboard />
      </CenteredCard>
    );
  }

  // Barreira de plano (apenas para admin/barbeiro do próprio tenant).
  if (planGateApplies && plan.failed) {
    return (
      <CenteredCard>
        <h1 className="text-2xl font-display font-bold text-foreground">
          Não foi possível verificar seu plano
        </h1>
        <p className="text-muted-foreground font-body">
          Os relatórios dependem do seu plano e a consulta falhou. Tente novamente em instantes.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button variant="gold" size="lg" onClick={plan.refreshPlan}>
            Tentar novamente
          </Button>
          <BackToDashboard ghost />
        </div>
      </CenteredCard>
    );
  }

  if (planGateApplies && !plan.canAccess) {
    return (
      <CenteredCard>
        <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Crown className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-display font-bold text-foreground">Relatórios Avançados</h1>
        <p className="text-muted-foreground font-body">
          Os relatórios detalhados estão disponíveis a partir do plano Pro. Faça upgrade para acessar
          faturamento, serviços, produtos, profissionais e formas de pagamento.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {BILLING_UI_ENABLED && (
            <Link to="/upgrade">
              <Button variant="gold" size="lg">
                <Crown className="w-4 h-4" />
                Fazer upgrade
              </Button>
            </Link>
          )}
          <BackToDashboard ghost />
        </div>
      </CenteredCard>
    );
  }

  return (
    <BarberReports
      barbershopId={tenantId}
      isSuper={Boolean(scope.isSuper)}
      isAdmin={scope.isAdmin}
      isBarber={scope.isBarber}
      isForeignTenant={isForeignTenant}
    />
  );
}

function CenteredCard({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <Card className="max-w-md w-full">
        <CardContent className="p-8 text-center space-y-6">{children}</CardContent>
      </Card>
    </div>
  );
}

function BackToDashboard({ ghost }: { ghost?: boolean }) {
  return (
    <Link to="/dashboard" search={{ checkout: undefined }}>
      <Button variant={ghost ? "ghost" : "outline"} size="lg">
        <ArrowLeft className="w-4 h-4" />
        Voltar ao painel
      </Button>
    </Link>
  );
}
