import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { AdminDashboard } from "@/components/AdminDashboard";
import { BarberDashboard } from "@/components/BarberDashboard";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — BarbaFlow" },
      { name: "description", content: "Painel de controle da sua barbearia. Gerencie agendamentos, equipe e serviços." },
      { property: "og:title", content: "Dashboard — BarbaFlow" },
      { property: "og:description", content: "Painel de controle da sua barbearia no BarbaFlow." },
      { property: "og:image", content: "https://barbaflow.pro/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Dashboard — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow.pro/og-image.jpg" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: (search.checkout as string) || undefined,
  }),
  component: DashboardPage,
});

/** Estados sintéticos de papel — não existem em public.app_role. */
const NEEDS_ONBOARDING = "__needs_onboarding__";
const ORPHAN_OWNER = "__orphan_owner__";

type OrphanShop = { id: string; name: string; subdomain: string };

function DashboardPage() {
  const { user, loading } = useAuth();
  // `resolvedBarbershopId` (null enquanto não resolvido) no lugar do legado
  // `barbershopId`, que nunca é null e cai no uuid da barbearia do mock. Aqui
  // ele só serve de dependência do efeito de papel — nenhuma consulta o usa —,
  // mas ler o campo legado convidava a exatamente esse erro.
  const { resolvedBarbershopId, barbershop, loading: barbershopLoading } = useBarbershop();
  const navigate = useNavigate();
  const { checkout } = Route.useSearch();
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [orphanShop, setOrphanShop] = useState<OrphanShop | null>(null);
  const [repairing, setRepairing] = useState(false);
  const toastShown = useRef(false);
  const clientRedirectDone = useRef(false);
  const onboardingRedirectDone = useRef(false);

  useEffect(() => {
    if (checkout === "success" && !toastShown.current) {
      toastShown.current = true;
      toast.success("Upgrade realizado com sucesso! 🎉", {
        description: "Seu plano foi atualizado. Aproveite todos os recursos.",
      });
      navigate({ to: "/dashboard", search: { checkout: undefined }, replace: true });
    }
  }, [checkout, navigate]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: undefined } });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user || barbershopLoading) return;

    // Check if super_admin first
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "super_admin" })
      .then(({ data: isSuperAdmin }) => {
        if (isSuperAdmin) {
          setRole("super_admin");
          setRoleLoading(false);
          return;
        }

        // Check ALL roles for this user across all barbershops.
        // Priority globally: admin_barbearia > barbeiro > cliente.
        // This ensures an admin/barber going to /dashboard always sees the management panel,
        // even if the resolved barbershopId context happens to be one where they're only a client.
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .then(async ({ data }) => {
            const allRoles = (data || []).map((r) => r.role);
            if (allRoles.includes("admin_barbearia")) {
              setRole("admin_barbearia");
              setRoleLoading(false);
              return;
            }
            if (allRoles.includes("barbeiro")) {
              setRole("barbeiro");
              setRoleLoading(false);
              return;
            }
            if (allRoles.length > 0) {
              setRole(allRoles[0]);
              setRoleLoading(false);
              return;
            }

            // Nenhum papel. Antes isto virava "cliente" e o usuário era
            // despachado para /meus-agendamentos — sem nunca chegar ao
            // onboarding. Agora distinguimos os dois casos possíveis:
            //   * já é dono de uma barbearia → o vínculo de admin faltou
            //     (barbearia órfã); oferecemos a recuperação, nunca uma
            //     segunda barbearia;
            //   * não é dono de nada → primeiro acesso: vai para /onboarding.
            const { data: owned } = await supabase
              .from("barbershops")
              .select("id, name, subdomain")
              .eq("owner_id", user.id)
              .neq("subdomain", "_system")
              .limit(1)
              .maybeSingle();

            setOrphanShop(owned ?? null);
            setRole(owned ? ORPHAN_OWNER : NEEDS_ONBOARDING);
            setRoleLoading(false);
          });
      });
  }, [user, resolvedBarbershopId, barbershopLoading]);

  // Sem papel e sem barbearia: onboarding é o destino, automaticamente.
  useEffect(() => {
    if (roleLoading || role !== NEEDS_ONBOARDING || onboardingRedirectDone.current) return;
    onboardingRedirectDone.current = true;
    navigate({ to: "/onboarding", replace: true });
  }, [role, roleLoading, navigate]);

  // Cliente: redirect to the barbershop's booking page (or history as fallback)
  useEffect(() => {
    if (roleLoading || !role || clientRedirectDone.current) return;
    if (role === "cliente") {
      clientRedirectDone.current = true;
      if (barbershop?.subdomain && barbershop.subdomain !== "_system") {
        navigate({ to: "/agendar/$slug", params: { slug: barbershop.subdomain }, replace: true });
      } else {
        navigate({ to: "/meus-agendamentos", replace: true });
      }
    }
  }, [role, roleLoading, barbershop, navigate]);

  /** Cria o vínculo de admin que faltou, sem criar outra barbearia. */
  const repairOrphanOwner = useCallback(async () => {
    if (!user || !orphanShop || repairing) return;
    setRepairing(true);
    const { error } = await supabase.from("user_roles").insert({
      user_id: user.id,
      barbershop_id: orphanShop.id,
      role: "admin_barbearia" as const,
    });
    if (error) {
      setRepairing(false);
      toast.error("Não foi possível concluir a configuração.", { description: error.message });
      return;
    }
    toast.success("Configuração concluída!");
    window.location.reload();
  }, [user, orphanShop, repairing]);

  if (loading || !user || roleLoading || barbershopLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (role === "super_admin") {
    return <AdminDashboard />;
  }

  if (role === "admin_barbearia") {
    return <BarberDashboard isAdmin />;
  }

  if (role === "barbeiro") {
    return <BarberDashboard />;
  }

  // Dono sem vínculo de admin: barbearia existe, papel não. Nunca criamos uma
  // segunda barbearia — oferecemos concluir o vínculo que faltou.
  if (role === ORPHAN_OWNER && orphanShop) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full text-center space-y-5">
          <h1 className="font-display text-2xl text-foreground">Configuração incompleta</h1>
          <p className="text-sm text-muted-foreground">
            Sua barbearia <strong className="text-foreground">{orphanShop.name}</strong> foi criada,
            mas o vínculo de administrador não foi concluído. Nenhuma barbearia nova será criada —
            basta finalizar o vínculo existente.
          </p>
          <Button onClick={repairOrphanOwner} disabled={repairing} className="w-full">
            {repairing ? "Concluindo…" : "Concluir configuração"}
          </Button>
        </div>
      </div>
    );
  }

  // Cliente e "precisa de onboarding" — tratados pelos efeitos de redirect acima
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

