import { useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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

/**
 * Área PESSOAL do usuário autenticado.
 *
 * Ela não herda o tenant administrativo. Antes, a lista era filtrada por
 * `useBarbershop().barbershopId` — o campo legado —, então um admin ou
 * barbeiro que também fosse cliente de outra barbearia via apenas as reservas
 * da barbearia onde TRABALHA, e as suas reservas pessoais em outros lugares
 * sumiam. A autorização aqui é a identidade (`auth.uid()` na policy de
 * `appointments`), nunca o papel administrativo.
 */

function MeusAgendamentosPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  // Só para o cabeçalho. O tenant NÃO participa da consulta desta tela.
  const { barbershop } = useBarbershop();
  const name = barbershop?.name || "BarbaFlow";

  // Área pessoal exige sessão. Guardamos a rota para voltar depois do login,
  // em vez de deixar o usuário perdido numa tela vazia.
  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: "/meus-agendamentos" }, replace: true });
    }
  }, [user, loading, navigate]);

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
          {user && (
            <Link to="/perfil">
              <Button variant="ghost" size="sm">Perfil</Button>
            </Link>
          )}
          {!user && !loading && (
            <Link to="/login" search={{ redirect: "/meus-agendamentos" }}>
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

        {/* Sem `barbershopId`: a tela mostra as reservas do usuário em TODAS as
            barbearias. Ver comentário do componente. */}
        <AppointmentHistory />
      </main>
    </div>
  );
}
