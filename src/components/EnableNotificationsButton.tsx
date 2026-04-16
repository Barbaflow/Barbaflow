import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const NOTIF_ENABLED_KEY = "barbaflow_notifications_enabled";

export function EnableNotificationsButton() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [enabled, setEnabled] = useState(() => localStorage.getItem(NOTIF_ENABLED_KEY) !== "false");
  const [showHelpDialog, setShowHelpDialog] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
    } else {
      setPermission(Notification.permission as PermissionState);
    }
  }, []);

  // Poll permission state when help dialog is open (user may change in settings)
  useEffect(() => {
    if (!showHelpDialog) return;
    const interval = setInterval(() => {
      if (typeof Notification !== "undefined") {
        const current = Notification.permission as PermissionState;
        if (current !== "denied") {
          setPermission(current);
          setShowHelpDialog(false);
          if (current === "granted") {
            setEnabled(true);
            localStorage.setItem(NOTIF_ENABLED_KEY, "true");
            toast.success("Notificações ativadas!");
          }
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [showHelpDialog]);

  if (permission === "unsupported") return null;

  const isActive = permission === "granted" && enabled;

  const handleToggle = async () => {
    if (typeof Notification === "undefined") return;

    // If denied, show help dialog
    if (permission === "denied") {
      setShowHelpDialog(true);
      return;
    }

    // If permission not yet granted, request it
    if (permission !== "granted") {
      try {
        const result = await Notification.requestPermission();
        setPermission(result as PermissionState);
        if (result === "granted") {
          setEnabled(true);
          localStorage.setItem(NOTIF_ENABLED_KEY, "true");
          toast.success("Notificações ativadas!");
          new Notification("BarbaFlow", {
            body: "Você receberá avisos sobre seus agendamentos.",
            icon: "/icon-192.png",
          });
        } else if (result === "denied") {
          setShowHelpDialog(true);
        }
      } catch {
        toast.error("Erro ao solicitar permissão de notificações.");
      }
      return;
    }

    // Permission granted — toggle enabled/disabled
    if (enabled) {
      setEnabled(false);
      localStorage.setItem(NOTIF_ENABLED_KEY, "false");
      toast("Notificações desativadas.");
    } else {
      setEnabled(true);
      localStorage.setItem(NOTIF_ENABLED_KEY, "true");
      toast.success("Notificações reativadas!");
    }
  };

  const label = permission === "denied"
    ? "Notificações bloqueadas"
    : isActive
      ? "Desativar Notificações"
      : "Ativar Notificações";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleToggle}
        className="gap-2"
      >
        {permission === "denied" ? (
          <BellOff className="w-4 h-4 text-destructive" />
        ) : isActive ? (
          <BellRing className="w-4 h-4 text-primary" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">{label}</span>
      </Button>

      <Dialog open={showHelpDialog} onOpenChange={setShowHelpDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BellOff className="w-5 h-5 text-destructive" />
              Notificações Bloqueadas
            </DialogTitle>
            <DialogDescription>
              As notificações foram bloqueadas no navegador. Para reativar, siga os passos abaixo:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div>
              <p className="font-semibold text-foreground mb-2">📱 No celular (Chrome/Safari):</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Toque no ícone de <strong>cadeado 🔒</strong> ou <strong>ⓘ</strong> na barra de endereço</li>
                <li>Procure por <strong>"Notificações"</strong></li>
                <li>Altere de <strong>"Bloquear"</strong> para <strong>"Permitir"</strong></li>
                <li>Recarregue a página</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold text-foreground mb-2">💻 No computador (Chrome):</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Clique no ícone de <strong>cadeado 🔒</strong> à esquerda do endereço</li>
                <li>Em <strong>"Notificações"</strong>, mude para <strong>"Permitir"</strong></li>
                <li>Recarregue a página</li>
              </ol>
            </div>
            <div className="pt-2 border-t border-border">
              <Button
                variant="gold"
                size="sm"
                className="w-full"
                onClick={() => window.location.reload()}
              >
                Recarregar página
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Check if notifications are enabled (permission + user preference) */
export function areNotificationsEnabled(): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  return localStorage.getItem(NOTIF_ENABLED_KEY) !== "false";
}
