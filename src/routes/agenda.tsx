import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { DEFAULT_BARBERSHOP_ID } from "@/lib/constants";
import { ScheduleManager } from "@/components/ScheduleManager";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/agenda")({
  head: () => ({
    meta: [
      { title: "Gestão de Agenda — BarbaFlow" },
      { name: "description", content: "Gerencie turnos, folgas e agendamentos da sua barbearia." },
      { property: "og:title", content: "Gestão de Agenda — BarbaFlow" },
    ],
  }),
  component: AgendaPage,
});

function AgendaPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const barbershopId = DEFAULT_BARBERSHOP_ID;

  if (!loading && !user) {
    navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-5 md:px-12 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
            <Scissors className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl text-foreground">BarbaFlow</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
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
          Gerencie disponibilidade, turnos e agendamentos.
        </p>
        <ScheduleManager barbershopId={barbershopId} />
      </main>
    </div>
  );
}
