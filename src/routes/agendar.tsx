import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicBookingWizard } from "@/components/booking/PublicBookingWizard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";

export const Route = createFileRoute("/agendar")({
  head: () => ({
    meta: [
      { title: "Agendar Horário — BarbaFlow" },
      { name: "description", content: "Agende seu horário na barbearia de forma rápida e fácil. Escolha o barbeiro, serviço e horário ideal para você." },
      { property: "og:title", content: "Agende seu Horário — BarbaFlow" },
      { property: "og:description", content: "Agende seu horário na barbearia de forma rápida e fácil. Escolha o barbeiro, serviço e horário ideal para você." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Agende seu Horário — BarbaFlow" },
      { name: "twitter:description", content: "Agende seu horário na barbearia de forma rápida e fácil." },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  component: AgendarPage,
});

function AgendarPage() {
  const { user, loading } = useAuth();
  const { barbershop } = useBarbershop();
  const name = barbershop?.name || "BarbaFlow";

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

      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          <span className="text-gradient-gold">Agendar</span> Horário
        </h1>
        <p className="text-muted-foreground mb-8">
          Escolha a barbearia, barbeiro, serviço e horário desejado.
        </p>

        {!user && !loading && (
          <div className="mb-6 p-4 rounded-lg border border-gold/30 bg-gold/5 text-sm text-foreground">
            <Link to="/login" className="text-gold underline">Faça login</Link>{" "}
            para confirmar seu agendamento.
          </div>
        )}

        <PublicBookingWizard />
      </main>
    </div>
  );
}
