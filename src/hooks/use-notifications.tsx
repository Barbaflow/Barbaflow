import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { showBrowserNotification } from "@/lib/browser-notifications";
import { toast } from "sonner";

const NOTIF_ENABLED_KEY = "barbaflow_notifications_enabled";

function subscribeToStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function getNotifEnabled() {
  return localStorage.getItem(NOTIF_ENABLED_KEY) !== "false";
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  appointment_id: string | null;
  read: boolean;
  created_at: string;
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("notifications")
      .select("id, title, message, type, appointment_id, read, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read).length);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("user-notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev].slice(0, 20));
          setUnreadCount((c) => c + 1);

          if (!getNotifEnabled()) return;

          // Native browser notification — works in background / minimized tab.
          showBrowserNotification(newNotif.title, {
            body: newNotif.message,
            tag: newNotif.id,
            onClickUrl: newNotif.type === "new_appointment" ? "/agenda" : "/",
          });

          // In-app toast for when the tab IS focused (browser usually suppresses
          // the system notification in that case).
          if (typeof document !== "undefined" && !document.hidden) {
            toast(newNotif.title, { description: newNotif.message });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, [user]);

  const notificationsEnabled = useSyncExternalStore(subscribeToStorage, getNotifEnabled);

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead, refetch: fetchNotifications, notificationsEnabled };
}
