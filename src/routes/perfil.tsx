import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, KeyRound, Loader2, LogOut, Scissors, Trash2, User as UserIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { NotificationBell } from "@/components/NotificationBell";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const requiredText = "EXCLUIR";
  const [sendingReset, setSendingReset] = useState(false);

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
      const { data, error } = await supabase.functions.invoke("delete-account");
      if (error || (data && (data as any).error)) {
        const message = (data as any)?.message || error?.message || "Não foi possível excluir a conta.";
        toast.error(message);
        setDeleting(false);
        return;
      }
      toast.success("Sua conta foi excluída.");
      await supabase.auth.signOut();
      setDeleteOpen(false);
      navigate({ to: "/" });
    } catch (e) {
      toast.error("Erro ao excluir conta. Tente novamente.");
      setDeleting(false);
    }
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

        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5 space-y-4">
          <div>
            <h3 className="font-display font-semibold text-destructive">Excluir minha conta</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Esta ação é permanente. Seus dados pessoais (perfil, foto, telefone, notificações
              e comentários de avaliações) serão removidos. Agendamentos futuros serão cancelados.
            </p>
          </div>
          <AlertDialog open={deleteOpen} onOpenChange={(o) => { setDeleteOpen(o); if (!o) setConfirmText(""); }}>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="w-4 h-4" />
                Excluir conta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Tem certeza absoluta?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      Esta ação <strong className="text-destructive">não pode ser desfeita</strong>.
                      Sua conta <span className="font-medium text-foreground">{user.email}</span> e todos os
                      seus dados pessoais serão removidos permanentemente.
                    </p>
                    <p>
                      Para confirmar, digite <strong className="text-foreground">{requiredText}</strong> abaixo:
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="confirm-delete" className="text-xs text-muted-foreground">
                  Digite {requiredText} para liberar o botão
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
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); handleDeleteAccount(); }}
                  disabled={confirmText !== requiredText || deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Excluindo...</>
                  ) : (
                    <><Trash2 className="w-4 h-4" /> Excluir definitivamente</>
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </main>
    </div>
  );
}
