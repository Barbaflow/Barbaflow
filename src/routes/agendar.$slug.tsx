import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicBookingWizard } from "@/components/booking/PublicBookingWizard";
import { PoliciesBanner } from "@/components/booking/PoliciesBanner";
import { ProductsShowcase } from "@/components/ProductsShowcase";
import { ReviewsShowcase } from "@/components/ReviewsShowcase";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Eye, LayoutDashboard, Scissors } from "lucide-react";
import { TenantThemeColors } from "@/components/TenantThemeProvider";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Recorte público da barbearia, servido pela view `barbearias_publicas`
 * (migration 20260804120000). Antes esta tela fazia `select("*")` na tabela
 * `barbershops`, que devolve 36 colunas ao visitante anônimo — inclusive
 * owner_id, plan_id, appointments_this_month e os campos de recibo.
 *
 * `branding_enabled` chega pronto da view e substitui a consulta que esta tela
 * fazia a `plans` para decidir a mesma coisa.
 */
interface PublicBarbershop {
  id: string;
  name: string;
  subdomain: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  reschedule_min_hours: number;
  cancel_min_hours: number;
  noshow_policy_enabled: boolean;
  noshow_max_count: number;
  noshow_block_days: number;
  branding_enabled: boolean;
}

const PUBLIC_BARBERSHOP_COLUMNS =
  "id, name, subdomain, logo_url, primary_color, secondary_color, " +
  "reschedule_min_hours, cancel_min_hours, noshow_policy_enabled, " +
  "noshow_max_count, noshow_block_days, branding_enabled";

export const Route = createFileRoute("/agendar/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Agendar Horário — ${params.slug} — BarbaFlow` },
      { name: "description", content: "Agende seu horário na barbearia de forma rápida e fácil." },
      { property: "og:title", content: `Agende seu Horário — BarbaFlow` },
      { property: "og:description", content: "Agende seu horário na barbearia de forma rápida e fácil." },
    ],
    links: [
      { rel: "canonical", href: `https://barbaflow-delta.vercel.app/agendar/${params.slug}` },
    ],
  }),
  component: AgendarSlugPage,
});

function AgendarSlugPage() {
  const { slug } = Route.useParams();
  const { user, loading } = useAuth();
  // navigate removed: admin/barber are not redirected away from their own public booking page
  const [barbershop, setBarbershop] = useState<PublicBarbershop | null>(null);
  const [loadingShop, setLoadingShop] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isStaff, setIsStaff] = useState(false); // admin/barber/super_admin viewing their own page
  const roleCheckDone = useRef(false);

  useEffect(() => {
    (async () => {
      // A view já garante `approved` e exclui a sentinela; o filtro de status
      // permanece como defesa em profundidade.
      const { data } = await (supabase as any)
        .from("barbearias_publicas")
        .select(PUBLIC_BARBERSHOP_COLUMNS)
        .eq("subdomain", slug)
        .eq("status", "approved")
        .maybeSingle();

      if (data) {
        setBarbershop(data as PublicBarbershop);
      } else {
        setNotFound(true);
      }
      setLoadingShop(false);
    })();
  }, [slug]);

  const canApplyBranding = barbershop?.branding_enabled === true;

  // Detect staff (admin/barber/super_admin) for preview banner.
  // Auto-assign 'cliente' role for path-based access if user has no role yet in this barbershop.
  useEffect(() => {
    if (!user || loading || loadingShop || !barbershop || roleCheckDone.current) return;
    roleCheckDone.current = true;

    (async () => {
      const { data: isSuperAdmin } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "super_admin",
      });

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("barbershop_id", barbershop.id);

      const roleList = (roles || []).map((r) => r.role);
      const staff = !!isSuperAdmin || roleList.includes("admin_barbearia") || roleList.includes("barbeiro");
      setIsStaff(staff);

      // No role yet in this barbershop → auto-assign cliente (only if not staff)
      if (!staff && roleList.length === 0) {
        await supabase.from("user_roles").insert({
          user_id: user.id,
          barbershop_id: barbershop.id,
          role: "cliente" as const,
        });
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
      {canApplyBranding && (
        <TenantThemeColors
          primary={barbershop?.primary_color}
          secondary={barbershop?.secondary_color}
        />
      )}
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
          {user && (
            <Link to="/meus-agendamentos">
              <Button variant="ghost" size="sm">Meus Agendamentos</Button>
            </Link>
          )}
          {user && (
            <Link to="/perfil">
              <Button variant="ghost" size="sm">Perfil</Button>
            </Link>
          )}
          {!user && !loading && (
            <Link to="/login" search={{ redirect: `/agendar/${slug}` }}>
              <Button variant="gold" size="sm">Entrar</Button>
            </Link>
          )}
        </div>
      </nav>

      {isStaff && (
        <div className="border-b border-gold/30 bg-gold/10">
          <div className="max-w-4xl mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs sm:text-sm text-foreground">
              <Eye className="w-4 h-4 text-gold flex-shrink-0" />
              <span>
                <span className="font-medium">Modo visualização:</span>{" "}
                <span className="text-muted-foreground">você está vendo sua página pública como um cliente.</span>
              </span>
            </div>
            <Link to="/dashboard" search={{ checkout: undefined }}>
              <Button variant="gold" size="sm" className="h-8">
                <LayoutDashboard className="w-3.5 h-3.5" />
                Voltar ao painel
              </Button>
            </Link>
          </div>
        </div>
      )}

      <main className="max-w-4xl mx-auto px-6 py-10">
        <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-2">
          <span className="text-gradient-gold">Agendar</span> Horário
        </h1>
        <p className="text-muted-foreground mb-8">
          Escolha o barbeiro, serviço e horário desejado.
        </p>

        {!user && !loading && (
          <div className="mb-6 p-4 rounded-lg border border-gold/30 bg-gold/5 text-sm text-foreground">
            <Link to="/login" search={{ redirect: `/agendar/${slug}` }} className="text-gold underline">Faça login</Link>{" "}
            para confirmar seu agendamento.
          </div>
        )}

        {barbershop && (
          <PoliciesBanner
            rescheduleMinHours={barbershop.reschedule_min_hours}
            cancelMinHours={barbershop.cancel_min_hours}
            noshowEnabled={barbershop.noshow_policy_enabled}
            noshowMaxCount={barbershop.noshow_max_count}
            noshowBlockDays={barbershop.noshow_block_days}
          />
        )}

        <PublicBookingWizard preselectedBarbershopId={barbershop?.id} />

        {barbershop?.id && (
          <div className="mt-12">
            <ReviewsShowcase barbershopId={barbershop.id} />
          </div>
        )}

        {barbershop?.id && (
          <div className="mt-12">
            <ProductsShowcase barbershopId={barbershop.id} />
          </div>
        )}
      </main>
    </div>
  );
}
