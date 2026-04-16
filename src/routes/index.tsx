import { createFileRoute } from "@tanstack/react-router";
import { LandingHero } from "@/components/LandingHero";
import { useBarbershop } from "@/hooks/use-barbershop";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BarbaFlow — Agendamento Inteligente para Barbearias" },
      { name: "description", content: "Plataforma white-label de agendamento para barbearias. Crie seu subdomínio, personalize sua marca e gerencie sua equipe." },
      { property: "og:title", content: "BarbaFlow — Agendamento Inteligente para Barbearias" },
      { property: "og:description", content: "Crie seu site de agendamento personalizado, gerencie sua equipe e acompanhe resultados. Comece grátis em minutos." },
      { property: "og:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
      { property: "og:url", content: "https://barbaflow-pro.lovable.app/" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "BarbaFlow — Agendamento Inteligente para Barbearias" },
      { name: "twitter:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
    ],
    links: [
      { rel: "canonical", href: "https://barbaflow-pro.lovable.app/" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "BarbaFlow",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: "Plataforma white-label de agendamento para barbearias.",
          url: "https://barbaflow-pro.lovable.app",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "BRL",
          },
        }),
      },
    ],
  }),
  component: IndexPage,
});

function IndexPage() {
  const { barbershop, isDefault } = useBarbershop();

  return (
    <LandingHero
      barbershopName={barbershop?.name}
      primaryColor={barbershop?.primary_color}
      logoUrl={barbershop?.logo_url ?? undefined}
      isDefault={isDefault}
    />
  );
}
