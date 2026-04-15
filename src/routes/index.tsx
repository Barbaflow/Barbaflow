import { createFileRoute } from "@tanstack/react-router";
import { LandingHero } from "@/components/LandingHero";
import { useBarbershop } from "@/hooks/use-barbershop";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BarbaFlow — Agendamento para Barbearias" },
      { name: "description", content: "Plataforma white-label de agendamento para barbearias. Crie seu subdomínio e gerencie sua barbearia." },
      { property: "og:title", content: "BarbaFlow — Agendamento para Barbearias" },
      { property: "og:description", content: "Plataforma white-label de agendamento para barbearias." },
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
