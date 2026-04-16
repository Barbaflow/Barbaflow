import { useState, useEffect, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { usePlan } from "@/hooks/use-plan";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus,
  Mail,
  Clock,
  CheckCircle,
  XCircle,
  Trash2,
  Users,
  Shield,
  Copy,
  AlertCircle,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Invitation = Tables<"team_invitations">;

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  profile: { full_name: string | null; avatar_url: string | null } | null;
  email?: string;
}

const ROLE_LABELS: Record<string, string> = {
  barbeiro: "Barbeiro",
  admin_barbearia: "Administrador",
  cliente: "Cliente",
  super_admin: "Super Admin",
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "outline" },
  accepted: { label: "Aceito", variant: "secondary" },
  expired: { label: "Expirado", variant: "destructive" },
  cancelled: { label: "Cancelado", variant: "destructive" },
};

export function TeamManager({ barbershopId }: { barbershopId: string }) {
  const { user } = useAuth();
  const { barbershop } = useBarbershop();
  const { barberLimit, planName } = usePlan();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("barbeiro");
  const [sending, setSending] = useState(false);
  const [addingSelf, setAddingSelf] = useState(false);

  const adminIsAlsoBarber = members.some(
    (m) => m.user_id === user?.id && m.role === "barbeiro"
  );

  const handleAddSelfAsBarber = async () => {
    if (!user) return;
    setAddingSelf(true);
    const { error } = await supabase.from("user_roles").insert({
      user_id: user.id,
      barbershop_id: barbershopId,
      role: "barbeiro" as const,
    });
    if (error) {
      toast.error("Erro ao se adicionar como barbeiro.");
    } else {
      toast.success("Você foi adicionado como barbeiro!");
      fetchTeam();
    }
    setAddingSelf(false);
  };

  const teamCount = members.length;
  const hasReachedBarberLimit = barberLimit !== null && teamCount >= barberLimit;

  const fetchTeam = useCallback(async () => {
    setLoading(true);

    // Fetch members
    const { data: roles } = await supabase
      .from("user_roles")
      .select("id, user_id, role")
      .eq("barbershop_id", barbershopId)
      .in("role", ["barbeiro", "admin_barbearia"]);

    if (roles && roles.length > 0) {
      const userIds = roles.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p])
      );

      setMembers(
        roles.map((r) => ({
          ...r,
          profile: profileMap.get(r.user_id) || null,
        }))
      );
    } else {
      setMembers([]);
    }

    // Fetch invitations
    const { data: invites } = await supabase
      .from("team_invitations")
      .select("*")
      .eq("barbershop_id", barbershopId)
      .order("created_at", { ascending: false });

    setInvitations((invites as Invitation[]) || []);
    setLoading(false);
  }, [barbershopId]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !user) return;

    if (hasReachedBarberLimit) {
      toast.error(`O plano ${planName === "free" ? "Free" : planName} permite apenas ${barberLimit} barbeiro(s). Faça upgrade para adicionar mais.`);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(inviteEmail)) {
      toast.error("Email inválido.");
      return;
    }

    // Check if already invited
    const existing = invitations.find(
      (i) => i.email === inviteEmail.trim() && i.status === "pending"
    );
    if (existing) {
      toast.error("Já existe um convite pendente para este email.");
      return;
    }

    setSending(true);

    const { error } = await supabase.from("team_invitations").insert({
      barbershop_id: barbershopId,
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole as "barbeiro" | "admin_barbearia",
      invited_by: user.id,
    });

    if (error) {
      if (error.code === "23505") {
        toast.error("Já existe um convite pendente para este email.");
      } else {
        toast.error("Erro ao enviar convite.");
      }
    } else {
      toast.success(`Convite enviado para ${inviteEmail.trim()}`);
      setInviteEmail("");
      fetchTeam();
    }

    setSending(false);
  };

  const handleCancelInvite = async (id: string) => {
    const { error } = await supabase
      .from("team_invitations")
      .update({ status: "cancelled" })
      .eq("id", id);

    if (error) {
      toast.error("Erro ao cancelar convite.");
    } else {
      toast.success("Convite cancelado.");
      fetchTeam();
    }
  };

  const handleRemoveMember = async (roleId: string, memberName: string) => {
    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", roleId);

    if (error) {
      toast.error("Erro ao remover membro.");
    } else {
      toast.success(`${memberName || "Membro"} removido da equipe.`);
      fetchTeam();
    }
  };

  const copyInviteLink = (token: string) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/convite?token=${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Link de convite copiado!");
  };

  const pendingInvites = invitations.filter((i) => i.status === "pending");
  const pastInvites = invitations.filter((i) => i.status !== "pending");

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-60 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Admin self-add as barber */}
      {!adminIsAlsoBarber && (
        <Card className="bg-card border-primary/30">
          <CardContent className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Scissors className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Também atende como barbeiro?</p>
                <p className="text-xs text-muted-foreground">Adicione-se como barbeiro para receber agendamentos.</p>
              </div>
            </div>
            <Button
              onClick={handleAddSelfAsBarber}
              disabled={addingSelf}
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Scissors className="w-4 h-4" />
              {addingSelf ? "Adicionando..." : "Me adicionar como barbeiro"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Invite form */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-display">
            <UserPlus className="w-5 h-5 text-primary" />
            Convidar Membro
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Label htmlFor="invite-email" className="text-xs text-muted-foreground">
                Email
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="barbeiro@email.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="w-full sm:w-[160px]">
              <Label htmlFor="invite-role" className="text-xs text-muted-foreground">
                Função
              </Label>
              <Select value={inviteRole} onValueChange={setInviteRole}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="barbeiro">Barbeiro</SelectItem>
                  <SelectItem value="admin_barbearia">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {hasReachedBarberLimit ? (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Limite de {barberLimit} barbeiro(s) atingido no plano {planName === "free" ? "Free" : planName}.{" "}
                <Link to="/upgrade" className="underline font-medium">Fazer upgrade</Link>
              </span>
            </div>
          ) : (
            <Button
              onClick={handleInvite}
              disabled={sending || !inviteEmail.trim()}
              className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Mail className="w-4 h-4" />
              {sending ? "Enviando..." : "Enviar Convite"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            O convidado receberá um link para aceitar. Convites expiram em 7 dias.
          </p>
        </CardContent>
      </Card>

      {/* Current team */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-display">
            <Users className="w-5 h-5 text-primary" />
            Equipe ({members.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              Nenhum membro na equipe ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {members.map((m) => {
                const isCurrentUser = m.user_id === user?.id;
                return (
                  <div
                    key={m.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {m.profile?.avatar_url ? (
                        <img
                          src={m.profile.avatar_url}
                          alt=""
                          className="w-9 h-9 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center">
                          <span className="text-xs font-medium text-foreground">
                            {(m.profile?.full_name || "?")[0].toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {m.profile?.full_name || `Usuário ${m.user_id.slice(0, 6)}`}
                          {isCurrentUser && (
                            <span className="text-xs text-muted-foreground ml-1">(você)</span>
                          )}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3 text-primary" />
                          <span className="text-xs text-muted-foreground">
                            {ROLE_LABELS[m.role] || m.role}
                          </span>
                        </div>
                      </div>
                    </div>
                    {!isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() =>
                          handleRemoveMember(m.id, m.profile?.full_name || "")
                        }
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-display">
              <Clock className="w-5 h-5 text-primary" />
              Convites Pendentes ({pendingInvites.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-background/50 border border-border/50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {inv.email}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">
                      {ROLE_LABELS[inv.role] || inv.role}
                    </Badge>
                    <span>
                      Expira em{" "}
                      {Math.max(
                        0,
                        Math.ceil(
                          (new Date(inv.expires_at).getTime() - Date.now()) /
                            (1000 * 60 * 60 * 24)
                        )
                      )}{" "}
                      dias
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 self-end sm:self-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => copyInviteLink(inv.token)}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Link
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleCancelInvite(inv.id)}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancelar
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Past invites */}
      {pastInvites.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-muted-foreground font-medium">
              Histórico de Convites
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pastInvites.slice(0, 10).map((inv) => {
              const status = STATUS_CONFIG[inv.status] || STATUS_CONFIG.pending;
              return (
                <div
                  key={inv.id}
                  className="flex items-center justify-between text-sm py-1.5"
                >
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    {inv.email}
                  </span>
                  <Badge variant={status.variant} className="text-[10px]">
                    {status.label}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
