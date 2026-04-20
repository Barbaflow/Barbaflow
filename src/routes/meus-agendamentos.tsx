import { createFileRoute, Link } from "@tanstack/react-router";
import { AppointmentHistory } from "@/components/AppointmentHistory";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { NotificationBell } from "@/components/NotificationBell";
import { InstallAppButton } from "@/components/InstallAppButton";
import { EnableNotificationsButton } from "@/components/EnableNotificationsButton";

export const Route = createFileRoute("/meus-agendamentos")({
  head: () => ({
    meta: [
      { title: "Meus Agendamentos — BarbaFlow" },
      { name: "description", content: "Veja seu histórico de agendamentos, filtre por data e status." },
      { property: "og:title", content: "Meus Agendamentos — BarbaFlow" },
      { property: "og:description", content: "Acompanhe seus agendamentos na barbearia." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Meus Agendamentos — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  component: MeusAgendamentosPage,
});

function MeusAgendamentosPage() {
  const { user, loading } = useAuth();
  const { barbershopId, barbershop, isDefault } = useBarbershop();
  const name = barbershop?.name || "BarbaFlow";

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-4 py-4 md:px-12 md:py-5 border-b border-border">
        <div className="flex items-center gap-3">
          {barbershop?.logo_url ? (
            <img src={barbershop.logo_url} alt={name} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-4 h-4 text-primary-foreground" />
            </div>
          )}
          <span className="font-display text-lg text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to={user ? "/dashboard" : "/"}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Voltar</span>
            </Button>
          </Link>
          {user && <InstallAppButton />}
          {user && <EnableNotificationsButton />}
          {user && <NotificationBell />}
          {!user && !loading && (
            <Link to="/login">
              <Button variant="gold" size="sm">Entrar</Button>
            </Link>
          )}
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-8 md:px-6 md:py-10">
        <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground mb-1">
          Meus <span className="text-gradient-gold">Agendamentos</span>
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Histórico completo dos seus horários.
        </p>

        <AppointmentHistory barbershopId={barbershopId} />
      </main>
    </div>
  );
}
