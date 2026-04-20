ALTER TABLE public.client_notes
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_client_notes_pinned
  ON public.client_notes (barbershop_id, client_id, pinned DESC, created_at DESC);