import { createFileRoute, Link } from "@tanstack/react-router";
import { DEFAULT_BARBERSHOP_ID } from "@/lib/constants";
import { BookingCalendar } from "@/components/BookingCalendar";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/agendar")({
  head: () => ({
    meta: [
      { title: "Agendar — BarbaFlow" },
      { name: "description", content: "Agende seu horário na barbearia. Escolha serviço, barbeiro e horário disponível." },
      { property: "og:title", content: "Agendar — BarbaFlow" },
    ],
  }),
  component: AgendarPage,
});

function AgendarPage() {
  const { user, loading } = useAuth();

  const barbershopId = DEFAULT_BARBERSHOP_ID;

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
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Button>
          </Link>
          {!user && !loading && (
            <Link to="/login">
              <Button variant="gold" size="sm">Entrar</Button>
            </Link>
          )}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          <span className="text-gradient-gold">Agendar</span> Horário
        </h1>
        <p className="text-muted-foreground mb-8">
          Selecione serviço, data e horário disponível.
        </p>

        {!user && !loading && (
          <div className="mb-6 p-4 rounded-lg border border-gold/30 bg-gold/5 text-sm text-foreground">
            <Link to="/login" className="text-gold underline">Faça login</Link>{" "}
            para confirmar seu agendamento.
          </div>
        )}

        <BookingCalendar barbershopId={barbershopId} />
      </main>
    </div>
  );
}
