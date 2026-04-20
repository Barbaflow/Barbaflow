import { useEffect, useState, useMemo, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Users,
  Download,
  Ban,
  Unlock,
  ShieldAlert,
  ShieldCheck,
  History,
  StickyNote,
  Pencil,
  Trash2,
  Plus,
  Save,
  Phone,
  MessageCircle,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { displayBRPhone, whatsappUrl } from "@/lib/phone";

export const Route = createFileRoute("/clientes")({
  head: () => ({
    meta: [
      { title: "Clientes — BarbaFlow" },
      { name: "description", content: "Gerencie os clientes da sua barbearia." },
    ],
  }),
  component: ClientesPage,
});

interface ClientRow {
  client_id: string;
  client_name: string;
  client_avatar: string | null;
  client_phone: string | null;
  total_appointments: number;
  completed_count: number;
  noshow_count: number;
  cancelled_count: number;
  first_appointment_at: string | null;
  last_appointment_at: string | null;
  manual_blocked_until: string | null;
  manual_block_reason: string | null;
}

interface AppointmentHistoryRow {
  id: string;
  date: string;
  start_time: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  service: { name: string; price: number } | null;
}

interface NoteRow {
  id: string;
  note: string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_CFG: Record<string, { label: string; icon: typeof CheckCircle; cls: string }> = {
  scheduled: { label: "Agendado", icon: Clock, cls: "text-primary" },
  completed: { label: "Concluído", icon: CheckCircle, cls: "text-green-500" },
  cancelled: { label: "Cancelado", icon: XCircle, cls: "text-destructive" },
  no_show: { label: "Faltou", icon: AlertCircle, cls: "text-yellow-500" },
};

type StatusFilter = "all" | "blocked" | "active" | "noshow";
type SortKey = "name" | "total" | "noshow" | "last";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: { key: SortKey; label: string; defaultDir: SortDir }[] = [
  { key: "name", label: "Nome", defaultDir: "asc" },
  { key: "total", label: "Agendamentos", defaultDir: "desc" },
  { key: "noshow", label: "Faltas", defaultDir: "desc" },
  { key: "last", label: "Último", defaultDir: "desc" },
];

function ClientesPage() {
  const { user, loading: authLoading } = useAuth();
  const { barbershop, barbershopId, loading: shopLoading } = useBarbershop();
  const navigate = useNavigate();

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return 10;
    const stored = Number(window.localStorage.getItem("clientes:pageSize"));
    return [10, 20, 50].includes(stored) ? stored : 10;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("clientes:pageSize", String(pageSize));
  }, [pageSize]);
  const [sortKey, setSortKey] = useState<SortKey>("last");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      const def = SORT_OPTIONS.find((o) => o.key === key)?.defaultDir ?? "asc";
      setSortKey(key);
      setSortDir(def);
    }
  };

  // Block dialog state
  const [blockTarget, setBlockTarget] = useState<ClientRow | null>(null);
  const [blockDays, setBlockDays] = useState(15);
  const [blockReason, setBlockReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // History dialog state
  const [historyTarget, setHistoryTarget] = useState<ClientRow | null>(null);
  const [history, setHistory] = useState<AppointmentHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Notes state
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({});
  const [notesTarget, setNotesTarget] = useState<ClientRow | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [authorNames, setAuthorNames] = useState<Record<string, string>>({});

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/login" });
    }
  }, [authLoading, user, navigate]);

  // Check access (must be admin or barber of the shop)
  useEffect(() => {
    if (!user || !barbershopId) return;
    (async () => {
      const [{ data: isAdmin }, { data: isBarber }, { data: isSuper }] = await Promise.all([
        supabase.rpc("has_role_in_barbershop", {
          _user_id: user.id,
          _barbershop_id: barbershopId,
          _role: "admin_barbearia",
        }),
        supabase.rpc("has_role_in_barbershop", {
          _user_id: user.id,
          _barbershop_id: barbershopId,
          _role: "barbeiro",
        }),
        supabase.rpc("has_role", { _user_id: user.id, _role: "super_admin" }),
      ]);
      setHasAccess(Boolean(isAdmin) || Boolean(isBarber) || Boolean(isSuper));
    })();
  }, [user, barbershopId]);

  const fetchClients = useCallback(async () => {
    if (!hasAccess || !barbershopId) return;
    setLoading(true);
    // RPC not yet in generated types — cast safely
    const { data, error } = await (supabase.rpc as any)("get_barbershop_clients", {
      _barbershop_id: barbershopId,
    });
    if (error) {
      toast.error("Não foi possível carregar os clientes");
      setLoading(false);
      return;
    }
    setRows((data as ClientRow[]) || []);
    setLoading(false);
  }, [hasAccess, barbershopId]);

  useEffect(() => {
    if (hasAccess) fetchClients();
  }, [hasAccess, fetchClients]);

  const filtered = useMemo(() => {
    let list = rows;
    if (statusFilter === "blocked") list = list.filter((r) => Boolean(r.manual_blocked_until));
    if (statusFilter === "active") list = list.filter((r) => !r.manual_blocked_until);
    if (statusFilter === "noshow") list = list.filter((r) => r.noshow_count > 0);

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.client_name.toLowerCase().includes(q) ||
          (r.client_phone || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [rows, statusFilter, search]);

  // Reset to page 1 when filters/search/page-size/sort change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, pageSize, sortKey, sortDir]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const arr = [...filtered];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.client_name.localeCompare(b.client_name, "pt-BR") * dir;
        case "total":
          return (Number(a.total_appointments) - Number(b.total_appointments)) * dir;
        case "noshow":
          return (Number(a.noshow_count) - Number(b.noshow_count)) * dir;
        case "last": {
          const av = a.last_appointment_at ? new Date(a.last_appointment_at).getTime() : 0;
          const bv = b.last_appointment_at ? new Date(b.last_appointment_at).getTime() : 0;
          return (av - bv) * dir;
        }
      }
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [sorted, currentPage, pageSize]
  );

  const stats = useMemo(
    () => ({
      total: rows.length,
      blocked: rows.filter((r) => r.manual_blocked_until).length,
      withNoshow: rows.filter((r) => r.noshow_count > 0).length,
      totalAppointments: rows.reduce((sum, r) => sum + Number(r.total_appointments || 0), 0),
    }),
    [rows]
  );

  const handleBlock = async () => {
    if (!blockTarget || !user) return;
    if (blockDays < 1 || blockDays > 365) {
      toast.error("Informe entre 1 e 365 dias");
      return;
    }
    setSubmitting(true);
    const blockedUntil = new Date(Date.now() + blockDays * 86_400_000).toISOString();
    const { error } = await supabase.from("client_blocks").insert({
      barbershop_id: barbershopId,
      client_id: blockTarget.client_id,
      blocked_until: blockedUntil,
      reason: blockReason.trim() || null,
      blocked_by: user.id,
    });
    setSubmitting(false);
    if (error) {
      toast.error("Erro ao bloquear cliente");
      return;
    }
    toast.success("Cliente bloqueado", {
      description: `Liberado em ${format(new Date(blockedUntil), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`,
    });
    setBlockTarget(null);
    setBlockReason("");
    setBlockDays(15);
    fetchClients();
  };

  const handleUnblock = async (row: ClientRow) => {
    const { error } = await supabase
      .from("client_blocks")
      .delete()
      .eq("barbershop_id", barbershopId)
      .eq("client_id", row.client_id)
      .gt("blocked_until", new Date().toISOString());
    if (error) {
      toast.error("Erro ao desbloquear");
      return;
    }
    toast.success(`${row.client_name} desbloqueado`);
    fetchClients();
  };

  const openHistory = async (row: ClientRow) => {
    setHistoryTarget(row);
    setHistoryLoading(true);
    setHistory([]);
    const { data, error } = await supabase
      .from("appointments")
      .select("id, date, start_time, status, service:services(name, price)")
      .eq("barbershop_id", barbershopId)
      .eq("client_id", row.client_id)
      .order("date", { ascending: false })
      .order("start_time", { ascending: false })
      .limit(100);
    setHistoryLoading(false);
    if (error) {
      toast.error("Erro ao carregar histórico");
      return;
    }
    setHistory((data as unknown as AppointmentHistoryRow[]) || []);
  };

  const exportCSV = () => {
    if (filtered.length === 0) {
      toast.info("Nada para exportar");
      return;
    }
    const headers = [
      "Nome",
      "Telefone",
      "Total agendamentos",
      "Concluídos",
      "Faltas",
      "Cancelados",
      "Primeiro agendamento",
      "Último agendamento",
      "Bloqueado até",
      "Motivo do bloqueio",
    ];
    const lines = filtered.map((r) =>
      [
        r.client_name,
        r.client_phone || "",
        r.total_appointments,
        r.completed_count,
        r.noshow_count,
        r.cancelled_count,
        r.first_appointment_at ? format(new Date(r.first_appointment_at), "dd/MM/yyyy") : "",
        r.last_appointment_at ? format(new Date(r.last_appointment_at), "dd/MM/yyyy") : "",
        r.manual_blocked_until ? format(new Date(r.manual_blocked_until), "dd/MM/yyyy") : "",
        r.manual_block_reason || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = "\uFEFF" + [headers.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `clientes-${barbershop?.subdomain || "barbearia"}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} clientes exportados`);
  };

  if (authLoading || shopLoading || hasAccess === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <ShieldAlert className="w-12 h-12 text-destructive mx-auto" />
            <h1 className="font-display text-xl">Acesso negado</h1>
            <p className="text-sm text-muted-foreground">
              Apenas administradores e barbeiros desta barbearia podem acessar a lista de clientes.
            </p>
            <Link to="/dashboard">
              <Button variant="outline">Voltar ao painel</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Voltar</span>
              </Button>
            </Link>
            <div className="h-9 w-9 rounded-full bg-gradient-gold flex items-center justify-center">
              <Users className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-lg text-foreground truncate">Clientes</h1>
              <p className="text-xs text-muted-foreground truncate">
                {barbershop?.name || "Sua barbearia"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={fetchClients} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Clientes" value={stats.total} icon={Users} color="text-primary" />
          <StatCard
            label="Agendamentos"
            value={stats.totalAppointments}
            icon={Clock}
            color="text-foreground"
          />
          <StatCard
            label="Com falta"
            value={stats.withNoshow}
            icon={AlertCircle}
            color="text-yellow-500"
          />
          <StatCard
            label="Bloqueados"
            value={stats.blocked}
            icon={ShieldAlert}
            color="text-destructive"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos ({stats.total})</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="noshow">Com falta ({stats.withNoshow})</SelectItem>
              <SelectItem value="blocked">Bloqueados ({stats.blocked})</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <Users className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                {rows.length === 0
                  ? "Nenhum cliente cadastrou agendamento ainda."
                  : search.trim()
                    ? `Nenhum resultado para "${search}".`
                    : "Nenhum cliente neste filtro."}
              </p>
              {rows.length === 0 && barbershop?.subdomain && (
                <p className="text-xs text-muted-foreground max-w-md">
                  Compartilhe seu link público{" "}
                  <code className="px-1 py-0.5 rounded bg-muted">
                    /agendar/{barbershop.subdomain}
                  </code>{" "}
                  para começar a receber clientes.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Sort header */}
            <div className="flex items-center gap-1 px-3 py-2 rounded-lg bg-muted/40 border border-border overflow-x-auto">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground mr-2 flex-shrink-0">
                Ordenar:
              </span>
              {SORT_OPTIONS.map((opt) => {
                const active = sortKey === opt.key;
                const Icon = active ? (sortDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <Button
                    key={opt.key}
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 px-2 text-xs flex-shrink-0"
                    onClick={() => handleSort(opt.key)}
                  >
                    {opt.label}
                    <Icon
                      className={`w-3 h-3 ml-1 ${active ? "text-primary" : "text-muted-foreground/60"}`}
                    />
                  </Button>
                );
              })}
            </div>

            <div className="space-y-2">
              {paginated.map((row) => (
                <ClientRowCard
                  key={row.client_id}
                  row={row}
                  onHistory={() => openHistory(row)}
                  onBlock={() => setBlockTarget(row)}
                  onUnblock={() => handleUnblock(row)}
                />
              ))}
            </div>

            {/* Pagination */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
              <p className="text-xs text-muted-foreground">
                Mostrando{" "}
                <span className="font-medium text-foreground">
                  {(currentPage - 1) * pageSize + 1}–
                  {Math.min(currentPage * pageSize, filtered.length)}
                </span>{" "}
                de <span className="font-medium text-foreground">{filtered.length}</span>{" "}
                {filtered.length === 1 ? "cliente" : "clientes"}
              </p>
              <div className="flex items-center gap-2">
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-8 w-[88px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10 / pág</SelectItem>
                    <SelectItem value="20">20 / pág</SelectItem>
                    <SelectItem value="50">50 / pág</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="hidden sm:inline ml-1">Anterior</span>
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums px-1">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                >
                  <span className="hidden sm:inline mr-1">Próximo</span>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Block dialog */}
      <Dialog open={Boolean(blockTarget)} onOpenChange={(o) => !o && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              Bloquear {blockTarget?.client_name}
            </DialogTitle>
            <DialogDescription>
              Enquanto bloqueado, o cliente não conseguirá criar novos agendamentos. Você ainda pode
              agendar manualmente por ele se necessário.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="block-days">Dias de bloqueio</Label>
              <Input
                id="block-days"
                type="number"
                min={1}
                max={365}
                value={blockDays}
                onChange={(e) => setBlockDays(Number(e.target.value))}
                className="mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Libera em{" "}
                {format(new Date(Date.now() + blockDays * 86_400_000), "dd/MM/yyyy 'às' HH:mm", {
                  locale: ptBR,
                })}
              </p>
            </div>
            <div>
              <Label htmlFor="block-reason">Motivo (opcional)</Label>
              <Textarea
                id="block-reason"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                placeholder="Ex: 3 faltas seguidas sem aviso"
                className="mt-1.5"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockTarget(null)} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleBlock} disabled={submitting}>
              <ShieldCheck className="w-4 h-4" />
              Confirmar bloqueio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* History dialog */}
      <Dialog open={Boolean(historyTarget)} onOpenChange={(o) => !o && setHistoryTarget(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              Histórico de {historyTarget?.client_name}
            </DialogTitle>
            <DialogDescription>
              Todos os agendamentos deste cliente na sua barbearia.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto space-y-2 py-2">
            {historyLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-8">
                Nenhum agendamento encontrado.
              </p>
            ) : (
              history.map((h) => {
                const cfg = STATUS_CFG[h.status] || STATUS_CFG.scheduled;
                const Icon = cfg.icon;
                return (
                  <div
                    key={h.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background/40"
                  >
                    <Icon className={`w-4 h-4 flex-shrink-0 ${cfg.cls}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {h.service?.name || "Serviço removido"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(h.date + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })} ·{" "}
                        {h.start_time.slice(0, 5)}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant="outline" className="text-[10px]">
                        {cfg.label}
                      </Badge>
                      {h.service?.price ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          R$ {Number(h.service.price).toFixed(2)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`w-4 h-4 ${color}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-2xl font-display font-bold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function ClientRowCard({
  row,
  onHistory,
  onBlock,
  onUnblock,
}: {
  row: ClientRow;
  onHistory: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  const blocked = Boolean(row.manual_blocked_until);
  const noshowRate =
    row.total_appointments > 0
      ? Math.round((Number(row.noshow_count) / Number(row.total_appointments)) * 100)
      : 0;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Identity */}
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Avatar className="h-10 w-10">
              <AvatarImage src={row.client_avatar || undefined} />
              <AvatarFallback>{row.client_name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-foreground truncate">{row.client_name}</p>
                {blocked && (
                  <Badge variant="outline" className="text-[10px] border-destructive/40 bg-destructive/10 text-destructive">
                    <ShieldAlert className="w-3 h-3 mr-1" />
                    Bloqueado
                  </Badge>
                )}
                {row.noshow_count > 0 && !blocked && (
                  <Badge variant="outline" className="text-[10px] border-yellow-500/40 bg-yellow-500/10 text-yellow-500">
                    {row.noshow_count} falta{row.noshow_count > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {row.total_appointments} agendamento{Number(row.total_appointments) !== 1 ? "s" : ""}
                {row.completed_count > 0 && <> · {row.completed_count} concluído{Number(row.completed_count) > 1 ? "s" : ""}</>}
                {noshowRate > 0 && <> · {noshowRate}% faltas</>}
                {row.last_appointment_at && (
                  <> · último: {format(new Date(row.last_appointment_at), "dd/MM/yy", { locale: ptBR })}</>
                )}
              </p>
              {row.client_phone && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {displayBRPhone(row.client_phone)}
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
            {(() => {
              const wa = whatsappUrl(row.client_phone);
              return wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" title="Abrir WhatsApp">
                  <Button size="sm" variant="ghost">
                    <MessageCircle className="w-3.5 h-3.5" />
                  </Button>
                </a>
              ) : null;
            })()}
            <Button size="sm" variant="ghost" onClick={onHistory} title="Ver histórico">
              <History className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Histórico</span>
            </Button>
            {blocked ? (
              <Button size="sm" variant="outline" onClick={onUnblock}>
                <Unlock className="w-3.5 h-3.5" />
                Desbloquear
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={onBlock}>
                <Ban className="w-3.5 h-3.5" />
                Bloquear
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
