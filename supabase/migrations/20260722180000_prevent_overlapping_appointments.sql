-- Prevenção de conflito de horário no BANCO.
--
-- Motivo: as três telas que criam atendimento (agendamento público, encaixe
-- manual e reagendamento) montavam a lista de horários no cliente, liam os
-- agendamentos existentes e faziam `INSERT` direto. Entre a leitura e a
-- escrita não havia nada — nem constraint, nem trigger, nem RPC — impedindo
-- que duas requisições concorrentes gravassem o MESMO profissional no MESMO
-- intervalo. Duas abas, dois clientes ou um duplo clique bastavam.
--
-- A regra de negócio NÃO muda: continua valendo "um profissional não atende
-- duas pessoas ao mesmo tempo", que já era o que a interface tentava garantir.
-- O que muda é onde ela é decidida — agora no único lugar onde a decisão é
-- atômica.
--
-- Escopo deliberadamente mínimo:
--   * apenas sobreposição por PROFISSIONAL (barber_id);
--   * cancelados ficam de fora — cancelar tem de liberar o horário;
--   * nada sobre cliente, serviço ou barbearia.

-- `EXCLUDE` com operador de sobreposição (&&) exige gist sobre tipos escalares.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Higiene antes da constraint: se já existirem sobreposições gravadas, a
-- criação falha e o motivo precisa ser visível — não silenciado.
DO $$
DECLARE
  _conflitos INTEGER;
BEGIN
  SELECT count(*) INTO _conflitos
  FROM public.appointments a
  JOIN public.appointments b
    ON a.barber_id = b.barber_id
   AND a.id < b.id
   AND a.status <> 'cancelled'
   AND b.status <> 'cancelled'
   AND tsrange(a.date + a.start_time, a.date + a.end_time, '[)')
    && tsrange(b.date + b.start_time, b.date + b.end_time, '[)');

  IF _conflitos > 0 THEN
    RAISE EXCEPTION
      'Existem % par(es) de atendimentos sobrepostos para o mesmo profissional. '
      'Resolva-os (cancelando ou reagendando) antes de aplicar esta migration.',
      _conflitos;
  END IF;
END;
$$;

-- Intervalo semiaberto '[)': um atendimento que termina 10:00 não conflita com
-- outro que começa 10:00. É exatamente a regra que o frontend já usava
-- (`t < b.e && slotEnd > b.s`).
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_no_overlap_per_barber
  EXCLUDE USING gist (
    barber_id WITH =,
    tsrange(date + start_time, date + end_time, '[)') WITH &&
  )
  WHERE (status <> 'cancelled');

COMMENT ON CONSTRAINT appointments_no_overlap_per_barber ON public.appointments IS
  'Impede dois atendimentos não cancelados sobrepostos para o mesmo profissional. '
  'Violação chega ao cliente como SQLSTATE 23P01 (exclusion_violation).';
