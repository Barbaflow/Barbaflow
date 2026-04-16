import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

const NOTIF_ENABLED_KEY = "barbaflow_notifications_enabled";

export function EnableNotificationsButton() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(NOTIF_ENABLED_KEY) !== "false");

  const handleToggle = () => {
    if (enabled) {
      setEnabled(false);
      localStorage.setItem(NOTIF_ENABLED_KEY, "false");
      toast("Notificações desativadas.");
    } else {
      setEnabled(true);
      localStorage.setItem(NOTIF_ENABLED_KEY, "true");
      toast.success("Notificações ativadas!");
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleToggle}
      className="gap-2"
    >
      {enabled ? (
        <Bell className="w-4 h-4 text-primary" />
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
