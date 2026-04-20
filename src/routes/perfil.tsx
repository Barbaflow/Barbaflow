import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { AlertTriangle, ArrowLeft, CalendarClock, KeyRound, Loader2, LogOut, RotateCcw, Scissors, Trash2, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { NotificationBell } from "@/components/NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DELETION_REASONS: { value: string; label: string }[] = [
  { value: "no_use", label: "Não estou mais usando o app" },
  { value: "found_alternative", label: "Encontrei uma alternativa melhor" },
  { value: "too_expensive", label: "Achei o preço alto" },
  { value: "missing_features", label: "Faltam funcionalidades que preciso" },
  { value: "bad_experience", label: "Tive uma experiência ruim" },
  { value: "privacy", label: "Preocupações com privacidade" },
  { value: "temporary", label: "Pausa temporária — devo voltar" },
  { value: "other", label: "Outro motivo" },
];

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Meu Perfil — BarbaFlow" },
      { name: "description", content: "Edite seus dados, foto e telefone para agendamentos." },
      { property: "og:title", content: "Meu Perfil — BarbaFlow" },
      { property: "og:description", content: "Gerencie seus dados pessoais na BarbaFlow." },
    ],
  }),
  component: PerfilPage,
});

function PerfilPage() {
  const { user, loading, signOut } = useAuth();
  const { barbershop } = useBarbershop();
  const navigate = useNavigate();
  const name = barbershop?.name || "BarbaFlow";
  const [confirmText, setConfirmText] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [deletedEmail, setDeletedEmail] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [details, setDetails] = useState<string>("");
  const requiredText = "EXCLUIR";
  const [sendingReset, setSendingReset] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<{ scheduled_for: string } | null>(null);
  const [loadingPending, setLoadingPending] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from("account_deletions" as any)
        .select("scheduled_for, cancelled_at, processed_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!active) return;
      if (data && !(data as any).cancelled_at && !(data as any).processed_at) {
        setPendingDeletion({ scheduled_for: (data as any).scheduled_for });
      } else {
        setPendingDeletion(null);
      }
      setLoadingPending(false);
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const handleCancelDeletion = async () => {
    setCancelling(true);
    try {
      const { data, error } = await supabase.functions.invoke("cancel-account-deletion", {
        body: {},
      });
      if (error || (data && (data as any).error)) {
        const message = (data as any)?.message || error?.message || "Não foi possível cancelar.";
        toast.error(message);
        return;
      }
      setPendingDeletion(null);
      toast.success("Exclusão cancelada. Sua conta está ativa novamente.");
    } catch {
      toast.error("Erro ao cancelar exclusão.");
    } finally {
      setCancelling(false);
    }
  };

  const formatScheduled = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const daysRemaining = (iso: string) => {
    const diff = new Date(iso).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;
    setSendingReset(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error("Não foi possível enviar o email. Tente novamente.");
      } else {
        toast.success("Email de redefinição enviado! Verifique sua caixa de entrada.");
      }
    } catch {
      toast.error("Erro ao enviar email de redefinição.");
    } finally {
      setSendingReset(false);
    }
  };

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: "/perfil" } });
    }
  }, [user, loading, navigate]);

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success("Você saiu da sua conta.");
      navigate({ to: "/" });
    } catch {
      toast.error("Erro ao sair. Tente novamente.");
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      const emailSnapshot = user?.email ?? null;
      const trimmedDetails = details.trim().slice(0, 500);
      const { data, error } = await supabase.functions.invoke("delete-account", {
        body: {
          reason: reason || undefined,
          details: trimmedDetails || undefined,
        },
      });
      if (error || (data && (data as any).error)) {
        const message = (data as any)?.message || error?.message || "Não foi possível excluir a conta.";
        toast.error(message);
        setDeleting(false);
        return;
      }
      const scheduled = (data as any)?.scheduled_for as string | undefined;
      if (scheduled) {
        setPendingDeletion({ scheduled_for: scheduled });
      }
      setDeletedEmail(emailSnapshot);
      setDeleteOpen(false);
      setDeleting(false);
      setSuccessOpen(true);
    } catch (e) {
      toast.error("Erro ao excluir conta. Tente novamente.");
      setDeleting(false);
    }
  };

  const handleSuccessClose = () => {
    setSuccessOpen(false);
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <nav className="flex items-center justify-between px-4 py-4 md:px-12 md:py-5 border-b border-border">
        <div className="flex items-center gap-3">
          {barbershop?.logo_url ? (
            <img src={barbershop.logo_url} alt={name} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
              <Scissors className="w-4 h-4 text-primary-foreground" />
            </div>
          )}
          <span className="font-display text-lg text-foreground">{name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/meus-agendamentos">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Voltar</span>
            </Button>
          </Link>
          <NotificationBell />
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-8 md:px-6 md:py-10 space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <UserIcon className="w-5 h-5 text-gold" />
            <h1 className="text-2xl md:text-3xl font-display font-bold text-foreground">
              Meu <span className="text-gradient-gold">Perfil</span>
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Atualize sua foto, nome e telefone usados nos agendamentos.
          </p>
        </div>

        {pendingDeletion && (
          <div className="rounded-lg border-2 border-destructive bg-destructive/10 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <h3 className="font-display font-semibold text-destructive">
                  Sua conta será excluída em {daysRemaining(pendingDeletion.scheduled_for)} {daysRemaining(pendingDeletion.scheduled_for) === 1 ? "dia" : "dias"}
                </h3>
                <p className="text-sm text-foreground/80">
                  Exclusão definitiva agendada para{" "}
                  <span className="font-medium text-foreground">
                    {formatScheduled(pendingDeletion.scheduled_for)}
                  </span>
                  . Você ainda pode cancelar e manter sua conta.
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelDeletion}
                disabled={cancelling}
                className="border-destructive/40"
              >
                {cancelling ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Cancelando...</>
                ) : (
                  <><RotateCcw className="w-4 h-4" /> Cancelar exclusão</>
                )}
              </Button>
            </div>
          </div>
        )}

        <ProfilePhotoUpload />

        <div className="rounded-lg border border-border bg-card p-5 space-y-3">
          <div>
            <h3 className="font-display font-semibold text-foreground">Email da conta</h3>
            <p className="text-sm text-muted-foreground break-all">{user.email}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-foreground">Alterar senha</h3>
            <p className="text-sm text-muted-foreground">
              Enviaremos um link de redefinição para o seu email.
            </p>
          </div>
          <Button variant="outline" onClick={handlePasswordReset} disabled={sendingReset}>
            {sendingReset ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</>
            ) : (
              <><KeyRound className="w-4 h-4" /> Enviar link</>
            )}
          </Button>
        </div>

        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display font-semibold text-foreground">Sair da conta</h3>
            <p className="text-sm text-muted-foreground">
              Você precisará entrar novamente para agendar.
            </p>
          </div>
          <Button variant="destructive" onClick={handleSignOut}>
            <LogOut className="w-4 h-4" />
            Sair
          </Button>
        </div>

        {!pendingDeletion && !loadingPending && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-destructive">Excluir minha conta</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Sua conta entrará em período de carência de <strong className="text-foreground">30 dias</strong>.
              Durante esse prazo você pode cancelar e voltar normalmente. Após 30 dias todos os
              seus dados pessoais serão removidos permanentemente.
            </p>
          </div>
          <AlertDialog
            open={deleteOpen}
            onOpenChange={(o) => {
              setDeleteOpen(o);
              if (!o) {
                setConfirmText("");
                setReason("");
                setDetails("");
              }
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4" />
                Excluir conta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
              <AlertDialogHeader>
                <AlertDialogTitle>Agendar exclusão da conta?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      Sua conta <span className="font-medium text-foreground">{user.email}</span> entrará
                      em <strong className="text-foreground">período de carência de 30 dias</strong>.
                      Você poderá cancelar a exclusão a qualquer momento durante esse prazo.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Atenção: seus agendamentos futuros serão cancelados imediatamente.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reason" className="text-sm text-foreground">
                    Antes de ir, qual o motivo? <span className="text-muted-foreground font-normal">(opcional)</span>
                  </Label>
                  <Select value={reason} onValueChange={setReason} disabled={deleting}>
                    <SelectTrigger id="reason">
                      <SelectValue placeholder="Selecione um motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      {DELETION_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Sua resposta é anônima e nos ajuda a melhorar o serviço.
                  </p>
                </div>

                {reason && (
                  <div className="space-y-2">
                    <Label htmlFor="details" className="text-sm text-foreground">
                      Quer contar mais? <span className="text-muted-foreground font-normal">(opcional)</span>
                    </Label>
                    <Textarea
                      id="details"
                      value={details}
                      onChange={(e) => setDetails(e.target.value.slice(0, 500))}
                      placeholder="Conte o que poderíamos ter feito melhor..."
                      maxLength={500}
                      rows={3}
                      disabled={deleting}
                    />
                    <p className="text-[11px] text-muted-foreground text-right">
                      {details.length}/500
                    </p>
                  </div>
                )}

                <div className="space-y-2 pt-2 border-t border-border">
                  <Label htmlFor="confirm-delete" className="text-xs text-muted-foreground">
                    Para confirmar, digite <strong className="text-foreground">{requiredText}</strong>
                  </Label>
                  <Input
                    id="confirm-delete"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={requiredText}
                    autoComplete="off"
                    disabled={deleting}
                  />
                </div>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); handleDeleteAccount(); }}
                  disabled={confirmText !== requiredText || deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Agendando...</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Agendar exclusão</>
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        )}

        <AlertDialog open={successOpen} onOpenChange={(o) => { if (!o) handleSuccessClose(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-gold/15">
                <CalendarClock className="h-8 w-8 text-gold" />
              </div>
              <AlertDialogTitle className="text-center font-display text-xl">
                Exclusão agendada
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-sm text-center">
                  <p>
                    {deletedEmail ? (
                      <>A conta <span className="font-medium text-foreground">{deletedEmail}</span> será excluída em <strong className="text-foreground">30 dias</strong>.</>
                    ) : (
                      <>Sua conta será excluída em <strong className="text-foreground">30 dias</strong>.</>
                    )}
                  </p>
                  {pendingDeletion && (
                    <p className="text-xs text-muted-foreground">
                      Data agendada: <span className="font-medium text-foreground">{formatScheduled(pendingDeletion.scheduled_for)}</span>
                    </p>
                  )}
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-left space-y-1.5">
                    <p className="font-medium text-foreground text-xs uppercase tracking-wide">Já foi feito agora:</p>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Agendamentos futuros foram cancelados</li>
                    </ul>
                    <p className="font-medium text-foreground text-xs uppercase tracking-wide pt-2">Após 30 dias:</p>
                    <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                      <li>Perfil, foto e telefone serão removidos</li>
                      <li>Notificações e bloqueios apagados</li>
                      <li>Comentários de avaliações serão anonimizados</li>
                    </ul>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mudou de ideia? Você pode cancelar a exclusão a qualquer momento durante os 30 dias, na sua página de perfil.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction onClick={handleSuccessClose} className="w-full sm:w-auto">
                Entendi
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </div>
  );
}
