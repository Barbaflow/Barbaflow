import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Scissors, Calendar, Store, UserPlus, Palette, CalendarCheck, Rocket, Check, Zap, Crown } from "lucide-react";

interface LandingHeroProps {
  barbershopName?: string;
  primaryColor?: string;
  logoUrl?: string;
  isDefault?: boolean;
}

export function LandingHero({ barbershopName, primaryColor, logoUrl, isDefault }: LandingHeroProps) {
  const name = barbershopName || "BarbaFlow";

  // SaaS landing — no specific barbershop
  if (isDefault || !barbershopName) {
    return (
      <div className="relative min-h-screen flex flex-col">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(var(--gold) 1px, transparent 1px), linear-gradient(90deg, var(--gold) 1px, transparent 1px)`,
            backgroundSize: "60px 60px",
          }}
        />

        <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-display text-xl text-foreground">BarbaFlow</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" size="sm">Entrar</Button>
            </Link>
            <Link to="/onboarding">
              <Button variant="gold" size="sm">
                <Store className="w-4 h-4" />
                Abrir Barbearia
              </Button>
            </Link>
          </div>
        </nav>

        <main className="relative z-10 flex-1 flex items-center justify-center px-6 md:px-12">
          <div className="max-w-3xl text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
            <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-4 font-body font-medium">
              Plataforma para Barbearias
            </p>
            <h1 className="text-5xl md:text-7xl font-display font-bold leading-[1.1] text-foreground mb-6">
              Sua barbearia{" "}
              <span className="text-gradient-gold">online</span> em minutos
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mx-auto mb-10 font-body">
              Crie seu site de agendamento personalizado, gerencie sua equipe e acompanhe seus resultados. Tudo em um só lugar.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
              <Link to="/onboarding">
                <Button variant="gold" size="xl">
                  <Store className="w-5 h-5" />
                  Abrir minha barbearia
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="gold-outline" size="xl">
                  Já tenho conta
                </Button>
              </Link>
            </div>
          </div>
        </main>

        <div className="relative z-10 border-t border-border animate-in fade-in duration-1000 delay-500">
          <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-3 gap-8 text-center">
            <div>
              <p className="text-2xl md:text-3xl font-display font-bold text-gradient-gold">Grátis</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Para começar</p>
            </div>
            <div>
              <p className="text-2xl md:text-3xl font-display font-bold text-gradient-gold">White-label</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Sua marca</p>
            </div>
            <div>
              <p className="text-2xl md:text-3xl font-display font-bold text-gradient-gold">100%</p>
              <p className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Online</p>
            </div>
          </div>
        </div>

        {/* Como funciona */}
        <div className="relative z-10 px-6 md:px-12 py-16 md:py-24">
          <div className="max-w-5xl mx-auto">
            <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-3 font-body font-medium text-center">
              Simples e rápido
            </p>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-14">
              Como <span className="text-gradient-gold">funciona</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-8 md:gap-6">
              {[
                {
                  icon: UserPlus,
                  step: "01",
                  title: "Crie sua conta",
                  description: "Cadastre-se gratuitamente em segundos.",
                },
                {
                  icon: Palette,
                  step: "02",
                  title: "Personalize",
                  description: "Defina nome, logo, cores e subdomínio da sua barbearia.",
                },
                {
                  icon: CalendarCheck,
                  step: "03",
                  title: "Configure a agenda",
                  description: "Adicione serviços, barbeiros e horários de atendimento.",
                },
                {
                  icon: Rocket,
                  step: "04",
                  title: "Comece a agendar",
                  description: "Compartilhe o link e receba agendamentos dos clientes.",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="relative flex flex-col items-center text-center p-6 rounded-2xl border border-border bg-card/50 backdrop-blur-sm hover:border-gold/30 transition-colors duration-300"
                >
                  <span className="text-xs font-body font-semibold text-gold-muted tracking-widest mb-3">
                    PASSO {item.step}
                  </span>
                  <div className="h-12 w-12 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold mb-4">
                    <item.icon className="w-6 h-6 text-primary-foreground" />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground font-body">{item.description}</p>
                </div>
              ))}
            </div>

            <div className="flex justify-center mt-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <Link to="/onboarding">
                <Button variant="gold" size="xl">
                  <Store className="w-5 h-5" />
                  Começar agora — é grátis
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Planos */}
        <div className="relative z-10 px-6 md:px-12 py-16 md:py-24 border-t border-border">
          <div className="max-w-5xl mx-auto">
            <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-3 font-body font-medium text-center">
              Planos
            </p>
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground text-center mb-14">
              Escolha o plano <span className="text-gradient-gold">ideal</span>
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Free */}
              <div className="flex flex-col rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 hover:border-gold/20 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <Zap className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-foreground">Free</h3>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-display font-bold text-foreground">R$0</span>
                  <span className="text-muted-foreground font-body">/mês</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {["Até 50 agendamentos/mês", "1 barbeiro", "Subdomínio personalizado", "Agendamento online"].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground font-body">
                      <Check className="w-4 h-4 text-gold-muted mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/onboarding" className="w-full">
                  <Button variant="gold-outline" size="lg" className="w-full">Começar grátis</Button>
                </Link>
              </div>

              {/* Pro */}
              <div className="relative flex flex-col rounded-2xl border-2 border-gold/50 bg-card/50 backdrop-blur-sm p-6 shadow-gold">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-gold text-primary-foreground text-xs font-body font-semibold px-4 py-1 rounded-full">
                  Mais popular
                </span>
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
                    <Rocket className="w-5 h-5 text-primary-foreground" />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-foreground">Pro</h3>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-display font-bold text-gradient-gold">R$99</span>
                  <span className="text-muted-foreground font-body">/mês</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {["Agendamentos ilimitados", "Barbeiros ilimitados", "Relatórios avançados", "Suporte prioritário", "Personalização completa"].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground font-body">
                      <Check className="w-4 h-4 text-gold-muted mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/onboarding" className="w-full">
                  <Button variant="gold" size="lg" className="w-full">Assinar Pro</Button>
                </Link>
              </div>

              {/* Enterprise */}
              <div className="flex flex-col rounded-2xl border border-border bg-card/50 backdrop-blur-sm p-6 hover:border-gold/20 transition-colors">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <Crown className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-display text-xl font-semibold text-foreground">Enterprise</h3>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-display font-bold text-foreground">R$299</span>
                  <span className="text-muted-foreground font-body">/mês</span>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {["Tudo do Pro", "Múltiplas unidades", "API personalizada", "Gerente de conta dedicado", "SLA garantido"].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground font-body">
                      <Check className="w-4 h-4 text-gold-muted mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to="/onboarding" className="w-full">
                  <Button variant="gold-outline" size="lg" className="w-full">Fale conosco</Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Tenant-specific landing
  return (
    <div className="relative min-h-screen flex flex-col">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(var(--gold) 1px, transparent 1px), linear-gradient(90deg, var(--gold) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

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
          <Link to="/meus-agendamentos">
            <Button variant="ghost" size="sm" className="hidden sm:inline-flex">Meus Horários</Button>
          </Link>
          <Link to="/agendar">
            <Button variant="gold" size="sm">Agendar</Button>
          </Link>
        </div>
      </nav>

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
