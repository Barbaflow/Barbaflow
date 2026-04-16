import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { PublicBookingWizard } from "@/components/booking/PublicBookingWizard";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scissors, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Barbershop = Tables<"barbershops">;

export const Route = createFileRoute("/agendar/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Agendar Horário — ${params.slug} — BarbaFlow` },
      { name: "description", content: "Agende seu horário na barbearia de forma rápida e fácil." },
      { property: "og:title", content: `Agende seu Horário — BarbaFlow` },
      { property: "og:description", content: "Agende seu horário na barbearia de forma rápida e fácil." },
    ],
    links: [
      { rel: "canonical", href: `https://barbaflow.pro/agendar/${params.slug}` },
    ],
  }),
  component: AgendarSlugPage,
});

function AgendarSlugPage() {
  const { slug } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const roleCheckDone = useRef(false);

  useEffect(() => {
    supabase
      .from("barbershops")
      .select("*")
      .eq("subdomain", slug)
      .eq("status", "approved")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setBarbershop(data);
        } else {
          setNotFound(true);
        }
        setLoadingShop(false);
      });
  }, [slug]);

  // Check if user is admin/barber — show dashboard button instead of auto-redirect
  useEffect(() => {
    if (!user || loading || loadingShop || !barbershop || roleCheckDone.current) return;
    roleCheckDone.current = true;

    (async () => {
      const { data: isSuperAdmin } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "super_admin",
      });
      if (isSuperAdmin) {
        setIsStaff(true);
        return;
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("barbershop_id", barbershop.id);

      const roleList = (roles || []).map((r) => r.role);
      if (roleList.includes("admin_barbearia") || roleList.includes("barbeiro")) {
        setIsStaff(true);
      }
    })();
  }, [user, loading, loadingShop, barbershop]);

  const name = barbershop?.name || "BarbaFlow";

  if (loadingShop) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-display font-bold text-foreground">Barbearia não encontrada</h1>
        <p className="text-muted-foreground">O link que você acessou não corresponde a nenhuma barbearia.</p>
        <Link to="/agendar">
          <Button variant="gold">Ver todas as barbearias</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-6 py-5 md:px-12 border-b border-border">
        <div className="flex items-center gap-3">
          {barbershop?.logo_url ? (
            <img src={barbershop.logo_url} alt={name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
          <span className="font-display text-xl text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              Voltar
            </Button>
          </Link>
          {!user && !loading && (
            <Link to="/login">
              <Button variant="gold" size="sm">Entrar</Button>
            </Link>
          )}
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          <span className="text-gradient-gold">Agendar</span> Horário
        </h1>
        <p className="text-muted-foreground mb-8">
          Escolha o barbeiro, serviço e horário desejado.
        </p>

        {!user && !loading && (
          <div className="mb-6 p-4 rounded-lg border border-gold/30 bg-gold/5 text-sm text-foreground">
            <Link to="/login" className="text-gold underline">Faça login</Link>{" "}
            para confirmar seu agendamento.
          </div>
        )}

        <PublicBookingWizard preselectedBarbershopId={barbershop?.id} />
      </main>
    </div>
  );
}
