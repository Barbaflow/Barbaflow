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
      { name: "description", content: "Painel de controle do BarbaFlow." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: (search.checkout as string) || undefined,
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { user, loading } = useAuth();
  const { barbershopId } = useBarbershop();
  const navigate = useNavigate();
  const { checkout } = Route.useSearch();
  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const toastShown = useRef(false);

  useEffect(() => {
    if (checkout === "success" && !toastShown.current) {
      toastShown.current = true;
      toast.success("Upgrade realizado com sucesso! 🎉", {
        description: "Seu plano foi atualizado. Aproveite todos os recursos.",
      });
      navigate({ to: "/dashboard", search: {}, replace: true });
    }
  }, [checkout, navigate]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login" });
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;

    // Check if super_admin first
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "super_admin" })
      .then(({ data: isSuperAdmin }) => {
        if (isSuperAdmin) {
          setRole("super_admin");
          setRoleLoading(false);
          return;
        }

        // Check barbershop-specific roles
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("barbershop_id", barbershopId)
          .limit(1)
          .single()
          .then(({ data }) => {
            setRole(data?.role || "cliente");
            setRoleLoading(false);
          });
      });
  }, [user, barbershopId]);

  if (loading || !user || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (role === "super_admin") {
    return <AdminDashboard />;
  }

  if (role === "barbeiro" || role === "admin_barbearia") {
    return <BarberDashboard />;
  }

  // Cliente — redirect to history
  navigate({ to: "/meus-agendamentos" });
  return null;
}
