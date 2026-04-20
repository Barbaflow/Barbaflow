ALTER TABLE public.barbershops
ADD COLUMN IF NOT EXISTS reschedule_min_hours integer NOT NULL DEFAULT 2;

COMMENT ON COLUMN public.barbershops.reschedule_min_hours IS 'Minimum hours of advance notice required for clients to reschedule their own appointments. 0 = no limit.';