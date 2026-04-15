import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ScheduleManager } from "@/components/ScheduleManager";
import { WeeklyScheduleEditor } from "@/components/WeeklyScheduleEditor";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Scissors, Calendar, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";

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
  const { barbershopId, barbershop } = useBarbershop();
  const name = barbershop?.name || "BarbaFlow";

  if (!loading && !user) {
    navigate({ to: "/login" });
    return null;
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
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          Gestão de <span className="text-gradient-gold">Agenda</span>
        </h1>
        <p className="text-muted-foreground mb-8">
          Defina seus horários semanais e gerencie disponibilidade.
        </p>

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
          </TabsList>

          <TabsContent value="horarios">
            <WeeklyScheduleEditor barbershopId={barbershopId} />
          </TabsContent>

          <TabsContent value="agenda">
            <ScheduleManager barbershopId={barbershopId} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
