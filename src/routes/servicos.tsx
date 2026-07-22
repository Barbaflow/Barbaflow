import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ServicesList } from "@/components/ServicesList";
import { ServicesManager } from "@/components/ServicesManager";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Scissors, ShieldAlert } from "lucide-react";
import { useBarbershop } from "@/hooks/use-barbershop";
import { supabase } from "@/integrations/supabase/client";
import { useTenantScope, tenantAccessMessage } from "@/hooks/use-tenant-scope";

export const Route = createFileRoute("/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços — BarbaFlow" },
      { name: "description", content: "Confira os serviços disponíveis, preços e duração na sua barbearia." },
      { property: "og:title", content: "Serviços — BarbaFlow" },
      { property: "og:description", content: "Confira os serviços disponíveis, preços e duração." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Serviços — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
    links: [
      { rel: "canonical", href: "https://barbaflow.pro/servicos" },
    ],
  }),
  // Seleção explícita de tenant pelo super_admin (ação do AdminDashboard).
  // O parâmetro só é honrado para super_admin — ver useTenantScope.
  validateSearch: (search: Record<string, unknown>): { barbershop?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
  }),
  component: ServicosPage,
});

function ServicosPage() {
  const { barbershop, tenantStatus } = useBarbershop();
  const { barbershop: requestedId } = Route.useSearch();
  const scope = useTenantScope({ requestedBarbershopId: requestedId ?? null });

  // Nome/logo do tenant em exibição. Quando o super_admin escolhe outra
  // barbearia pela URL, o contexto continua sendo o dele — buscamos o nome da
  // barbearia selecionada para o cabeçalho não mentir sobre qual tenant está
  // aberto.
  const [selectedShop, setSelectedShop] = useState<{ name: string; logo_url: string | null } | null>(
    null,
  );
  const isForeignTenant = Boolean(scope.tenantId && scope.tenantId !== barbershop?.id);

  useEffect(() => {
    if (!isForeignTenant || !scope.tenantId) {
      setSelectedShop(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("barbershops")
      .select("name, logo_url")
      .eq("id", scope.tenantId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setSelectedShop(data ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [isForeignTenant, scope.tenantId]);

  const shopName = isForeignTenant ? selectedShop?.name : barbershop?.name;
  const shopLogo = isForeignTenant ? selectedShop?.logo_url : barbershop?.logo_url;
  const name = shopName || "BarbaFlow";

  // Carregando sessão/papel/tenant: nada de lista vazia nem de recusa.
  const resolving = scope.isSuper === null || tenantStatus === "loading" || scope.access === "checking";

  // Só administra quem tem papel comprovado NESTE tenant (ou super_admin com
  // seleção explícita). Um barbeiro que edite a URL continua no próprio tenant.
  const canManage = scope.access === "granted" && Boolean(scope.tenantId);

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-5 md:px-12 border-b border-border">
        <div className="flex items-center gap-3">
          {shopLogo ? (
            <img src={shopLogo} alt={name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <span className="font-display text-xl text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Button>
          </Link>
          <Link to="/agendar">
            <Button variant="gold" size="sm">Agendar</Button>
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10 space-y-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
            Nossos <span className="text-gradient-gold">Serviços</span>
          </h1>
          <p className="text-muted-foreground mb-8">Confira preços e duração de cada serviço.</p>

          {scope.isSuper && !scope.tenantId ? (
            <SelecioneBarbearia />
          ) : (
            <ServicesList barbershopId={scope.tenantId} tenantLoading={resolving} />
          )}
        </div>

        {canManage && scope.tenantId && (
          <section className="border-t border-border pt-10">
            <ServicesManager barbershopId={scope.tenantId} canManageAll={scope.isAdmin} />
          </section>
        )}
      </main>
    </div>
  );
}

/**
 * Super admin sem seleção. Nenhuma consulta é disparada: não caímos no primeiro
 * tenant, nem na sentinela `_system`, nem em um uuid de mock.
 */
function SelecioneBarbearia() {
  const { titulo, texto } = tenantAccessMessage("needs-selection", null, "os serviços");
  return (
    <Card className="max-w-xl">
      <CardContent className="p-8 text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-primary mx-auto" />
        <h2 className="font-display text-lg">{titulo}</h2>
        <p className="text-sm text-muted-foreground">{texto}</p>
        <Link to="/dashboard" search={{ checkout: undefined }}>
          <Button variant="outline">Abrir painel administrativo</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
