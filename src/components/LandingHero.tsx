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
                  {["Até 50 agendamentos/mês", "1 barbeiro na equipe", "Subdomínio personalizado", "Agendamento online", "Gestão de agenda"].map((f) => (
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
                  {["Agendamentos ilimitados", "Barbeiros ilimitados", "Personalização de cores e logo", "Relatórios avançados", "Gestão de equipe completa", "Bloqueios de agenda"].map((f) => (
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
                  {["Tudo do Pro", "Personalização de cores e logo", "Suporte prioritário", "Múltiplas unidades (em breve)", "SLA garantido"].map((f) => (
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

      {/* Footer */}
      <footer className="relative z-10 border-t border-border bg-card/30 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 py-12 md:px-12">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            {/* Brand */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-gold flex items-center justify-center">
                  <Scissors className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-display text-lg font-bold text-foreground">BarbaFlow</span>
              </div>
              <p className="text-sm text-muted-foreground font-body leading-relaxed">
                A plataforma completa para barbearias modernas gerenciarem agendamentos, equipe e clientes.
              </p>
            </div>

            {/* Links */}
            <div className="space-y-3">
              <h4 className="font-display text-sm font-semibold text-foreground uppercase tracking-wider">Produto</h4>
              <ul className="space-y-2">
                {[
                  { label: "Criar barbearia", href: "/onboarding" },
                  { label: "Planos e preços", href: "#planos" },
                  { label: "Como funciona", href: "#como-funciona" },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-muted-foreground hover:text-gold transition-colors font-body">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Suporte */}
            <div className="space-y-3">
              <h4 className="font-display text-sm font-semibold text-foreground uppercase tracking-wider">Suporte</h4>
              <ul className="space-y-2">
                {[
                  { label: "Central de ajuda", href: "#" },
                  { label: "Termos de uso", href: "#" },
                  { label: "Política de privacidade", href: "#" },
                ].map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="text-sm text-muted-foreground hover:text-gold transition-colors font-body">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Contato */}
            <div className="space-y-3">
              <h4 className="font-display text-sm font-semibold text-foreground uppercase tracking-wider">Contato</h4>
              <ul className="space-y-2">
                <li className="text-sm text-muted-foreground font-body">contato@barbaflow.com</li>
                <li className="text-sm text-muted-foreground font-body">(11) 99999-9999</li>
              </ul>
              <div className="flex gap-3 pt-1">
                <a href="#" className="text-muted-foreground hover:text-gold transition-colors" aria-label="Instagram">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                </a>
                <a href="#" className="text-muted-foreground hover:text-gold transition-colors" aria-label="WhatsApp">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                </a>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground font-body">
              © {new Date().getFullYear()} BarbaFlow. Todos os direitos reservados.
            </p>
            <p className="text-xs text-muted-foreground font-body">
              Feito com ✂️ para barbearias modernas
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
