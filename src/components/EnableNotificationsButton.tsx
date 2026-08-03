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

/**
 * A partir de qual breakpoint o rótulo aparece. Barras lotadas precisam segurar
 * o rótulo mais tempo para não espremer o que está do outro lado — ver o
 * cabeçalho do BarberDashboard, que só o mostra em `2xl`.
 *
 * O mapa é de strings literais de propósito: o Tailwind só gera a classe que
 * enxerga escrita no código, então montar `hidden ${bp}:inline` não funcionaria.
 *
 * Morava em `InstallAppButton`, que era o outro botão do mesmo grupo. Com aquele
 * botão removido, veio para cá, seu único consumidor.
 */
export const ROTULO_A_PARTIR_DE = {
  sm: "hidden sm:inline",
  xl: "hidden xl:inline",
  "2xl": "hidden 2xl:inline",
} as const;

export type RotuloBreakpoint = keyof typeof ROTULO_A_PARTIR_DE;

interface EnableNotificationsButtonProps {
  /** Padrão `sm`. Ver `ROTULO_A_PARTIR_DE`. */
  labelFrom?: RotuloBreakpoint;
}

export function EnableNotificationsButton({ labelFrom = "sm" }: EnableNotificationsButtonProps = {}) {
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
      <span className={ROTULO_A_PARTIR_DE[labelFrom]}>
        {enabled ? "Desativar Notificações" : "Ativar Notificações"}
      </span>
    </Button>
  );
}

/** Check if notifications are enabled (user preference) */
export function areNotificationsEnabled(): boolean {
  return localStorage.getItem(NOTIF_ENABLED_KEY) !== "false";
}
