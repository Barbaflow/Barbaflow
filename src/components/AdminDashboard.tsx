import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Scissors, LogOut, CheckCircle, XCircle, Clock } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Barbershop = Tables<"barbershops">;

export function AdminDashboard() {
  const { user, signOut } = useAuth();
  const [barbershops, setBarbershops] = useState<Barbershop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBarbershops();
  }, []);

  const fetchBarbershops = async () => {
    const { data } = await supabase.from("barbershops").select("*").order("created_at", { ascending: false });
    setBarbershops(data || []);
    setLoading(false);
  };

  const updateStatus = async (id: string, status: "approved" | "rejected") => {
    await supabase.from("barbershops").update({ status }).eq("id", id);
    fetchBarbershops();
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "approved": return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "rejected": return <XCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-gold-muted" />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full bg-gradient-gold flex items-center justify-center">
            <Scissors className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-lg text-foreground">Super Admin</h1>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => signOut()}>
          <LogOut className="w-4 h-4" />
          Sair
        </Button>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-display text-foreground mb-6">Barbearias cadastradas</h2>

        {loading ? (
          <p className="text-muted-foreground">Carregando...</p>
        ) : barbershops.length === 0 ? (
          <div className="border border-border rounded-lg p-10 text-center">
            <Scissors className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nenhuma barbearia cadastrada ainda.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {barbershops.map((shop) => (
              <div
                key={shop.id}
                className="border border-border rounded-lg p-5 flex items-center justify-between bg-card hover:border-gold/30 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ backgroundColor: shop.primary_color, color: shop.secondary_color }}
                  >
                    {shop.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{shop.name}</p>
                    <p className="text-xs text-muted-foreground">{shop.subdomain}.app</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
                    {statusIcon(shop.status)}
                    {shop.status}
                  </span>
                  {shop.status === "pending" && (
                    <>
                      <Button size="sm" variant="gold" onClick={() => updateStatus(shop.id, "approved")}>
                        Aprovar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => updateStatus(shop.id, "rejected")}>
                        Rejeitar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
