import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { BarbershopSettings } from "@/components/BarbershopSettings";
import { TeamManager } from "@/components/TeamManager";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors, LogOut } from "lucide-react";
import { useEffect } from "react";
import { useBarbershop } from "@/hooks/use-barbershop";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — BarbaFlow" },
      { name: "description", content: "Configure o branding da sua barbearia: logo, cores e personalização." },
    ],
  }),
  component: ConfiguracoesPage,
});

function ConfiguracoesPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const { barbershopId, barbershop } = useBarbershop();
  const name = barbershop?.name || "BarbaFlow";

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-5 md:px-12 border-b border-border">
        <div className="flex items-center gap-3">
          {barbershop?.logo_url ? (
            <img src={barbershop.logo_url} alt={name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <span className="font-display text-xl text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
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
            Personalize seu perfil e a sua barbearia.
          </p>

          <div className="space-y-6">
            <ProfilePhotoUpload />
            <BarbershopSettings barbershopId={barbershopId} />
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-display font-bold text-foreground mb-2">
            <span className="text-gradient-gold">Equipe</span>
          </h2>
          <p className="text-muted-foreground mb-6">
            Gerencie barbeiros e administradores da sua barbearia.
          </p>
          <TeamManager barbershopId={barbershopId} />
        </div>
      </main>
    </div>
  );
}
