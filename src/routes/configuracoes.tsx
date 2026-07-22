import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { BarbershopSettings } from "@/components/BarbershopSettings";
import { TeamManager } from "@/components/TeamManager";
import { NoShowReport } from "@/components/NoShowReport";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Scissors, LogOut, ShieldAlert, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { useBarbershop } from "@/hooks/use-barbershop";
import { supabase } from "@/integrations/supabase/client";
import { useTenantScope, tenantAccessMessage } from "@/hooks/use-tenant-scope";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — BarbaFlow" },
      { name: "description", content: "Configure o branding da sua barbearia: logo, cores, equipe e personalização." },
      { property: "og:title", content: "Configurações — BarbaFlow" },
      { property: "og:description", content: "Personalize sua barbearia no BarbaFlow." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Configurações — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  // Seleção explícita de tenant pelo super_admin (ação do AdminDashboard).
  // Honrada apenas para super_admin — ver useTenantScope.
  validateSearch: (search: Record<string, unknown>): { barbershop?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { barbershop, tenantStatus } = useBarbershop();
  const { barbershop: requestedId } = Route.useSearch();
  const scope = useTenantScope({ requestedBarbershopId: requestedId ?? null });

  // Quando o super_admin abre outra barbearia pela URL, o contexto continua
  // sendo o dele: buscamos o nome do tenant realmente aberto para o cabeçalho
  // não mostrar a barbearia errada.
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

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  // Carregando sessão, papel global ou tenant. Nunca mostramos "acesso negado"
  // nem seções vazias antes de a resolução terminar.
  const resolving =
    loading || !user || scope.isSuper === null || tenantStatus === "loading" || scope.access === "checking";

  if (resolving) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Tenant operacional confirmado por papel (ou seleção explícita do super_admin).
  const tenantId = scope.access === "granted" ? scope.tenantId : null;
  // Só o administrador (e o super_admin no tenant selecionado) altera a
  // barbearia e a equipe. O barbeiro tem apenas o próprio perfil aqui — é
  // exatamente o que a RLS lhe permite.
  const canAdminister = Boolean(tenantId) && scope.isAdmin;
  const isStaff = Boolean(tenantId);

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
          <Link
            to={isStaff || scope.isSuper ? "/dashboard" : "/meus-agendamentos"}
            search={isStaff || scope.isSuper ? { checkout: undefined } : undefined}
          >
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              {isStaff || scope.isSuper ? "Dashboard" : "Meus agendamentos"}
            </Button>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => signOut()}>
            <LogOut className="w-4 h-4" />
            Sair
          </Button>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        <div>
          <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
            <span className="text-gradient-gold">Configurações</span>
          </h1>
          <p className="text-muted-foreground mb-8">
            {canAdminister
              ? "Personalize seu perfil e a sua barbearia."
              : "Atualize seu nome, foto e telefone."}
          </p>

          {isForeignTenant && canAdminister && (
            <div className="mb-6 flex items-start gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
              <Store className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <p className="text-xs text-foreground">
                Você está editando <strong>{selectedShop?.name ?? "a barbearia selecionada"}</strong>{" "}
                como super admin. Todas as alterações abaixo valem apenas para esta barbearia.
              </p>
            </div>
          )}

          <div className="space-y-6">
            <ProfilePhotoUpload />
            {canAdminister && tenantId && <BarbershopSettings barbershopId={tenantId} />}
          </div>
        </div>

        {/* Sem tenant administrável: explicamos o motivo em vez de sumir com as
            seções silenciosamente ou mostrar dados de outra barbearia. */}
        {!canAdminister && <SemAcessoAdministrativo scope={scope} />}

        {canAdminister && tenantId && (
          <>
            <div id="equipe">
              <h2 className="text-2xl font-display font-bold text-foreground mb-2">
                <span className="text-gradient-gold">Equipe</span>
              </h2>
              <p className="text-muted-foreground mb-6">
                Gerencie barbeiros e administradores da sua barbearia.
              </p>
              <TeamManager barbershopId={tenantId} />
            </div>

            <NoShowReport barbershopId={tenantId} />
          </>
        )}
      </main>
    </div>
  );
}

function SemAcessoAdministrativo({
  scope,
}: {
  scope: ReturnType<typeof useTenantScope>;
}) {
  // Barbeiro com tenant resolvido não é "acesso negado": ele simplesmente não
  // administra a barbearia. As demais situações reaproveitam os textos padrão.
  if (scope.access === "granted" && scope.isBarber) {
    return (
      <Card>
        <CardContent className="p-6 space-y-2">
          <h2 className="font-display text-lg text-foreground">Configurações da barbearia</h2>
          <p className="text-sm text-muted-foreground">
            A identidade visual, o endereço, os horários e a equipe são gerenciados pelo
            administrador da barbearia. Seus horários de atendimento ficam no painel, em
            “Horários”.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (scope.access === "granted") return null;

  // `forbidden` aqui quase sempre significa "conta de cliente" — esta tela
  // também é o perfil do usuário. Tratar isso como recusa alarmante seria
  // mentir sobre a situação; a mensagem é informativa, não um erro.
  const { titulo, texto } =
    scope.access === "forbidden"
      ? {
          titulo: "Configurações da barbearia",
          texto:
            "Esta conta não administra nenhuma barbearia, então só o seu perfil aparece aqui.",
        }
      : tenantAccessMessage(scope.access, scope.accessError, "as configurações");

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
