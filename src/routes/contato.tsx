import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Scissors, ArrowLeft, Send, MapPin, Mail, Phone } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/contato")({
  head: () => ({
    meta: [
      { title: "Contato — BarbaFlow" },
      { name: "description", content: "Entre em contato com o BarbaFlow. Dúvidas, sugestões ou parcerias — estamos prontos para ajudar sua barbearia a crescer." },
      { property: "og:title", content: "Contato — BarbaFlow" },
      { property: "og:description", content: "Entre em contato com o BarbaFlow. Dúvidas, sugestões ou parcerias — estamos prontos para ajudar." },
      { property: "og:url", content: "https://barbaflow-pro.lovable.app/contato" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Contato — BarbaFlow" },
    ],
    links: [
      { rel: "canonical", href: "https://barbaflow-pro.lovable.app/contato" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contato — BarbaFlow",
          url: "https://barbaflow-pro.lovable.app/contato",
        }),
      },
    ],
  }),
  component: ContatoPage,
});

function ContatoPage() {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      toast.error("Preencha os campos obrigatórios.");
      return;
    }

    if (form.name.length > 100 || form.email.length > 255 || form.message.length > 2000) {
      toast.error("Um ou mais campos excederam o limite de caracteres.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      toast.error("Informe um email válido.");
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.from("contact_submissions").insert({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        message: form.message.trim(),
      });

      if (error) throw error;

      setSubmitted(true);
      toast.success("Mensagem enviada com sucesso!");
    } catch {
      toast.error("Erro ao enviar mensagem. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
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

      <main className="relative z-10 flex-1 px-6 md:px-12 py-12 md:py-20">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-4 font-body font-medium">
              Fale Conosco
            </p>
            <h1 className="font-display text-4xl md:text-5xl text-foreground leading-tight mb-4">
              Entre em{" "}
              <span className="bg-gradient-gold bg-clip-text text-transparent">
                Contato
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto">
              Dúvidas, sugestões ou interesse em parcerias? Envie sua mensagem e respondemos em até 24 horas.
            </p>
          </div>

          <div className="grid md:grid-cols-5 gap-10">
            {/* Info cards */}
            <div className="md:col-span-2 space-y-6">
              {[
                { icon: Mail, label: "Email", value: "contato@barbaflow.pro" },
                { icon: Phone, label: "WhatsApp", value: "(11) 99999-9999" },
                { icon: MapPin, label: "Localização", value: "São Paulo, SP — Brasil" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-start gap-4 rounded-xl border border-border bg-card/40 backdrop-blur-sm p-5"
                >
                  <div className="h-10 w-10 rounded-lg bg-gold/10 flex items-center justify-center shrink-0">
                    <item.icon className="w-5 h-5 text-gold" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{item.label}</p>
                    <p className="text-foreground font-medium">{item.value}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Form */}
            <div className="md:col-span-3">
              {submitted ? (
                <div className="rounded-2xl border border-gold/20 bg-card/60 backdrop-blur-sm p-10 text-center animate-in fade-in duration-500">
                  <div className="h-14 w-14 rounded-full bg-gradient-gold flex items-center justify-center mx-auto mb-4 shadow-gold">
                    <Send className="w-6 h-6 text-primary-foreground" />
                  </div>
                  <h2 className="font-display text-2xl text-foreground mb-2">Mensagem enviada!</h2>
                  <p className="text-muted-foreground mb-6">
                    Obrigado pelo contato. Retornaremos em breve.
                  </p>
                  <Button variant="ghost" onClick={() => { setSubmitted(false); setForm({ name: "", email: "", phone: "", message: "" }); }}>
                    Enviar outra mensagem
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={handleSubmit}
                  className="rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-8 space-y-5"
                >
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nome *</Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="Seu nome"
                        value={form.name}
                        onChange={handleChange}
                        maxLength={100}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email *</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        placeholder="seu@email.com"
                        value={form.email}
                        onChange={handleChange}
                        maxLength={255}
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefone / WhatsApp</Label>
                    <Input
                      id="phone"
                      name="phone"
                      placeholder="(11) 99999-9999"
                      value={form.phone}
                      onChange={handleChange}
                      maxLength={20}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Mensagem *</Label>
                    <Textarea
                      id="message"
                      name="message"
                      placeholder="Como podemos ajudar?"
                      value={form.message}
                      onChange={handleChange}
                      maxLength={2000}
                      rows={5}
                      required
                    />
                    <p className="text-xs text-muted-foreground text-right">{form.message.length}/2000</p>
                  </div>
                  <Button type="submit" variant="gold" className="w-full" disabled={loading}>
                    {loading ? "Enviando..." : "Enviar Mensagem"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border px-6 py-6 md:px-12">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {new Date().getFullYear()} BarbaFlow. Todos os direitos reservados.</span>
          <div className="flex gap-6">
            <Link to="/" className="hover:text-foreground transition-colors">Início</Link>
            <Link to="/sobre" className="hover:text-foreground transition-colors">Sobre</Link>
            <Link to="/upgrade" className="hover:text-foreground transition-colors">Planos</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
