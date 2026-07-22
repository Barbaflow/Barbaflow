-- super_admin opera a agenda da barbearia selecionada.
--
-- Problema: as policies de `weekly_schedule` e `schedule_blocks` não
-- reconhecem `super_admin`. `appointments`, `availability` e `services` já
-- reconhecem — essas duas ficaram de fora. Efeito concreto: o super_admin abre
-- a agenda de uma barbearia pelo AdminDashboard e o encaixe manual mostra ZERO
-- horários, porque a grade semanal do profissional é invisível para ele.
--
-- Esta migration acrescenta APENAS a cláusula de super_admin. Cada policy é
-- recriada com o seu predicado original intacto, preservando quem já podia o
-- quê:
--   * SELECT já incluía `admin_barbearia` do tenant → continua incluindo;
--   * INSERT já exigia `barber_id = auth.uid()` E papel no tenant → o `AND`
--     é preservado, e o super_admin entra como alternativa ao bloco inteiro;
--   * UPDATE e DELETE eram estritamente `barber_id = auth.uid()` → continuam
--     assim. Em particular, `admin_barbearia` NÃO ganha poder de editar ou
--     apagar a grade de outro profissional: isso não foi pedido e seria uma
--     mudança de permissão silenciosa.
--
-- Nenhum `USING (true)`, nenhuma tabela com RLS desligada, nenhum papel novo.
-- Cliente e anônimo continuam sem policy alguma nestas tabelas.
--
-- Reconhecer o papel globalmente não faz o super_admin "ver tudo de uma vez"
-- em tela nenhuma: o tenant continua vindo explícito do frontend, e
-- `useTenantScope` só honra `?barbershop=<uuid>` para super_admin e nunca
-- aceita a sentinela `_system` como tenant operacional.

/* --------------------------- weekly_schedule --------------------------- */

DROP POLICY IF EXISTS "Barbers can view own schedule" ON public.weekly_schedule;
CREATE POLICY "Barbers can view own schedule"
ON public.weekly_schedule FOR SELECT TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Barbers can create own schedule" ON public.weekly_schedule;
CREATE POLICY "Barbers can create own schedule"
ON public.weekly_schedule FOR INSERT TO authenticated
WITH CHECK (
  (
    barber_id = auth.uid()
    AND (
      public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
      OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    )
  )
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Barbers can update own schedule" ON public.weekly_schedule;
CREATE POLICY "Barbers can update own schedule"
ON public.weekly_schedule FOR UPDATE TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Barbers can delete own schedule" ON public.weekly_schedule;
CREATE POLICY "Barbers can delete own schedule"
ON public.weekly_schedule FOR DELETE TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
);

/* --------------------------- schedule_blocks --------------------------- */

DROP POLICY IF EXISTS "Barbers and admins can view blocks" ON public.schedule_blocks;
CREATE POLICY "Barbers and admins can view blocks"
ON public.schedule_blocks FOR SELECT TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Barbers can create own blocks" ON public.schedule_blocks;
CREATE POLICY "Barbers can create own blocks"
ON public.schedule_blocks FOR INSERT TO authenticated
WITH CHECK (
  (
    barber_id = auth.uid()
    AND (
      public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro')
      OR public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia')
    )
  )
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Barbers can update own blocks" ON public.schedule_blocks;
CREATE POLICY "Barbers can update own blocks"
ON public.schedule_blocks FOR UPDATE TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
);

DROP POLICY IF EXISTS "Barbers can delete own blocks" ON public.schedule_blocks;
CREATE POLICY "Barbers can delete own blocks"
ON public.schedule_blocks FOR DELETE TO authenticated
USING (
  barber_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
);
