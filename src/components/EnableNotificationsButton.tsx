import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Bell, BellOff, Check } from "lucide-react";
import { toast } from "sonner";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

export function EnableNotificationsButton() {
  const [permission, setPermission] = useState<PermissionState>("default");

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setPermission("unsupported");
    } else {
      setPermission(Notification.permission as PermissionState);
    }
  }, []);

  if (permission === "unsupported") return null;
  if (permission === "granted") return null;

  const handleRequest = async () => {
    if (typeof Notification === "undefined") return;

    try {
      const result = await Notification.requestPermission();
      setPermission(result as PermissionState);

      if (result === "granted") {
        toast.success("Notificações ativadas!");
        new Notification("BarbaFlow", {
          body: "Você receberá avisos sobre seus agendamentos.",
          icon: "/icon-192.png",
        });
      } else if (result === "denied") {
        toast.error(
          "Notificações bloqueadas. Ative nas configurações do navegador."
        );
      }
    } catch {
      toast.error("Erro ao solicitar permissão de notificações.");
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRequest}
      className="gap-2"
    >
      {permission === "denied" ? (
        <BellOff className="w-4 h-4" />
      ) : (
        <Bell className="w-4 h-4" />
      )}
      <span className="hidden sm:inline">
        {permission === "denied" ? "Notificações bloqueadas" : "Ativar Notificações"}
      </span>
    </Button>
  );
}
