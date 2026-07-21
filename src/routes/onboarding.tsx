import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { supabase } from "@/integrations/supabase/client";
import { Scissors } from "lucide-react";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Criar Barbearia — BarbaFlow" },
      { name: "description", content: "Configure sua barbearia em poucos passos: nome, subdomínio, logo e cores." },
      { property: "og:title", content: "Crie sua Barbearia — BarbaFlow" },
      { property: "og:description", content: "Configure sua barbearia em poucos passos no BarbaFlow." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Crie sua Barbearia — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  // null = ainda verificando; true = pode criar; false = já tem, redirecionando.
  const [canCreate, setCanCreate] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", replace: true });
    }
  }, [user, loading, navigate]);

  // Guard: quem já tem papel de equipe ou já é dono de uma barbearia não passa
  // por aqui de novo. Sem isto, um dono órfão (barbearia criada, vínculo não)
  // criaria uma SEGUNDA barbearia ao voltar para /onboarding.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;

    (async () => {
      const [{ data: roles }, { data: owned }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin_barbearia", "barbeiro", "super_admin"])
          .limit(1)
          .maybeSingle(),
        supabase
          .from("barbershops")
          .select("id")
          .eq("owner_id", user.id)
          .neq("subdomain", "_system")
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      if (roles || owned) {
        setCanCreate(false);
        navigate({ to: "/dashboard", search: { checkout: undefined }, replace: true });
        return;
      }
      setCanCreate(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading, navigate]);

  if (loading || !user || canCreate !== true) {
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
