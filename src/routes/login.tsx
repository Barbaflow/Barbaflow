import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";
import { useAuth } from "@/hooks/use-auth";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login — BarbaFlow" },
      { name: "description", content: "Acesse sua conta no BarbaFlow para gerenciar sua barbearia ou agendar horários." },
      { property: "og:title", content: "Login — BarbaFlow" },
      { property: "og:description", content: "Acesse sua conta no BarbaFlow para gerenciar sua barbearia ou agendar horários." },
      { property: "og:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Login — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-pro.lovable.app/og-image.jpg" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard", search: { checkout: undefined } });
    }
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <AuthForm />
    </div>
  );
}
