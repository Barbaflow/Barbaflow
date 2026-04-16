import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { Scissors } from "lucide-react";
import { useEffect } from "react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Criar Barbearia — BarbaFlow" },
      { name: "description", content: "Configure sua barbearia em poucos passos: nome, subdomínio, logo e cores." },
      { property: "og:title", content: "Crie sua Barbearia — BarbaFlow" },
      { property: "og:description", content: "Configure sua barbearia em poucos passos no BarbaFlow." },
      { property: "og:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Crie sua Barbearia — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", replace: true });
    }
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-center px-6 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
            <Scissors className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl text-foreground">BarbaFlow</span>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10">
        <OnboardingWizard />
      </main>
    </div>
  );
}
