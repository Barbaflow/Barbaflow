import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/convite")({
  head: () => ({
    meta: [
      { title: "Aceitar Convite — BarbaFlow" },
      { name: "description", content: "Aceite um convite para fazer parte da equipe de uma barbearia no BarbaFlow." },
      { property: "og:title", content: "Você foi convidado — BarbaFlow" },
      { property: "og:description", content: "Aceite o convite e entre para a equipe da barbearia." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Você foi convidado — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  component: ConvitePage,
});

function ConvitePage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const [barbershopId, setBarbershopId] = useState<string | null>(null);

  const token = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("token")
    : null;

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Redirect to login with return URL
      const returnUrl = `/convite?token=${token}`;
      navigate({ to: "/login", search: { redirect: returnUrl } });
      return;
    }

    if (!token) {
      setStatus("error");
      setMessage("Link de convite inválido.");
      return;
    }

    // Accept invitation
    supabase
      .rpc("accept_team_invitation", { _token: token })
      .then(({ data, error }) => {
        if (error) {
          setStatus("error");
          setMessage("Erro ao processar convite. Tente novamente.");
          return;
        }

        const result = data as unknown as { success: boolean; error?: string; barbershop_id?: string };
        if (result.success) {
          setStatus("success");
          setMessage("Convite aceito! Você agora faz parte da equipe.");
          setBarbershopId(result.barbershop_id || null);
        } else {
          setStatus("error");
          setMessage(result.error || "Erro ao aceitar convite.");
        }
      });
  }, [user, authLoading, token, navigate]);

  if (authLoading || status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Processando convite...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="bg-card border-border max-w-md w-full">
        <CardContent className="p-8 text-center space-y-4">
          {status === "success" ? (
            <>
              <div className="h-16 w-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <h1 className="text-xl font-display font-bold text-foreground">
                Bem-vindo à equipe!
              </h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Link to="/dashboard" search={{ checkout: undefined }}>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Ir para o Dashboard
                </Button>
              </Link>
            </>
          ) : (
            <>
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <XCircle className="w-8 h-8 text-destructive" />
              </div>
              <h1 className="text-xl font-display font-bold text-foreground">
                Ops!
              </h1>
              <p className="text-sm text-muted-foreground">{message}</p>
              <Link to="/">
                <Button variant="outline">Voltar ao Início</Button>
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
