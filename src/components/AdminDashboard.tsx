import { useState, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Scissors,
  LogOut,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  RotateCcw,
  Store,
  Users,
  CalendarDays,
  Shield,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Barbershop = Tables<"barbershops"> & {
  _teamCount?: number;
  _planName?: string;
};

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const STATUS_MAP: Record<string, { label: string; icon: typeof CheckCircle; color: string; badge: string }> = {
  pending: { label: "Pendente", icon: Clock, color: "text-yellow-500", badge: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
  approved: { label: "Aprovada", icon: CheckCircle, color: "text-green-500", badge: "bg-green-500/10 text-green-500 border-green-500/20" },
  rejected: { label: "Rejeitada", icon: XCircle, color: "text-destructive", badge: "bg-destructive/10 text-destructive border-destructive/20" },
};

export function AdminDashboard() {
  const { user, signOut } = useAuth();
  const [barbershops, setBarbershops] = useState<Barbershop[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchBarbershops = useCallback(async () => {
    const { data: shops } = await supabase
      .from("barbershops")
      .select("*")
      .order("created_at", { ascending: false });

    if (!shops) {
      setBarbershops([]);
      setLoading(false);
      return;
    }

    // Fetch team counts and plan names in parallel
    const shopIds = shops.map((s) => s.id);
    const planIds = [...new Set(shops.map((s) => s.plan_id).filter(Boolean))];

    const [rolesRes, plansRes] = await Promise.all([
      supabase.from("user_roles").select("barbershop_id").in("barbershop_id", shopIds),
      planIds.length > 0
        ? supabase.from("plans").select("id, name").in("id", planIds as string[])
        : Promise.resolve({ data: [] }),
    ]);

    const teamCounts: Record<string, number> = {};
    (rolesRes.data || []).forEach((r) => {
      teamCounts[r.barbershop_id] = (teamCounts[r.barbershop_id] || 0) + 1;
    });

    const planMap: Record<string, string> = {};
    (plansRes.data || []).forEach((p) => {
      planMap[p.id] = p.name;
    });

    setBarbershops(
      shops.map((s) => ({
        ...s,
        _teamCount: teamCounts[s.id] || 0,
        _planName: s.plan_id ? planMap[s.plan_id] || "free" : "free",
      }))
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchBarbershops();
  }, [fetchBarbershops]);

  const updateStatus = async (id: string, name: string, status: "approved" | "rejected") => {
    setUpdating(id);
    const { error } = await supabase.from("barbershops").update({ status }).eq("id", id);
    setUpdating(null);

    if (error) {
      toast.error("Erro ao atualizar status.");
      return;
    }

    toast.success(
      status === "approved"
        ? `"${name}" foi aprovada! ✅`
        : `"${name}" foi rejeitada.`
    );
    fetchBarbershops();
  };

  const filtered = filter === "all" ? barbershops : barbershops.filter((s) => s.status === filter);

  const counts = {
    all: barbershops.length,
    pending: barbershops.filter((s) => s.status === "pending").length,
    approved: barbershops.filter((s) => s.status === "approved").length,
    rejected: barbershops.filter((s) => s.status === "rejected").length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-gradient-gold flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-display text-lg text-foreground">Super Admin</h1>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/configuracoes">
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Config</span>
              </Button>
            </Link>
            <Button variant="ghost" size="sm" onClick={() => signOut()}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Store className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">Total</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">{counts.all}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-yellow-500" />
                <span className="text-xs text-muted-foreground">Pendentes</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">{counts.pending}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-xs text-muted-foreground">Aprovadas</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">{counts.approved}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-destructive" />
                <span className="text-xs text-muted-foreground">Rejeitadas</span>
              </div>
              <p className="text-2xl font-display font-bold text-foreground">{counts.rejected}</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
          <TabsList>
            <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
            <TabsTrigger value="pending">Pendentes ({counts.pending})</TabsTrigger>
            <TabsTrigger value="approved">Aprovadas ({counts.approved})</TabsTrigger>
            <TabsTrigger value="rejected">Rejeitadas ({counts.rejected})</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Store className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                Nenhuma barbearia {filter !== "all" ? `com status "${filter}"` : "cadastrada"}.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((shop) => {
              const statusCfg = STATUS_MAP[shop.status] || STATUS_MAP.pending;
              const isPending = shop.status === "pending";
              const isUpdating = updating === shop.id;
              const createdDate = new Date(shop.created_at).toLocaleDateString("pt-BR");

              return (
                <Card key={shop.id} className="bg-card border-border overflow-hidden">
                  <CardContent className="p-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
                      {/* Avatar */}
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {shop.logo_url ? (
                          <img
                            src={shop.logo_url}
                            alt={shop.name}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                          />
                        ) : (
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                            style={{ backgroundColor: shop.primary_color, color: shop.secondary_color }}
                          >
                            {shop.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-foreground truncate">{shop.name}</p>
                            <Badge variant="outline" className={`text-[10px] ${statusCfg.badge}`}>
                              {statusCfg.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{shop.subdomain}.app</p>
                        </div>
                      </div>

                      {/* Meta */}
                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          {shop._teamCount}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarDays className="w-3.5 h-3.5" />
                          {shop.appointments_this_month} ags
                        </span>
                        <Badge variant="secondary" className="text-[10px] capitalize">
                          {shop._planName}
                        </Badge>
                        <span className="hidden sm:inline">{createdDate}</span>
                      </div>

                      {/* Actions */}
                      {isPending && (
                        <div className="flex gap-1.5 flex-shrink-0">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white text-xs h-8"
                            onClick={() => updateStatus(shop.id, shop.name, "approved")}
                            disabled={isUpdating}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            Aprovar
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive border-destructive/30 hover:bg-destructive/10 text-xs h-8"
                            onClick={() => updateStatus(shop.id, shop.name, "rejected")}
                            disabled={isUpdating}
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Rejeitar
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
