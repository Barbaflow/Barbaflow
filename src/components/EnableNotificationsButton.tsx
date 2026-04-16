import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const NOTIF_ENABLED_KEY = "barbaflow_notifications_enabled";

export function EnableNotificationsButton() {
  const [permission, setPermission] = useState<PermissionState>("default");
  const [enabled, setEnabled] = useState(() => localStorage.getItem(NOTIF_ENABLED_KEY) !== "false");

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
    } else {
      setPermission(Notification.permission as PermissionState);
    }
  }, []);

  if (permission === "unsupported") return null;

  const isActive = permission === "granted" && enabled;

  const handleToggle = async () => {
    if (typeof Notification === "undefined") return;

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
          toast.error("Notificações bloqueadas. Ative nas configurações do navegador.");
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
    <Button
      variant={isActive ? "outline" : "outline"}
      size="sm"
      onClick={handleToggle}
      className="gap-2"
    >
      {permission === "denied" ? (
        <BellOff className="w-4 h-4" />
      ) : isActive ? (
        <BellRing className="w-4 h-4 text-primary" />
      ) : (
        <Bell className="w-4 h-4" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/** Check if notifications are enabled (permission + user preference) */
export function areNotificationsEnabled(): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "granted") return false;
  return localStorage.getItem(NOTIF_ENABLED_KEY) !== "false";
}
