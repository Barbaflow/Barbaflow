import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import {
  isNotificationSupported,
  requestNotificationPermission,
  getNotificationPermission,
} from "@/lib/browser-notifications";

const NOTIF_ENABLED_KEY = "barbaflow_notifications_enabled";

export function EnableNotificationsButton() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(NOTIF_ENABLED_KEY) !== "false");

  // Auto-request permission on mount if user has notifications enabled but never granted.
  useEffect(() => {
    if (enabled && isNotificationSupported() && Notification.permission === "default") {
      requestNotificationPermission();
    }
  }, [enabled]);

  const handleToggle = async () => {
    if (enabled) {
      setEnabled(false);
      localStorage.setItem(NOTIF_ENABLED_KEY, "false");
      window.dispatchEvent(new StorageEvent("storage", { key: NOTIF_ENABLED_KEY }));
      toast("Notificações desativadas.");
      return;
    }

    setEnabled(true);
    localStorage.setItem(NOTIF_ENABLED_KEY, "true");
    window.dispatchEvent(new StorageEvent("storage", { key: NOTIF_ENABLED_KEY }));

    if (!isNotificationSupported()) {
      toast.success("Notificações ativadas no app (seu navegador não suporta alertas em segundo plano).");
      return;
    }

    const perm = await requestNotificationPermission();
    if (perm === "granted") {
      toast.success("Notificações ativadas! Você receberá alertas mesmo com o app em segundo plano.");
    } else if (perm === "denied") {
      toast.warning("Permissão negada. Ative as notificações nas configurações do navegador para receber alertas em segundo plano.");
    } else {
      toast("Notificações ativadas no app.");
    }
  };

  const perm = getNotificationPermission();
  const showWarning = enabled && perm === "denied";

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleToggle}
      className="gap-2"
      title={showWarning ? "Notificações bloqueadas pelo navegador" : undefined}
    >
      {enabled ? (
        <Bell className={`w-4 h-4 ${showWarning ? "text-destructive" : "text-primary"}`} />
      ) : (
        <BellOff className="w-4 h-4 text-muted-foreground" />
      )}
      <span className="hidden sm:inline">
        {enabled ? "Desativar Notificações" : "Ativar Notificações"}
      </span>
    </Button>
  );
}

/** Check if notifications are enabled (user preference) */
export function areNotificationsEnabled(): boolean {
  return localStorage.getItem(NOTIF_ENABLED_KEY) !== "false";
}
