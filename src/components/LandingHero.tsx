import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Scissors, Calendar } from "lucide-react";

interface LandingHeroProps {
  barbershopName?: string;
  primaryColor?: string;
  logoUrl?: string;
}

export function LandingHero({ barbershopName, primaryColor, logoUrl }: LandingHeroProps) {
  const name = barbershopName || "BarbaFlow";

  return (
    <div className="relative min-h-screen flex flex-col">
      {/* Subtle grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(var(--gold) 1px, transparent 1px), linear-gradient(90deg, var(--gold) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <span className="font-display text-xl text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost" size="sm">Entrar</Button>
          </Link>
          <Link to="/agendar">
            <Button variant="gold" size="sm">Agendar</Button>
          </Link>
          <Link to="/onboarding">
            <Button variant="outline" size="sm" className="hidden sm:inline-flex">Abrir Barbearia</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6 md:px-12">
        <div className="max-w-3xl text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
          <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-4 font-body font-medium">
            Barbearia Premium
          </p>
          <h1 className="text-5xl md:text-7xl font-display font-bold leading-[1.1] text-foreground mb-6">
            Agende na{" "}
            <span className="text-gradient-gold">{name}</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-10 font-body">
            Experiência exclusiva em cortes, barbas e tratamentos. 
            Reserve seu horário em segundos.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
            <Link to="/agendar">
              <Button variant="gold" size="xl">
                <Calendar className="w-5 h-5" />
                Agendar agora
              </Button>
            </Link>
            <Link to="/servicos">
              <Button variant="gold-outline" size="xl">
                <Scissors className="w-5 h-5" />
                Ver serviços
              </Button>
            </Link>
          </div>
        </div>
      </main>

      {/* Stats bar */}
      <div className="relative z-10 border-t border-border animate-in fade-in duration-1000 delay-500">
        <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-3 gap-8 text-center">
          <div>
            <p className="text-2xl md:text-3xl font-display font-bold text-gradient-gold">500+</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Clientes</p>
          </div>
          <div>
            <p className="text-2xl md:text-3xl font-display font-bold text-gradient-gold">4.9★</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Avaliação</p>
          </div>
          <div>
            <p className="text-2xl md:text-3xl font-display font-bold text-gradient-gold">5+</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Barbeiros</p>
          </div>
        </div>
      </div>
    </div>
  );
}
