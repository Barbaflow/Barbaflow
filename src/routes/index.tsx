import { createFileRoute } from "@tanstack/react-router";
import { LandingHero } from "@/components/LandingHero";

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
  return <LandingHero />;
}
