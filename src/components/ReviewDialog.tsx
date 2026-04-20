import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmojiPicker } from "@/components/EmojiPicker";

const reviewSchema = z.object({
  rating: z.number().int().min(1, "Selecione de 1 a 5 estrelas").max(5),
  comment: z
    .string()
    .trim()
    .max(500, "Comentário deve ter no máximo 500 caracteres")
    .optional(),
});

interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentId: string;
  barbershopId: string;
  barberName?: string | null;
  onSubmitted?: () => void;
}

export function ReviewDialog({
  open,
  onOpenChange,
  appointmentId,
  barbershopId,
  barberName,
  onSubmitted,
}: ReviewDialogProps) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setRating(0);
    setHover(0);
    setComment("");
  };

  const handleClose = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (!user) {
      toast.error("Faça login para avaliar.");
      return;
    }

    const parsed = reviewSchema.safeParse({
      rating,
      comment: comment.trim() || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.from("reviews").insert({
      appointment_id: appointmentId,
      barbershop_id: barbershopId,
      client_id: user.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
    });
    setSubmitting(false);

    if (error) {
      toast.error("Erro ao enviar avaliação. Tente novamente.");
      return;
    }

    toast.success("Avaliação enviada. Obrigado! ⭐");
    reset();
    onOpenChange(false);
    onSubmitted?.();
  };

  const display = hover || rating;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Avaliar atendimento</DialogTitle>
          <DialogDescription>
            {barberName
              ? `Como foi seu atendimento com ${barberName}?`
              : "Como foi seu atendimento?"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex items-center gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} estrela${n > 1 ? "s" : ""}`}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                className="transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md p-0.5"
              >
                <Star
                  className={cn(
                    "w-9 h-9 transition-colors",
                    n <= display
                      ? "fill-primary text-primary"
                      : "text-muted-foreground/40"
                  )}
                />
              </button>
            ))}
          </div>
          {display > 0 && (
            <p className="text-sm text-muted-foreground">
              {["", "Ruim", "Razoável", "Bom", "Ótimo", "Excelente"][display]}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground" htmlFor="review-comment">
            Comentário (opcional)
          </label>
          <Textarea
            id="review-comment"
            placeholder="Conte como foi sua experiência..."
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 500))}
            rows={4}
            maxLength={500}
            className="resize-none"
          />
          <p className="text-[10px] text-muted-foreground text-right">
            {comment.length}/500
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="gold"
            onClick={handleSubmit}
            disabled={submitting || rating === 0}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Enviar avaliação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
