import { createFileRoute, Link } from "@tanstack/react-router";
import { ServicesList } from "@/components/ServicesList";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors } from "lucide-react";
import { useBarbershop } from "@/hooks/use-barbershop";

export const Route = createFileRoute("/servicos")({
  head: () => ({
    meta: [
      { title: "Serviços — BarbaFlow" },
      { name: "description", content: "Confira os serviços disponíveis, preços e duração na sua barbearia." },
      { property: "og:title", content: "Serviços — BarbaFlow" },
      { property: "og:description", content: "Confira os serviços disponíveis, preços e duração." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Serviços — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  component: ServicosPage,
});

function ServicosPage() {
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
          <Link to="/agendar">
            <Button variant="gold" size="sm">Agendar</Button>
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          Nossos <span className="text-gradient-gold">Serviços</span>
        </h1>
        <p className="text-muted-foreground mb-8">Confira preços e duração de cada serviço.</p>
        <ServicesList barbershopId={barbershop?.id} />
      </main>
    </div>
  );
}
