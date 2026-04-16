import { createFileRoute, Link } from "@tanstack/react-router";
import { BarberReports } from "@/components/BarberReports";
import { useCanAccessFeature } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Crown, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios — BarbaFlow" },
      { name: "description", content: "Relatórios e métricas detalhadas da sua barbearia." },
      { property: "og:title", content: "Relatórios — BarbaFlow" },
      { property: "og:description", content: "Relatórios e métricas detalhadas da sua barbearia." },
      { property: "og:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Relatórios — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
    ],
  }),
  component: RelatoriosPage,
});

function RelatoriosPage() {
  const { canAccess, loading } = useCanAccessFeature("reports");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Crown className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-display font-bold text-foreground">
            Relatórios Avançados
          </h1>
          <p className="text-muted-foreground font-body">
            Os relatórios detalhados estão disponíveis a partir do plano Pro.
            Faça upgrade para acessar gráficos de receita, agendamentos e desempenho.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/upgrade">
              <Button variant="gold" size="lg">
                <Crown className="w-4 h-4" />
                Fazer upgrade
              </Button>
            </Link>
            <Link to="/dashboard" search={{ checkout: undefined }}>
              <Button variant="ghost" size="lg">
                <ArrowLeft className="w-4 h-4" />
                Voltar ao painel
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <BarberReports />;
}
