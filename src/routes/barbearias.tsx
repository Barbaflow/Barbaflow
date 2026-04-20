import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Scissors, Star, Store } from "lucide-react";

interface PublicBarbershop {
  id: string;
  name: string;
  subdomain: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  rating_avg: number;
  rating_count: number;
  created_at: string;
  isMock?: boolean;
  lastReview?: {
    rating: number;
    comment: string;
    client_name: string;
  } | null;
}

const MOCK_BARBEARIAS: PublicBarbershop[] = [
  {
    id: "mock-1",
    name: "Barbearia Premium SP",
    subdomain: "premium-sp",
    logo_url: null,
    primary_color: "#C8A96E",
    secondary_color: "#1A1A2E",
    rating_avg: 4.8,
    rating_count: 132,
    created_at: new Date().toISOString(),
    isMock: true,
  },
  {
    id: "mock-2",
    name: "Studio Clássico RJ",
    subdomain: "studio-classico-rj",
    logo_url: null,
    primary_color: "#B8956A",
    secondary_color: "#0F1419",
    rating_avg: 4.6,
    rating_count: 87,
    created_at: new Date().toISOString(),
    isMock: true,
  },
  {
    id: "mock-3",
    name: "The Barber House BH",
    subdomain: "barber-house-bh",
    logo_url: null,
    primary_color: "#D4AF7A",
    secondary_color: "#181820",
    rating_avg: 4.9,
    rating_count: 204,
    created_at: new Date().toISOString(),
    isMock: true,
  },
];

export const Route = createFileRoute("/barbearias")({
  head: () => ({
    meta: [
      { title: "Barbearias parceiras — BarbaFlow" },
      { name: "description", content: "Encontre e agende em barbearias parceiras BarbaFlow. Cortes, barbas e tratamentos com profissionais qualificados." },
      { property: "og:title", content: "Barbearias parceiras — BarbaFlow" },
      { property: "og:description", content: "Descubra barbearias parceiras BarbaFlow e agende seu horário online em poucos cliques." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://barbaflow.pro/barbearias" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Barbearias parceiras — BarbaFlow" },
      { name: "twitter:description", content: "Descubra barbearias parceiras BarbaFlow." },
    ],
    links: [{ rel: "canonical", href: "https://barbaflow.pro/barbearias" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Barbearias parceiras BarbaFlow",
          url: "https://barbaflow.pro/barbearias",
        }),
      },
    ],
  }),
  component: BarbeariasPage,
});

function BarbeariasPage() {
  const [barbearias, setBarbearias] = useState<PublicBarbershop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // View `barbearias_publicas` ainda não está nos tipos gerados — cast pontual
      const { data, error } = await (supabase as any)
        .from("barbearias_publicas")
        .select("id, name, subdomain, logo_url, primary_color, secondary_color, rating_avg, rating_count, created_at")
        .order("rating_avg", { ascending: false })
        .order("created_at", { ascending: false });

      if (cancelled) return;

      const list = (!error && data ? (data as PublicBarbershop[]) : []).filter(
        (b) => b.subdomain !== "_system",
      );

      // Em DEV (preview/local), se não houver barbearias reais, mostra mocks para preencher visualmente
      if (list.length === 0 && import.meta.env.DEV) {
        setBarbearias(MOCK_BARBEARIAS);
      } else {
        setBarbearias(list);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-5 md:px-12 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
            <Scissors className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl text-foreground">BarbaFlow</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              Início
            </Button>
          </Link>
          <Link to="/login">
            <Button variant="gold" size="sm">Entrar</Button>
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10 md:py-16">
        <div className="text-center mb-10 md:mb-14">
          <p className="text-sm uppercase tracking-[0.3em] text-gold-muted mb-3 font-body font-medium">
            Marketplace
          </p>
          <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground mb-4">
            Escolha sua <span className="text-gradient-gold">barbearia</span>
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto font-body">
            Barbearias parceiras BarbaFlow prontas para receber seu agendamento.
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card/50 p-6 h-48 animate-pulse"
              />
            ))}
          </div>
        ) : barbearias.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {barbearias.map((b) => (
              <BarbeariaCard key={b.id} b={b} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function BarbeariaCard({ b }: { b: PublicBarbershop }) {
  const initials = b.name
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const cardInner = (
    <div
      className="group relative h-full rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-6 transition-all duration-300 hover:border-gold/40 hover:shadow-gold hover:-translate-y-0.5"
      style={{ borderTop: `3px solid ${b.primary_color}` }}
    >
      {b.isMock && (
        <Badge
          variant="outline"
          className="absolute top-3 right-3 border-gold/30 text-gold text-[10px] px-1.5 py-0 h-5"
        >
          Demo
        </Badge>
      )}

      <div className="flex items-start gap-4 mb-5">
        {b.logo_url ? (
          <img
            src={b.logo_url}
            alt={`Logo da ${b.name}`}
            className="h-14 w-14 rounded-xl object-cover border border-border"
          />
        ) : (
          <div
            className="h-14 w-14 rounded-xl flex items-center justify-center font-display font-bold text-lg text-primary-foreground shrink-0"
            style={{
              background: `linear-gradient(135deg, ${b.primary_color}, ${b.primary_color}cc)`,
            }}
          >
            {initials || <Scissors className="w-6 h-6" />}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg font-semibold text-foreground truncate">
            {b.name}
          </h2>
          <p className="text-xs text-muted-foreground font-body truncate">
            {b.subdomain}.barbaflow.pro
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <RatingDisplay avg={b.rating_avg} count={b.rating_count} />
        <span className="text-sm font-body text-gold opacity-0 group-hover:opacity-100 transition-opacity">
          Agendar →
        </span>
      </div>
    </div>
  );

  if (b.isMock) {
    return <div className="cursor-not-allowed opacity-90">{cardInner}</div>;
  }

  return (
    <Link
      to="/agendar/$slug"
      params={{ slug: b.subdomain }}
      aria-label={`Agendar na ${b.name}`}
    >
      {cardInner}
    </Link>
  );
}

function RatingDisplay({ avg, count }: { avg: number; count: number }) {
  if (count === 0) {
    return (
      <span className="text-xs text-muted-foreground font-body">
        Sem avaliações ainda
      </span>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Star className="w-4 h-4 fill-gold text-gold" />
      <span className="text-sm font-body font-semibold text-foreground">
        {avg.toFixed(1)}
      </span>
      <span className="text-xs text-muted-foreground font-body">({count})</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-16 max-w-md mx-auto">
      <div className="h-16 w-16 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold mx-auto mb-5">
        <Store className="w-8 h-8 text-primary-foreground" />
      </div>
      <h2 className="font-display text-xl font-semibold text-foreground mb-2">
        Em breve, novas barbearias
      </h2>
      <p className="text-muted-foreground font-body mb-6">
        Estamos crescendo. Que tal abrir a sua barbearia aqui?
      </p>
      <Link to="/onboarding">
        <Button variant="gold" size="lg">
          <Store className="w-5 h-5" />
          Abrir minha barbearia
        </Button>
      </Link>
    </div>
  );
}
