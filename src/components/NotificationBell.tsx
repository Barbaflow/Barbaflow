import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
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
  review_reply: "bg-gold",
};

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [navigatingId, setNavigatingId] = useState<string | null>(null);

  const handleClick = async (n: Notification & { barbershop_id?: string }) => {
    if (!n.read) markAsRead(n.id);

    if (n.type === "review_reply") {
      setNavigatingId(n.id);
      try {
        // Fetch barbershop_id + subdomain for this notification
        const { data: notifRow } = await supabase
          .from("notifications")
          .select("barbershop_id, appointment_id")
          .eq("id", n.id)
          .maybeSingle();

        if (!notifRow?.barbershop_id) return;

        const { data: shop } = await supabase
          .from("barbearias_publicas")
          .select("subdomain")
          .eq("id", notifRow.barbershop_id)
          .maybeSingle();

        if (!shop?.subdomain) return;

        // Find the review id (by appointment_id if available, else most recent
        // reply on a review by this client in that barbershop)
        let reviewId: string | null = null;
        if (notifRow.appointment_id && user) {
          const { data } = await supabase
            .from("reviews")
            .select("id")
            .eq("appointment_id", notifRow.appointment_id)
            .eq("client_id", user.id)
            .maybeSingle();
          reviewId = data?.id ?? null;
        }
        if (!reviewId && user) {
          const { data } = await supabase
            .from("reviews")
            .select("id, reply_at")
            .eq("barbershop_id", notifRow.barbershop_id)
            .eq("client_id", user.id)
            .not("reply", "is", null)
            .order("reply_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          reviewId = data?.id ?? null;
        }

        setOpen(false);
        navigate({
          to: "/agendar/$slug",
          params: { slug: shop.subdomain },
          hash: reviewId ? `review-${reviewId}` : undefined,
        });
      } finally {
        setNavigatingId(null);
      }
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
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h4 className="text-sm font-semibold text-foreground">Notificações</h4>
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsRead()}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              <CheckCheck className="w-3 h-3" />
              Marcar todas
            </button>
          )}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhuma notificação
            </div>
          ) : (
            <div className="divide-y divide-border">
              {notifications.map((n) => {
                const clickable = n.type === "review_reply";
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    disabled={navigatingId === n.id}
                    className={cn(
                      "w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex gap-3 disabled:opacity-60",
                      !n.read && "bg-primary/5",
                      clickable && "cursor-pointer",
                    )}
                  >
                    <div className="mt-1 flex-shrink-0">
                      <div
                        className={cn(
                          "w-2 h-2 rounded-full",
                          n.read ? "bg-muted-foreground/30" : (typeColors[n.type] || "bg-primary")
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
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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
