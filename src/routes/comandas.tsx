import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Scissors, ShieldAlert, Store, ReceiptText } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { supabase } from "@/integrations/supabase/client";
import { useTenantScope, tenantAccessMessage } from "@/hooks/use-tenant-scope";
import { ComandasManager } from "@/components/ComandasManager";

export const Route = createFileRoute("/comandas")({
  head: () => ({
    meta: [
      { title: "Comandas — BarbaFlow" },
      { name: "description", content: "Abra, gerencie e feche as comandas da sua barbearia." },
      { property: "og:title", content: "Comandas — BarbaFlow" },
      { property: "og:description", content: "Abra, gerencie e feche as comandas da sua barbearia." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Comandas — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  // Seleção explícita de tenant pelo super_admin (ação do AdminDashboard) e
  // atalho para abrir direto uma comanda (?comanda=<uuid>), vindo da agenda.
  // A seleção de tenant é honrada apenas para super_admin — ver useTenantScope.
  validateSearch: (search: Record<string, unknown>): { barbershop?: string; comanda?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
    comanda: typeof search.comanda === "string" ? search.comanda : undefined,
  }),
  component: ComandasPage,
});

/**
 * Gestão operacional de comandas de UM tenant.
 *
 * O tenant vem de `useTenantScope` — nunca de `useBarbershop().barbershopId`
 * (legado, que cai em DEFAULT_BARBERSHOP_ID). Enquanto sessão/papel/tenant não
 * resolvem, mostramos carregando: nunca lista vazia nem "acesso negado" antes
 * da hora, que seriam mentira sobre um estado ainda desconhecido.
 */
function ComandasPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { barbershop, tenantStatus } = useBarbershop();
  const { barbershop: requestedId, comanda: requestedComanda } = Route.useSearch();
  const scope = useTenantScope({ requestedBarbershopId: requestedId ?? null });

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

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: undefined } });
    }
  }, [user, loading, navigate]);

  const shopName = isForeignTenant ? selectedShop?.name : barbershop?.name;
  const shopLogo = isForeignTenant ? selectedShop?.logo_url : barbershop?.logo_url;
  const name = shopName || "BarbaFlow";

  const resolving =
    loading || !user || scope.isSuper === null || tenantStatus === "loading" || scope.access === "checking";

  const tenantId = scope.access === "granted" ? scope.tenantId : null;

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
          <Link to="/dashboard" search={{ checkout: undefined }}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Button>
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2 flex items-center gap-3">
          <ReceiptText className="w-8 h-8 text-primary" />
          <span className="text-gradient-gold">Comandas</span>
        </h1>
        <p className="text-muted-foreground mb-8">
          Abra comandas, lance serviços e produtos, aplique descontos e feche o atendimento.
        </p>

        {isForeignTenant && tenantId && (
          <div className="mb-6 flex items-start gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <Store className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              Você está operando as comandas de{" "}
              <strong>{selectedShop?.name ?? "a barbearia selecionada"}</strong> como super admin.
            </p>
          </div>
        )}

        {resolving ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tenantId ? (
          <ComandasManager
            barbershopId={tenantId}
            canManage={scope.isAdmin || scope.isBarber}
            initialTicketId={requestedComanda ?? null}
          />
        ) : (
          <SemComandas scope={scope} />
        )}
      </main>
    </div>
  );
}

/** Explica por que não há comandas, em vez de mostrar uma lista vazia. */
function SemComandas({ scope }: { scope: ReturnType<typeof useTenantScope> }) {
  const { titulo, texto } = tenantAccessMessage(scope.access, scope.accessError, "as comandas");
  if (!titulo) return null;
  const isErro = scope.access === "error";

  return (
    <Card className={isErro ? "border-destructive/40" : undefined}>
      <CardContent className="p-6 text-center space-y-3">
        <ShieldAlert
          className={`w-10 h-10 mx-auto ${isErro ? "text-destructive" : "text-muted-foreground"}`}
        />
        <h2 className="font-display text-lg text-foreground">{titulo}</h2>
        <p className="text-sm text-muted-foreground">{texto}</p>
      </CardContent>
    </Card>
  );
}
