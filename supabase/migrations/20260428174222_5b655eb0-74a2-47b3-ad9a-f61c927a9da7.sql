ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.ticket_payments REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_payments;