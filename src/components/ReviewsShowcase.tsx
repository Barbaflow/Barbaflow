import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  client_id: string;
  client_name?: string;
  client_avatar?: string | null;
}

interface ReviewsShowcaseProps {
  barbershopId: string;
  limit?: number;
}

export function ReviewsShowcase({ barbershopId, limit = 6 }: ReviewsShowcaseProps) {
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("reviews")
        .select("id, rating, comment, created_at, client_id")
        .eq("barbershop_id", barbershopId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (cancelled) return;

      if (error || !data) {
        setReviews([]);
        setLoading(false);
        return;
      }

      // Buscar nomes/avatares dos clientes
      const clientIds = Array.from(new Set(data.map((r) => r.client_id)));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", clientIds);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.user_id, p]),
      );

      const enriched: ReviewItem[] = data.map((r) => {
        const p = profileMap.get(r.client_id);
        return {
          ...r,
          client_name:
            (p?.full_name && p.full_name.trim()) || "Cliente",
          client_avatar: p?.avatar_url || null,
        };
      });

      if (cancelled) return;
      setReviews(enriched);

      // Buscar média/total da view pública
      const { data: shop } = await (supabase as any)
        .from("barbearias_publicas")
        .select("rating_avg, rating_count")
        .eq("id", barbershopId)
        .maybeSingle();

      if (!cancelled && shop) {
        setAvg(Number(shop.rating_avg) || 0);
        setCount(Number(shop.rating_count) || 0);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [barbershopId, limit]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-32 rounded-xl border border-border bg-card/50 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-10 rounded-xl border border-border bg-card/40">
        <Star className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Esta barbearia ainda não tem avaliações.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end justify-between mb-5">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">
            O que dizem os clientes
          </h2>
          {count > 0 && (
            <div className="flex items-center gap-2 mt-1">
              <Stars value={avg} />
              <span className="text-sm font-body font-semibold text-foreground">
                {avg.toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">
                ({count} {count === 1 ? "avaliação" : "avaliações"})
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reviews.map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: ReviewItem }) {
  const initials = (review.client_name || "C")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const date = new Date(review.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="rounded-xl border border-border bg-card/60 backdrop-blur-sm p-5 transition-colors hover:border-gold/30">
      <div className="flex items-start gap-3 mb-3">
        {review.client_avatar ? (
          <img
            src={review.client_avatar}
            alt={review.client_name}
            className="h-10 w-10 rounded-full object-cover border border-border"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-display font-semibold text-sm shrink-0">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-body font-semibold text-foreground text-sm truncate">
            {review.client_name}
          </p>
          <div className="flex items-center gap-2">
            <Stars value={review.rating} size="sm" />
            <span className="text-[11px] text-muted-foreground">{date}</span>
          </div>
        </div>
      </div>
      {review.comment && (
        <p className="text-sm text-foreground/90 font-body leading-relaxed">
          "{review.comment}"
        </p>
      )}
    </div>
  );
}

function Stars({ value, size = "md" }: { value: number; size?: "sm" | "md" }) {
  const sz = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            sz,
            n <= Math.round(value)
              ? "fill-gold text-gold"
              : "text-muted-foreground/30",
          )}
        />
      ))}
    </div>
  );
}
