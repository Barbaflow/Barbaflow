import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Scissors, Calendar, Users, Palette, Shield, Zap, ArrowLeft, Rocket } from "lucide-react";

export const Route = createFileRoute("/sobre")({
  head: () => ({
    meta: [
      { title: "Sobre o BarbaFlow — Plataforma de Agendamento para Barbearias" },
      { name: "description", content: "Conheça o BarbaFlow: plataforma white-label de agendamento online para barbearias. Gerencie equipe, serviços e horários em um só lugar." },
      { property: "og:title", content: "Sobre o BarbaFlow — Plataforma de Agendamento para Barbearias" },
      { property: "og:description", content: "Conheça o BarbaFlow: plataforma white-label de agendamento online para barbearias. Gerencie equipe, serviços e horários em um só lugar." },
      { property: "og:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
      { property: "og:url", content: "https://barbaflow-pro.lovable.app/sobre" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Sobre o BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
    ],
    links: [
      { rel: "canonical", href: "https://barbaflow-pro.lovable.app/sobre" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "BarbaFlow",
          url: "https://barbaflow-pro.lovable.app",
          description: "Plataforma white-label de agendamento online para barbearias.",
          applicationCategory: "BusinessApplication",
        }),
      },
    ],
  }),
  component: SobrePage,
});

const features = [
  {
    icon: Calendar,
    title: "Agendamento Online",
    description: "Seus clientes agendam 24h pelo link personalizado da sua barbearia, sem ligações ou mensagens.",
  },
  {
    icon: Users,
    title: "Gestão de Equipe",
    description: "Convide barbeiros, defina horários individuais e acompanhe a agenda de cada profissional.",
  },
  {
    icon: Palette,
    title: "Marca Própria",
    description: "Personalize cores, logo e subdomínio. Cada barbearia tem sua identidade visual única.",
  },
  {
    icon: Shield,
    title: "Segurança & Privacidade",
    description: "Dados protegidos com criptografia, autenticação segura e isolamento total entre barbearias.",
  },
  {
    icon: Zap,
    title: "Notificações em Tempo Real",
    description: "Alertas instantâneos para novos agendamentos, cancelamentos e lembretes automáticos.",
  },
  {
    icon: Scissors,
    title: "Serviços Personalizados",
    description: "Cadastre serviços com preço, duração e disponibilidade por barbeiro. Flexibilidade total.",
  },
];

function SobrePage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(var(--gold) 1px, transparent 1px), linear-gradient(90deg, var(--gold) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
            <Scissors className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl text-foreground">BarbaFlow</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Início
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="gold" size="sm">Entrar</Button>
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 px-6 md:px-12 py-12 md:py-20">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-4 font-body font-medium">
              Sobre a Plataforma
            </p>
            <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-foreground leading-tight mb-6">
              O que é o{" "}
              <span className="bg-gradient-gold bg-clip-text text-transparent">
                BarbaFlow
              </span>
              ?
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              O BarbaFlow é uma plataforma white-label de agendamento criada exclusivamente
              para barbearias. Com ele, você cria seu site de agendamento personalizado,
              gerencia sua equipe e acompanha resultados — tudo em um só lugar.
            </p>
          </div>

          {/* Mission */}
          <section className="mb-20 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-150">
            <div className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-8 md:p-12">
              <h2 className="font-display text-2xl md:text-3xl text-foreground mb-4">
                Nossa Missão
              </h2>
              <p className="text-muted-foreground leading-relaxed text-base md:text-lg">
                Eliminar a burocracia do agendamento em barbearias. Acreditamos que todo
                barbeiro merece uma ferramenta profissional para gerenciar sua agenda,
                sem depender de cadernos, WhatsApp ou planilhas. O BarbaFlow automatiza
                o processo de ponta a ponta, permitindo que você foque no que faz de melhor:
                atender seus clientes.
              </p>
            </div>
          </section>

          {/* Features grid */}
          <section className="mb-20">
            <h2 className="font-display text-2xl md:text-3xl text-foreground text-center mb-10">
              Funcionalidades Principais
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-6 hover:border-gold/30 transition-colors duration-300"
                >
                  <div className="h-10 w-10 rounded-lg bg-gold/10 flex items-center justify-center mb-4">
                    <feature.icon className="w-5 h-5 text-gold" />
                  </div>
                  <h3 className="font-display text-lg text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* How it works */}
          <section className="mb-20">
            <h2 className="font-display text-2xl md:text-3xl text-foreground text-center mb-10">
              Como Funciona
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              {[
                { step: "01", title: "Crie sua Barbearia", desc: "Cadastre-se, escolha seu subdomínio e personalize com suas cores e logo." },
                { step: "02", title: "Configure sua Agenda", desc: "Adicione barbeiros, serviços, horários e bloqueios de folga." },
                { step: "03", title: "Receba Agendamentos", desc: "Compartilhe seu link e receba reservas automaticamente, 24 horas por dia." },
              ].map((item) => (
                <div key={item.step} className="text-center">
                  <div className="inline-flex h-14 w-14 rounded-full bg-gradient-gold items-center justify-center mb-4 shadow-gold">
                    <span className="font-display text-lg text-primary-foreground font-bold">{item.step}</span>
                  </div>
                  <h3 className="font-display text-lg text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="text-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
            <div className="rounded-2xl border border-gold/20 bg-gradient-to-br from-gold/5 to-transparent p-10 md:p-14">
              <Rocket className="w-10 h-10 text-gold mx-auto mb-4" />
              <h2 className="font-display text-2xl md:text-3xl text-foreground mb-3">
                Pronto para começar?
              </h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Crie sua barbearia gratuitamente e comece a receber agendamentos online hoje mesmo.
              </p>
              <Link to="/onboarding">
                <Button variant="gold" size="lg" className="text-base px-8">
                  Criar Minha Barbearia — Grátis
                </Button>
              </Link>
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border px-6 py-6 md:px-12">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} BarbaFlow. Todos os direitos reservados.</span>
          <div className="flex gap-6">
            <Link to="/" className="hover:text-foreground transition-colors">Início</Link>
            <Link to="/login" className="hover:text-foreground transition-colors">Entrar</Link>
            <Link to="/upgrade" className="hover:text-foreground transition-colors">Planos</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
