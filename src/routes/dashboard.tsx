import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { AdminDashboard } from "@/components/AdminDashboard";
import { BarberDashboard } from "@/components/BarberDashboard";
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
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

function DashboardPage() {
  const { user, loading } = useAuth();
  const { barbershopId, barbershop, loading: barbershopLoading } = useBarbershop();
  const navigate = useNavigate();
  const { checkout } = Route.useSearch();
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const toastShown = useRef(false);
  const clientRedirectDone = useRef(false);

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
          .then(({ data }) => {
            const allRoles = (data || []).map((r) => r.role);
            if (allRoles.includes("admin_barbearia")) {
              setRole("admin_barbearia");
            } else if (allRoles.includes("barbeiro")) {
              setRole("barbeiro");
            } else {
              setRole(allRoles[0] || "cliente");
            }
            setRoleLoading(false);
          });
      });
  }, [user, barbershopId, barbershopLoading]);

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

  // Cliente — handled by redirect effect above
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

