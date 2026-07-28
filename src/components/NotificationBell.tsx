import { useState } from "react";
import { Bell, CheckCheck, AlertCircle, RotateCw } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotifications, type Notification } from "@/hooks/use-notifications";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { logTechnicalError } from "@/lib/error-reporting";
import {
  resolveNotificationDestination,
  isValidSubdomain,
  isValidUuid,
  type NotificationPerspective,
} from "@/lib/notification-links";
import { cn } from "@/lib/utils";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const typeColors: Record<string, string> = {
  new_appointment: "bg-blue-500",
  appointment_confirmed: "bg-green-500",
  appointment_cancelled: "bg-red-500",
  appointment_completed: "bg-primary",
  appointment_rescheduled: "bg-amber-500",
  review_reply: "bg-gold",
  noshow_blocked: "bg-red-500",
  noshow_unblocked: "bg-green-500",
};

interface NotificationBellProps {
  /**
   * De onde o sino está sendo exibido. Decide o destino dos tipos que chegam
   * aos dois lados (cancelamento, reagendamento): o painel leva à agenda, a
   * área do cliente leva aos agendamentos dele.
   */
  perspective?: NotificationPerspective;
}

export function NotificationBell({ perspective = "client" }: NotificationBellProps) {
  const { notifications, unreadCount, loading, loadError, isEmpty, markAsRead, markAllAsRead, refetch } =
    useNotifications();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  /** Resolve a avaliação e navega para a página pública da barbearia. */
  const abrirRespostaDeAvaliacao = async (n: Notification) => {
    if (!isValidUuid(n.barbershop_id)) return;

    const { data: shop, error: erroShop } = await supabase
      .from("barbearias_publicas")
      .select("subdomain")
      .eq("id", n.barbershop_id)
      .maybeSingle();

    if (erroShop || !isValidSubdomain(shop?.subdomain)) {
      logTechnicalError("NotificationBell", "resolver barbearia da avaliação", erroShop);
      return;
    }

    // Melhor esforço: sem a avaliação exata, ainda abrimos a página. Um id que
    // não resolve nunca deve impedir a navegação.
    let reviewId: string | null = null;
    if (user) {
      if (isValidUuid(n.appointment_id)) {
        const { data } = await supabase
          .from("reviews")
          .select("id")
          .eq("appointment_id", n.appointment_id)
          .eq("client_id", user.id)
          .maybeSingle();
        reviewId = isValidUuid(data?.id) ? data.id : null;
      }
      if (!reviewId) {
        const { data } = await supabase
          .from("reviews")
          .select("id, reply_at")
          .eq("barbershop_id", n.barbershop_id)
          .eq("client_id", user.id)
          .not("reply", "is", null)
          .order("reply_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        reviewId = isValidUuid(data?.id) ? data.id : null;
      }
    }

    setOpen(false);
    navigate({
      to: "/agendar/$slug",
      params: { slug: shop.subdomain },
      hash: reviewId ? `review-${reviewId}` : undefined,
    });
  };

  const handleClick = async (n: Notification) => {
    // Marcar como lida é independente de navegar: se o destino falhar, a
    // notificação já foi lida — e se a leitura falhar, a navegação acontece
    // do mesmo jeito.
    if (!n.read) void markAsRead(n.id);

    const destino = resolveNotificationDestination(n.type, perspective);
    if (!destino) return;

    setNavigatingId(n.id);
    try {
      if (destino.kind === "review") {
        await abrirRespostaDeAvaliacao(n);
        return;
      }
      setOpen(false);
      // Rota literal vinda da tabela de destinos — nunca do conteúdo da linha.
      navigate({ to: destino.to });
    } catch (err) {
      // Um destino que não resolve não pode derrubar a aplicação.
      logTechnicalError("NotificationBell", `abrir notificação (${n.type})`, err);
    } finally {
      setNavigatingId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-0" align="end">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h4 className="text-sm font-semibold text-foreground">Notificações</h4>
          {unreadCount > 0 && (
            <button
              onClick={() => void markAllAsRead()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors shrink-0"
            >
              <CheckCheck className="w-3 h-3" />
              Marcar todas
            </button>
          )}
        </div>

        <ScrollArea className="max-h-80">
          {loading && notifications.length === 0 ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          ) : loadError ? (
            /* Falha de consulta tem tela própria — nunca se disfarça de
               "nenhuma notificação". */
            <div className="px-4 py-6 space-y-3 text-center">
              <AlertCircle className="w-5 h-5 mx-auto text-destructive" />
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                <RotateCw className="w-3 h-3" />
                Tentar novamente
              </Button>
            </div>
          ) : isEmpty ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma notificação
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => {
                const clickable = resolveNotificationDestination(n.type, perspective) !== null;
                return (
                  <button
                    key={n.id}
                    onClick={() => void handleClick(n)}
                    disabled={navigatingId === n.id}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3 disabled:opacity-60",
                      !n.read && "bg-primary/5",
                      clickable ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    <div className="mt-1 flex-shrink-0">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full",
                          n.read ? "bg-muted-foreground/30" : (typeColors[n.type] || "bg-primary"),
                        )}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {n.title}
                        </span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 break-words">
                        {n.message}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
