import { createFileRoute } from "@tanstack/react-router";
import { BarberReports } from "@/components/BarberReports";

export const Route = createFileRoute("/relatorios")({
  component: RelatoriosPage,
});

function RelatoriosPage() {
  return <BarberReports />;
}
