import { useEffect, useState, useCallback, useMemo } from "react";
import { fetchProfileSummaries } from "@/lib/profile-summaries";
import { supabase } from "@/integrations/supabase/client";
import { Star, Loader2, Trash2, MessageSquareReply, Pencil, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "@/components/EmojiPicker";

interface ReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  client_id: string;
  reply: string | null;
  reply_at: string | null;
  client_name?: string;
  client_avatar?: string | null;
}

interface ReviewsShowcaseProps {
  barbershopId: string;
  pageSize?: number;
}

export function ReviewsShowcase({ barbershopId, pageSize = 6 }: ReviewsShowcaseProps) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [myReview, setMyReview] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [canModerate, setCanModerate] = useState(false);

  // Verifica se o usuário é barbeiro/admin desta barbearia (ou super_admin)
  useEffect(() => {
    if (!user) {
      setCanModerate(false);
      return;
    }
    (async () => {
      const [{ data: roles }, { data: isSuper }] = await Promise.all([
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("barbershop_id", barbershopId),
        supabase.rpc("has_role", { _user_id: user.id, _role: "super_admin" }),
      ]);
      const list = (roles || []).map((r) => r.role);
      setCanModerate(
        isSuper === true ||
          list.includes("barbeiro") ||
          list.includes("admin_barbearia"),
      );
    })();
  }, [user, barbershopId]);

  const fetchPage = useCallback(
    async (offset: number): Promise<ReviewItem[]> => {
      const { data, error } = await (supabase as any)
        .from("reviews")
        .select("id, rating, comment, created_at, client_id, reply, reply_at")
        .eq("barbershop_id", barbershopId)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error || !data) return [];

      const clientIds: string[] = Array.from(
        new Set((data as any[]).map((r) => r.client_id as string)),
      );
      // `profiles` deixou de ser legível por qualquer autenticado
      // (migration 20260722240000). Nome e avatar de quem avaliou vêm da RPC de
      // resumo público, que devolve só esses dois campos.
      const resumos = await fetchProfileSummaries(clientIds);
      const profileMap = new Map(
        Object.entries(resumos).map(([userId, r]) => [
          userId,
          { user_id: userId, full_name: r.full_name, avatar_url: r.avatar_url },
        ]),
      );

      return data.map((r: any) => {
        const p = profileMap.get(r.client_id);
        return {
          ...r,
          client_name: (p?.full_name && p.full_name.trim()) || "Cliente",
          client_avatar: p?.avatar_url || null,
        } as ReviewItem;
      });
    },
    [barbershopId, pageSize],
  );

  const refreshAggregates = useCallback(async () => {
    const { data: shop } = await (supabase as any)
      .from("barbearias_publicas")
      .select("rating_avg, rating_count")
      .eq("id", barbershopId)
      .maybeSingle();
    if (shop) {
      setAvg(Number(shop.rating_avg) || 0);
      setCount(Number(shop.rating_count) || 0);
    }
  }, [barbershopId]);

  const fetchMyReview = useCallback(async (): Promise<ReviewItem | null> => {
    if (!user) return null;
    const { data } = await (supabase as any)
      .from("reviews")
      .select("id, rating, comment, created_at, client_id, reply, reply_at")
      .eq("barbershop_id", barbershopId)
      .eq("client_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle();
    return {
      ...(data as any),
      client_name:
        (profile?.full_name && profile.full_name.trim()) || "Você",
      client_avatar: profile?.avatar_url || null,
    } as ReviewItem;
  }, [barbershopId, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [first, mine] = await Promise.all([
        fetchPage(0),
        fetchMyReview(),
      ]);
      if (cancelled) return;
      setReviews(first);
      setMyReview(mine);
      setHasMore(first.length === pageSize);
      await refreshAggregates();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [barbershopId, pageSize, fetchPage, refreshAggregates, fetchMyReview]);

  const loadMore = async () => {
    setLoadingMore(true);
    const next = await fetchPage(reviews.length);
    setReviews((prev) => [...prev, ...next]);
    setHasMore(next.length === pageSize);
    setLoadingMore(false);
  };

  const handleReplySaved = (id: string, reply: string | null) => {
    const patch = (r: ReviewItem) =>
      r.id === id
        ? { ...r, reply, reply_at: reply ? new Date().toISOString() : null }
        : r;
    setReviews((prev) => prev.map(patch));
    setMyReview((prev) => (prev ? patch(prev) : prev));
  };

  const handleReviewUpdated = async (
    id: string,
    patch: { rating: number; comment: string | null },
  ) => {
    setReviews((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
    setMyReview((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
    await refreshAggregates();
  };

  const handleDeleted = async (id: string) => {
    setReviews((prev) => prev.filter((r) => r.id !== id));
    setMyReview((prev) => (prev && prev.id === id ? null : prev));
    await refreshAggregates();
  };

  // Move my review to the top, deduplicated
  const displayedReviews = useMemo(() => {
    if (!myReview) return reviews;
    const rest = reviews.filter((r) => r.id !== myReview.id);
    return [myReview, ...rest];
  }, [myReview, reviews]);

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

  if (displayedReviews.length === 0) {
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
        {displayedReviews.map((r) => (
          <ReviewCard
            key={r.id}
            review={r}
            canModerate={canModerate}
            onReplySaved={handleReplySaved}
            onDeleted={handleDeleted}
            onReviewUpdated={handleReviewUpdated}
          />
        ))}
      </div>

      {hasMore && (
        <div className="flex justify-center mt-6">
          <Button
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
            className="border-gold/30 hover:border-gold/60 hover:bg-gold/5"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
            Ver mais avaliações
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({
  review,
  canModerate,
  onReplySaved,
  onDeleted,
  onReviewUpdated,
}: {
  review: ReviewItem;
  canModerate: boolean;
  onReplySaved: (id: string, reply: string | null) => void;
  onDeleted: (id: string) => void;
  onReviewUpdated: (
    id: string,
    patch: { rating: number; comment: string | null },
  ) => void;
}) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [replyText, setReplyText] = useState(review.reply ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmDeleteReply, setConfirmDeleteReply] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingReview, setEditingReview] = useState(false);
  const [editRating, setEditRating] = useState(review.rating);
  const [editHover, setEditHover] = useState(0);
  const [editComment, setEditComment] = useState(review.comment ?? "");
  const [savingReview, setSavingReview] = useState(false);

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

  const replyDate = review.reply_at
    ? new Date(review.reply_at).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : null;

  const isAuthor = user?.id === review.client_id;

  const saveReply = async () => {
    const trimmed = replyText.trim();
    if (!trimmed) {
      toast.error("Escreva uma resposta antes de salvar.");
      return;
    }
    if (trimmed.length > 500) {
      toast.error("Resposta deve ter no máximo 500 caracteres.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any)
      .from("reviews")
      .update({
        reply: trimmed,
        reply_at: new Date().toISOString(),
        replied_by: user?.id ?? null,
      })
      .eq("id", review.id);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar a resposta.");
      return;
    }
    toast.success("Resposta publicada.");
    onReplySaved(review.id, trimmed);
    setEditing(false);
  };

  const removeReply = async () => {
    setSaving(true);
    const { error } = await (supabase as any)
      .from("reviews")
      .update({ reply: null, reply_at: null, replied_by: null })
      .eq("id", review.id);
    setSaving(false);
    setConfirmDeleteReply(false);
    if (error) {
      toast.error("Não foi possível remover a resposta.");
      return;
    }
    toast.success("Resposta removida.");
    onReplySaved(review.id, null);
    setReplyText("");
    setEditing(false);
  };

  const removeReview = async () => {
    setDeleting(true);
    const { error } = await supabase.from("reviews").delete().eq("id", review.id);
    setDeleting(false);
    setConfirmDelete(false);
    if (error) {
      toast.error("Não foi possível excluir a avaliação.");
      return;
    }
    toast.success("Avaliação excluída.");
    onDeleted(review.id);
  };

  const saveReview = async () => {
    if (editRating < 1 || editRating > 5) {
      toast.error("Selecione de 1 a 5 estrelas.");
      return;
    }
    const trimmed = editComment.trim();
    if (trimmed.length > 500) {
      toast.error("Comentário deve ter no máximo 500 caracteres.");
      return;
    }
    setSavingReview(true);
    const { error } = await supabase
      .from("reviews")
      .update({
        rating: editRating,
        comment: trimmed || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", review.id);
    setSavingReview(false);
    if (error) {
      toast.error("Não foi possível salvar a avaliação.");
      return;
    }
    toast.success("Avaliação atualizada.");
    onReviewUpdated(review.id, {
      rating: editRating,
      comment: trimmed || null,
    });
    setEditingReview(false);
  };

  const canDelete = canModerate || isAuthor;
  const editDisplay = editHover || editRating;

  const [highlight, setHighlight] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== `#review-${review.id}`) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`review-${review.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlight(true);
        setTimeout(() => setHighlight(false), 2400);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [review.id]);

  return (
    <div
      id={`review-${review.id}`}
      className={cn(
        "rounded-xl border border-border bg-card/60 backdrop-blur-sm p-5 transition-all hover:border-gold/30 scroll-mt-24",
        isAuthor && "border-gold/40 bg-gold/[0.03] ring-1 ring-gold/10",
        highlight && "border-gold ring-2 ring-gold/40 shadow-lg shadow-gold/10",
      )}
    >
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
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-body font-semibold text-foreground text-sm truncate">
              {review.client_name}
            </p>
            {isAuthor && (
              <span className="inline-flex items-center rounded-full border border-gold/50 bg-gold/15 px-2 py-0.5 text-[10px] font-body font-semibold uppercase tracking-wider text-gold">
                Sua avaliação
              </span>
            )}
            {review.reply && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-body font-semibold uppercase tracking-wider text-gold">
                <MessageSquareReply className="w-3 h-3" />
                Respondida
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Stars value={review.rating} size="sm" />
            <span className="text-[11px] text-muted-foreground">{date}</span>
          </div>
        </div>
        {canDelete && (
          <button
            type="button"
            aria-label="Excluir avaliação"
            onClick={() => setConfirmDelete(true)}
            className="text-muted-foreground/60 hover:text-destructive transition-colors p-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive shrink-0"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Comentário (modo leitura) */}
      {!editingReview && review.comment && (
        <p className="text-sm text-foreground/90 font-body leading-relaxed">
          "{review.comment}"
        </p>
      )}

      {/* Ação rápida do autor: editar minha avaliação */}
      {isAuthor && !editingReview && (
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditRating(review.rating);
              setEditComment(review.comment ?? "");
              setEditingReview(true);
            }}
            className="border-gold/40 text-gold hover:bg-gold/10 hover:text-gold hover:border-gold/60"
          >
            <Pencil className="w-3.5 h-3.5" />
            Editar minha avaliação
          </Button>
        </div>
      )}

      {/* Comentário (modo leitura) */}
      {!editingReview && review.comment && (
        <p className="text-sm text-foreground/90 font-body leading-relaxed">
          "{review.comment}"
        </p>
      )}

      {/* Editor da avaliação (autor) */}
      {editingReview && isAuthor && (
        <div className="space-y-3">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
                onClick={() => setEditRating(n)}
                onMouseEnter={() => setEditHover(n)}
                onMouseLeave={() => setEditHover(0)}
                className="transition-transform hover:scale-110 focus:outline-none rounded p-0.5"
              >
                <Star
                  className={cn(
                    "w-6 h-6 transition-colors",
                    n <= editDisplay
                      ? "fill-gold text-gold"
                      : "text-muted-foreground/30",
                  )}
                />
              </button>
            ))}
          </div>
          <Textarea
            value={editComment}
            onChange={(e) => setEditComment(e.target.value.slice(0, 500))}
            placeholder="Atualize seu comentário (opcional)..."
            rows={3}
            maxLength={500}
            className="resize-none text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {editComment.length}/500
            </span>
            <div className="flex gap-2 items-center">
              <EmojiPicker
                size="sm"
                disabled={savingReview}
                onSelect={(e) =>
                  setEditComment((prev) => (prev + e).slice(0, 500))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingReview(false);
                  setEditRating(review.rating);
                  setEditComment(review.comment ?? "");
                }}
                disabled={savingReview}
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </Button>
              <Button
                variant="gold"
                size="sm"
                onClick={saveReview}
                disabled={savingReview}
              >
                {savingReview ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Resposta existente */}
      {review.reply && !editing && (
        <div className="mt-3 rounded-lg border-l-2 border-gold/60 bg-gold/5 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] uppercase tracking-wider text-gold font-body font-semibold">
              Resposta da barbearia
              {replyDate && (
                <span className="ml-2 text-muted-foreground font-normal normal-case tracking-normal">
                  · {replyDate}
                </span>
              )}
            </p>
            {canModerate && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Editar resposta"
                  onClick={() => {
                    setReplyText(review.reply ?? "");
                    setEditing(true);
                  }}
                  className="text-muted-foreground/70 hover:text-gold transition-colors p-1 rounded-md"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Remover resposta"
                  onClick={() => setConfirmDeleteReply(true)}
                  className="text-muted-foreground/70 hover:text-destructive transition-colors p-1 rounded-md"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-foreground/90 font-body leading-relaxed">
            {review.reply}
          </p>
        </div>
      )}

      {/* Editor de resposta (admin/barbeiro) */}
      {canModerate && editing && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value.slice(0, 500))}
            placeholder="Responda como barbearia..."
            rows={3}
            maxLength={500}
            className="resize-none text-sm"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {replyText.length}/500
            </span>
            <div className="flex gap-2 items-center">
              <EmojiPicker
                size="sm"
                disabled={saving}
                onSelect={(e) =>
                  setReplyText((prev) => (prev + e).slice(0, 500))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setReplyText(review.reply ?? "");
                }}
                disabled={saving}
              >
                <X className="w-3.5 h-3.5" />
                Cancelar
              </Button>
              <Button
                variant="gold"
                size="sm"
                onClick={saveReply}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Botão "Responder" quando não há resposta ainda */}
      {canModerate && !review.reply && !editing && (
        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            className="text-gold hover:text-gold hover:bg-gold/5 -ml-2"
          >
            <MessageSquareReply className="w-4 h-4" />
            Responder
          </Button>
        </div>
      )}

      {/* Confirm: delete review */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir avaliação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A avaliação{" "}
              {review.comment ? "e o comentário " : ""}serão removidos
              permanentemente e a média da barbearia será recalculada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                removeReview();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: delete reply */}
      <AlertDialog open={confirmDeleteReply} onOpenChange={setConfirmDeleteReply}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover resposta?</AlertDialogTitle>
            <AlertDialogDescription>
              A resposta da barbearia será removida desta avaliação. Você pode
              responder novamente depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                removeReply();
              }}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
