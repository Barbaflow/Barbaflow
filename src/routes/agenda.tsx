import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ScheduleManager } from "@/components/ScheduleManager";
import { WeeklyScheduleEditor } from "@/components/WeeklyScheduleEditor";
import { ScheduleBlocks } from "@/components/ScheduleBlocks";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Scissors, Calendar, Clock, CalendarOff, ShieldAlert, Store } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { supabase } from "@/integrations/supabase/client";
import { useTenantScope, tenantAccessMessage } from "@/hooks/use-tenant-scope";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Gestão de Agenda — BarbaFlow" },
      { name: "description", content: "Gerencie turnos, folgas e agendamentos da sua barbearia." },
      { property: "og:title", content: "Gestão de Agenda — BarbaFlow" },
      { property: "og:description", content: "Gerencie turnos, folgas e agendamentos da sua barbearia." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Gestão de Agenda — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  // Seleção explícita de tenant pelo super_admin (ação do AdminDashboard).
  // Honrada apenas para super_admin — ver useTenantScope.
  validateSearch: (search: Record<string, unknown>): { barbershop?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
  }),
  component: AgendaPage,
});

/**
 * Gestão de agenda de UM tenant.
 *
 * A versão anterior lia `useBarbershop().barbershopId` — o campo LEGADO, que
 * nunca é null e cai em `DEFAULT_BARBERSHOP_ID`, o mesmo uuid da barbearia
 * fictícia do mock. No modo Supabase esse id aponta para uma linha inexistente,
 * então a agenda consultava (e tentava gravar) um tenant inventado, sem checar
 * papel nenhum. Aqui o tenant só existe quando foi de fato resolvido.
 */
function AgendaPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { barbershop, tenantStatus } = useBarbershop();
  const { barbershop: requestedId } = Route.useSearch();
  const scope = useTenantScope({ requestedBarbershopId: requestedId ?? null });

  // Quando o super_admin abre outra barbearia pela URL, o contexto continua
  // sendo o dele: buscamos o nome do tenant realmente aberto.
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
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  const shopName = isForeignTenant ? selectedShop?.name : barbershop?.name;
  const shopLogo = isForeignTenant ? selectedShop?.logo_url : barbershop?.logo_url;
  const name = shopName || "BarbaFlow";

  // Sessão, papel global ou tenant ainda resolvendo. Nunca mostramos agenda
  // vazia nem "acesso negado" antes de a resolução terminar — as duas coisas
  // seriam mentira sobre um estado que ainda não é conhecido.
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
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          Gestão de <span className="text-gradient-gold">Agenda</span>
        </h1>
        <p className="text-muted-foreground mb-8">
          Defina seus horários semanais e gerencie disponibilidade.
        </p>

        {isForeignTenant && tenantId && (
          <div className="mb-6 flex items-start gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <Store className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              Você está operando a agenda de{" "}
              <strong>{selectedShop?.name ?? "a barbearia selecionada"}</strong> como super admin.
            </p>
          </div>
        )}

        {resolving ? (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tenantId ? (
          <Tabs defaultValue="horarios" className="space-y-6">
            <TabsList className="bg-card border border-border">
              <TabsTrigger value="horarios" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Clock className="w-4 h-4" />
                Meus Horários
              </TabsTrigger>
              <TabsTrigger value="agenda" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <Calendar className="w-4 h-4" />
                Agenda Semanal
              </TabsTrigger>
              <TabsTrigger value="bloqueios" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                <CalendarOff className="w-4 h-4" />
                Bloqueios
              </TabsTrigger>
            </TabsList>

            <TabsContent value="horarios">
              <WeeklyScheduleEditor barbershopId={tenantId} />
            </TabsContent>

            <TabsContent value="agenda">
              <ScheduleManager barbershopId={tenantId} />
            </TabsContent>

            <TabsContent value="bloqueios">
              <ScheduleBlocks barbershopId={tenantId} />
            </TabsContent>
          </Tabs>
        ) : (
          <SemAgenda scope={scope} />
        )}
      </main>
    </div>
  );
}

/** Explica por que não há agenda, em vez de mostrar abas vazias. */
function SemAgenda({ scope }: { scope: ReturnType<typeof useTenantScope> }) {
  const { titulo, texto } = tenantAccessMessage(scope.access, scope.accessError, "a agenda");
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
