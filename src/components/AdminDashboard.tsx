import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Search,
  ChevronLeft,
  ChevronRight,
  Crown,
  History,
} from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";

type Plan = Tables<"plans">;

type Barbershop = Tables<"barbershops"> & {
  _teamCount?: number;
  _planName?: string;
};

import { NotificationBell } from "@/components/NotificationBell";

type StatusFilter = "all" | "pending" | "approved" | "rejected";

const PAGE_SIZE = 10;

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
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [changingPlan, setChangingPlan] = useState<string | null>(null);

  // Fetch all plans once
  useEffect(() => {
    supabase.from("plans").select("*").order("price", { ascending: true }).then(({ data }) => {
      if (data) setPlans(data);
    });
  }, []);

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

  const updateStatus = async (id: string, name: string, status: "approved" | "rejected" | "pending") => {
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
        : status === "rejected"
          ? `"${name}" foi rejeitada.`
          : `"${name}" voltou para pendente.`
    );
    fetchBarbershops();
  };

  const changePlan = async (shopId: string, shopName: string, newPlanId: string) => {
    setChangingPlan(shopId);

    const plan = plans.find((p) => p.id === newPlanId);
    if (!plan) {
      toast.error("Plano inválido.");
      setChangingPlan(null);
      return;
    }

    // Get current plan_id for the log
    const shop = barbershops.find((s) => s.id === shopId);
    const oldPlanId = shop?.plan_id || null;

    if (oldPlanId === newPlanId) {
      setChangingPlan(null);
      return;
    }

    const { error } = await supabase
      .from("barbershops")
      .update({ plan_id: newPlanId })
      .eq("id", shopId);

    if (error) {
      toast.error("Erro ao alterar plano.");
      setChangingPlan(null);
      return;
    }

    // Log the change
    await supabase.from("plan_change_logs").insert({
      barbershop_id: shopId,
      old_plan_id: oldPlanId,
      new_plan_id: newPlanId,
      changed_by: user!.id,
    });

    setChangingPlan(null);
    toast.success(`Plano de "${shopName}" alterado para ${plan.name.toUpperCase()}.`);
    fetchBarbershops();
    fetchLogs();
  };

  // Plan change logs
  const [logs, setLogs] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("plan_change_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setLogs(data || []);
  }, []);

  useEffect(() => {
    if (showLogs) fetchLogs();
  }, [showLogs, fetchLogs]);

  const filtered = useMemo(() => {
    let list = filter === "all" ? barbershops : barbershops.filter((s) => s.status === filter);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.subdomain.toLowerCase().includes(q)
      );
    }

    return list;
  }, [barbershops, filter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safeCurrentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((safeCurrentPage - 1) * PAGE_SIZE, safeCurrentPage * PAGE_SIZE);

  // Reset page when filter/search changes
  useEffect(() => {
    setPage(1);
  }, [filter, searchQuery]);

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
            <Button
              variant={showLogs ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setShowLogs((v) => !v)}
            >
              <History className="w-4 h-4" />
              <span className="hidden sm:inline">Histórico</span>
            </Button>
            <Link to="/configuracoes">
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Config</span>
              </Button>
            </Link>
            <NotificationBell />
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

        {/* Search + Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou subdomínio..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
              <TabsTrigger value="pending">Pendentes ({counts.pending})</TabsTrigger>
              <TabsTrigger value="approved">Aprovadas ({counts.approved})</TabsTrigger>
              <TabsTrigger value="rejected">Rejeitadas ({counts.rejected})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card className="bg-card border-border">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                {searchQuery.trim() ? (
                  <Search className="w-6 h-6 text-muted-foreground" />
                ) : (
                  <Store className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                {searchQuery.trim()
                  ? `Nenhum resultado para "${searchQuery}".`
                  : `Nenhuma barbearia ${filter !== "all" ? `com status "${filter}"` : "cadastrada"}.`}
              </p>
              {searchQuery.trim() && (
                <Button variant="ghost" size="sm" onClick={() => setSearchQuery("")}>
                  Limpar busca
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-2">
              {paginated.map((shop) => {
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
                          <Select
                            value={shop.plan_id || ""}
                            onValueChange={(val) => changePlan(shop.id, shop.name, val)}
                            disabled={changingPlan === shop.id}
                          >
                            <SelectTrigger className="h-6 w-[90px] text-[10px] capitalize border-border">
                              <Crown className="w-3 h-3 mr-1 text-primary" />
                              <SelectValue placeholder="Plano" />
                            </SelectTrigger>
                            <SelectContent>
                              {plans.map((p) => (
                                <SelectItem key={p.id} value={p.id} className="text-xs capitalize">
                                  {p.name} — R${Number(p.price).toFixed(0)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="hidden sm:inline">{createdDate}</span>
                        </div>

                        {/* Actions */}
                        {isPending ? (
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
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-destructive border-destructive/30 hover:bg-destructive/10 text-xs h-8"
                                  disabled={isUpdating}
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  Rejeitar
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Rejeitar "{shop.name}"?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Essa barbearia não poderá receber agendamentos enquanto estiver rejeitada. Você pode reverter depois.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    onClick={() => updateStatus(shop.id, shop.name, "rejected")}
                                  >
                                    Confirmar rejeição
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs h-8 text-muted-foreground hover:text-foreground"
                              disabled={isUpdating}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Reverter
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reverter "{shop.name}" para pendente?</AlertDialogTitle>
                              <AlertDialogDescription>
                                O status atual ({STATUS_MAP[shop.status]?.label}) será alterado para pendente novamente.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction onClick={() => updateStatus(shop.id, shop.name, "pending")}>
                                Confirmar reversão
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-muted-foreground">
                  {filtered.length} resultado{filtered.length !== 1 ? "s" : ""} — Página {safeCurrentPage} de {totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safeCurrentPage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <Button
                      key={n}
                      variant={n === safeCurrentPage ? "default" : "outline"}
                      size="icon"
                      className="h-8 w-8 text-xs"
                      onClick={() => setPage(n)}
                    >
                      {n}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    disabled={safeCurrentPage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        {/* Plan Change Logs */}
        {showLogs && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <History className="w-4 h-4 text-primary" />
                <h3 className="font-display text-sm font-semibold text-foreground">Histórico de alterações de plano</h3>
              </div>
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma alteração registrada.</p>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {logs.map((log) => {
                    const shopName = barbershops.find((s) => s.id === log.barbershop_id)?.name || "Barbearia removida";
                    const oldPlan = plans.find((p) => p.id === log.old_plan_id)?.name || "nenhum";
                    const newPlan = plans.find((p) => p.id === log.new_plan_id)?.name || "—";
                    const date = new Date(log.created_at).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", year: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    });

                    return (
                      <div key={log.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md bg-muted/50 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <Crown className="w-3 h-3 text-primary flex-shrink-0" />
                          <span className="font-medium text-foreground truncate">{shopName}</span>
                          <span className="text-muted-foreground">
                            <span className="capitalize">{oldPlan}</span>
                            {" → "}
                            <span className="capitalize font-semibold text-foreground">{newPlan}</span>
                          </span>
                        </div>
                        <span className="text-muted-foreground flex-shrink-0">{date}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
