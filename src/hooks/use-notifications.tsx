import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { showBrowserNotification } from "@/lib/browser-notifications";
import { logTechnicalError } from "@/lib/error-reporting";
import { toast } from "sonner";

const NOTIF_ENABLED_KEY = "barbaflow_notifications_enabled";

/** Quantas notificações a lista carrega. O contador NÃO depende deste limite. */
const PAGE_SIZE = 20;

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
  barbershop_id: string | null;
  read: boolean;
  created_at: string;
}

const COLUNAS = "id, title, message, type, appointment_id, barbershop_id, read, created_at";

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  /**
   * Total de não lidas no banco — não o número de não lidas dentro da página.
   * Antes o contador saía de `data.filter(...)` sobre as 20 primeiras linhas:
   * com 25 não lidas, o sino mostrava 20.
   */
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Identifica a requisição em curso: uma resposta antiga (troca de usuário,
  // retry sobreposto) não pode sobrescrever uma mais nova.
  const requestId = useRef(0);

  const fetchNotifications = useCallback(async () => {
    if (!user) {
      // Sem sessão não há o que buscar — mas `loading` PRECISA sair de `true`,
      // senão a interface fica presa no esqueleto para sempre.
      setNotifications([]);
      setUnreadCount(0);
      setLoadError(null);
      setLoading(false);
      return;
    }

    const meu = ++requestId.current;
    setLoading(true);
    setLoadError(null);

    const [lista, contagem] = await Promise.all([
      supabase
        .from("notifications")
        .select(COLUNAS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false),
    ]);

    if (meu !== requestId.current) return;

    // Erro de consulta não pode virar "nenhuma notificação": são estados
    // diferentes. A lista anterior é preservada — apagá-la puniria o usuário
    // por uma falha de rede.
    if (lista.error || contagem.error) {
      logTechnicalError("useNotifications", "carregar notificações", lista.error ?? contagem.error);
      setLoadError("Não foi possível carregar suas notificações.");
      setLoading(false);
      return;
    }

    const linhas = (lista.data ?? []) as Notification[];
    setNotifications(linhas);
    // `count` vem do banco, sobre TODAS as não lidas. O fallback só existe para
    // o caso de o driver não devolver a contagem.
    setUnreadCount(contagem.count ?? linhas.filter((n) => !n.read).length);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  /* ─────────────────────────────── Realtime ─────────────────────────────── */

  useEffect(() => {
    if (!user) return;

    // O canal precisa ser único por usuário E por montagem. Antes o nome era a
    // constante "user-notifications": o sino é montado em quatro telas, então
    // várias instâncias disputavam o mesmo tópico, e trocar de conta reaproveitava
    // o canal da conta anterior.
    const canal = `notifications:${user.id}:${Math.random().toString(36).slice(2, 10)}`;

    const channel = supabase
      .channel(canal)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          // Filtro no servidor: nunca recebemos evento de outro usuário.
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const nova = payload.new as Notification;
          if (!nova?.id) return;

          let inedita = false;
          setNotifications((prev) => {
            // Um refetch simultâneo pode já ter trazido esta linha. Sem esta
            // checagem, a mesma notificação aparecia duas vezes.
            if (prev.some((n) => n.id === nova.id)) return prev;
            inedita = true;
            return [nova, ...prev].slice(0, PAGE_SIZE);
          });

          if (!inedita) return;
          if (!nova.read) setUnreadCount((c) => c + 1);

          if (!getNotifEnabled()) return;

          showBrowserNotification(nova.title, {
            body: nova.message,
            tag: nova.id,
          });

          // Toast só quando a aba está à frente — aí o sistema costuma suprimir
          // a notificação nativa.
          if (typeof document !== "undefined" && !document.hidden) {
            toast(nova.title, { description: nova.message });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  /* ──────────────────────────────── ações ───────────────────────────────── */

  const markAsRead = useCallback(async (id: string) => {
    let jaEstavaLida = true;

    // Otimista: a interface responde na hora.
    setNotifications((prev) => {
      const alvo = prev.find((n) => n.id === id);
      jaEstavaLida = alvo?.read !== false;
      return prev.map((n) => (n.id === id ? { ...n, read: true } : n));
    });
    if (!jaEstavaLida) setUnreadCount((c) => Math.max(0, c - 1));

    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);

    if (error) {
      // Reverte: manter "lida" na tela quando o banco recusou faria o usuário
      // perder a notificação de vista sem que nada tenha sido gravado.
      logTechnicalError("useNotifications", "marcar notificação como lida", error);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
      if (!jaEstavaLida) setUnreadCount((c) => c + 1);
      toast.error("Não foi possível marcar como lida. Tente novamente.");
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;

    // Guarda o estado anterior para poder desfazer por inteiro.
    let anterior: Notification[] = [];
    let contagemAnterior = 0;
    setNotifications((prev) => {
      anterior = prev;
      return prev.map((n) => ({ ...n, read: true }));
    });
    setUnreadCount((c) => {
      contagemAnterior = c;
      return 0;
    });

    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id)
      .eq("read", false);

    if (error) {
      logTechnicalError("useNotifications", "marcar todas as notificações como lidas", error);
      setNotifications(anterior);
      setUnreadCount(contagemAnterior);
      toast.error("Não foi possível marcar todas como lidas. Tente novamente.");
    }
  }, [user]);

  const notificationsEnabled = useSyncExternalStore(subscribeToStorage, getNotifEnabled);

  /** `true` quando a lista está vazia porque não há nada — não por falha. */
  const isEmpty = useMemo(
    () => !loading && !loadError && notifications.length === 0,
    [loading, loadError, notifications.length],
  );

  return {
    notifications,
    unreadCount,
    loading,
    loadError,
    isEmpty,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
    notificationsEnabled,
  };
}
