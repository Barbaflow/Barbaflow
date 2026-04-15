
-- Enum for appointment status
CREATE TYPE public.appointment_status AS ENUM ('scheduled', 'completed', 'cancelled', 'no_show');

-- Enum for availability status
CREATE TYPE public.availability_status AS ENUM ('livre', 'ocupado', 'folga');

-- Services table
CREATE TABLE public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  barber_id UUID NOT NULL,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Availability table
CREATE TABLE public.availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  barber_id UUID NOT NULL,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status public.availability_status NOT NULL DEFAULT 'livre',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Appointments table
CREATE TABLE public.appointments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id UUID NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  client_id UUID NOT NULL,
  barber_id UUID NOT NULL,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status public.appointment_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_services_barbershop ON public.services(barbershop_id);
CREATE INDEX idx_services_barber ON public.services(barber_id);
CREATE INDEX idx_availability_barbershop_date ON public.availability(barbershop_id, date);
CREATE INDEX idx_availability_barber_date ON public.availability(barber_id, date);
CREATE INDEX idx_appointments_barbershop_date ON public.appointments(barbershop_id, date);
CREATE INDEX idx_appointments_client ON public.appointments(client_id);
CREATE INDEX idx_appointments_barber_date ON public.appointments(barber_id, date);

-- Updated_at triggers
CREATE TRIGGER update_services_updated_at BEFORE UPDATE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_availability_updated_at BEFORE UPDATE ON public.availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: Services
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view services of approved barbershops"
  ON public.services FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.barbershops b WHERE b.id = barbershop_id AND b.status = 'approved')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Barbers and admins can insert services"
  ON public.services FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR (public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro') AND barber_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Barbers and admins can update services"
  ON public.services FOR UPDATE TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR (public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro') AND barber_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Admins can delete services"
  ON public.services FOR DELETE TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- RLS: Availability
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view availability of approved barbershops"
  ON public.availability FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.barbershops b WHERE b.id = barbershop_id AND b.status = 'approved')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Barbers and admins can insert availability"
  ON public.availability FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR (public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro') AND barber_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Barbers and admins can update availability"
  ON public.availability FOR UPDATE TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR (public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro') AND barber_id = auth.uid())
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Admins can delete availability"
  ON public.availability FOR DELETE TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- RLS: Appointments
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients see own appointments, barbers and admins see barbershop appointments"
  ON public.appointments FOR SELECT TO authenticated
  USING (
    client_id = auth.uid()
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Authenticated users can create appointments"
  ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (
    client_id = auth.uid()
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Clients, barbers and admins can update appointments"
  ON public.appointments FOR UPDATE TO authenticated
  USING (
    client_id = auth.uid()
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
    OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR public.has_role(auth.uid(), 'super_admin')
  );

CREATE POLICY "Admins can delete appointments"
  ON public.appointments FOR DELETE TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.availability;
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
