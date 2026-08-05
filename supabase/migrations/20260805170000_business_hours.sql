-- Horário de funcionamento da barbearia — schema e validação (PR 1 de 3).
--
-- O QUE ESTA MIGRATION RESOLVE
-- Até aqui o sistema NÃO tinha o conceito. Existia só `weekly_schedule`, que é
-- por PROFISSIONAL (`barber_id NOT NULL`), e a aba rotulada "Horários de
-- Funcionamento" mostrava, na verdade, a grade pessoal de quem estava logado.
-- Não havia nada que dissesse "esta casa atende das 9 às 18", e portanto nada
-- que impedisse um barbeiro de se cadastrar das 6h às 23h.
--
-- Esta migration cria o envelope e a trava. NÃO cria tela nem exposição
-- pública — são os PRs 2 e 3.
--
-- ────────────────────────────────────────────────────────────────────────────
-- DUAS SEMÂNTICAS QUE PRECISAM FICAR EXPLÍCITAS
--
--   • LINHA AUSENTE ≠ FECHADO. Sem linha para um dia, não há restrição
--     nenhuma. É isto que faz a migration não quebrar as barbearias que já
--     existem: a tabela nasce vazia e nada muda até um admin configurar;
--   • `is_closed = true` é a afirmação explícita "não abrimos neste dia", e aí
--     nenhum turno pessoal é aceito.
--
-- Sem essa distinção, "ainda não configurei" e "fecho aos domingos" seriam o
-- mesmo estado — e a página pública do PR 3 não teria como mostrar "Domingo:
-- fechado" sem inventar.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE UM ENVELOPE ÚNICO POR DIA, E NÃO VÁRIAS FAIXAS
--
-- `weekly_schedule` aceita várias faixas por dia (UNIQUE por start_time), e é
-- assim que se modela o turno partido do almoço — POR PROFISSIONAL. O envelope
-- responde outra pergunta: "de quando até quando esta casa PODE ter
-- atendimento". Uma faixa por dia deixa a validação ser contenção simples
-- (`turno ⊆ envelope`) em vez de cobertura por união de intervalos.
--
-- Se um dia for preciso "fecha para o almoço" no nível da casa, isso vira uma
-- segunda faixa e a validação muda junto. Hoje seria complexidade sem caso.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A DECISÃO MENOS ÓBVIA: TURNO INATIVO NÃO É VALIDADO
--
-- O trigger de `weekly_schedule` ignora a linha com `is_active = false`, e isso
-- não é frouxidão — é o que torna o PR 2 possível.
--
-- Quando o admin apertar o expediente, o trigger 2 vai REJEITAR e listar os
-- turnos em conflito. A saída oferecida ao admin será desativá-los
-- deliberadamente. Se o trigger 1 validasse turno inativo, esse `UPDATE`
-- (`is_active = false`) seria ele próprio rejeitado — a linha está fora do
-- envelope, afinal — e o admin ficaria sem saída, preso entre dois triggers.
--
-- Reativar continua sendo validado: o `UPDATE` que põe `is_active = true`
-- dispara o trigger e é recusado se a linha ainda estiver fora.
--
-- ────────────────────────────────────────────────────────────────────────────
-- SEM EXCEÇÃO PARA super_admin — E A DIFERENÇA ENTRE PODER E DEVER
--
-- Decisão explícita: a VALIDAÇÃO vale para todos. Se o expediente é limite, é
-- limite — um turno fora dele geraria oferta pública fora do horário da casa,
-- independentemente de quem gravou.
--
-- Isso é diferente da RLS de ESCRITA, onde o `super_admin` entra junto com o
-- `admin_barbearia`, como em `services` (20260415170006) e em todas as tabelas
-- de configuração de tenant. Sem isso ele não conseguiria consertar o
-- expediente de uma barbearia com problema, que é a razão de o papel existir.
-- Ele pode ESCREVER; não pode escrever ERRADO.
--
-- ────────────────────────────────────────────────────────────────────────────
-- GRANTS: A TABELA NASCE FECHADA, E É PRECISO CONCEDER
--
-- Desde 20260805150000 o `ALTER DEFAULT PRIVILEGES` de `postgres` não concede
-- mais nada a `anon`/`authenticated`. Então:
--
--   • `authenticated` recebe CRUD NOMINAL aqui (a RLS é que filtra) — sem esta
--     linha a tabela seria invisível para a equipe;
--   • `anon` NÃO recebe nada, e não deve. A leitura pública do PR 3 será por
--     RPC SECURITY DEFINER, no padrão de get_public_products /
--     get_public_barbers_v2 / get_public_barber_ratings;
--   • `service_role` continua herdando pelo default próprio, que aquela
--     migration manteve de propósito.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • `has_table_privilege('anon','public.business_hours','SELECT')` => false
--   • `has_table_privilege('authenticated','public.business_hours','SELECT')` => true
--   • a tabela está vazia, e nenhum turno existente foi tocado:
--     `SELECT count(*) FROM public.business_hours;` => 0
--   • cadastrar turno pessoal continua funcionando em toda barbearia (nenhuma
--     tem envelope ainda);
--   • definir um envelope e tentar turno fora dele => erro legível;
--   • definir envelope que conflita com turno ativo => erro listando o conflito.
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_enforce_shift_within_business_hours ON public.weekly_schedule;
--   DROP TRIGGER IF EXISTS trg_business_hours_fit_shifts ON public.business_hours;
--   DROP TRIGGER IF EXISTS trg_business_hours_updated_at ON public.business_hours;
--   DROP FUNCTION IF EXISTS public.enforce_shift_within_business_hours();
--   DROP FUNCTION IF EXISTS public.enforce_business_hours_fit_shifts();
--   DROP FUNCTION IF EXISTS public.weekday_pt(smallint);
--   DROP TABLE IF EXISTS public.business_hours;
-- Reverter é seguro: nada fora desta migration depende dela, e nenhum dado
-- pré-existente foi alterado.
-- ============================================================================

/* ═══════════ 1. a tabela ══════════════════════════════════════════════════ */

CREATE TABLE IF NOT EXISTS public.business_hours (
  id            uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  barbershop_id uuid        NOT NULL REFERENCES public.barbershops(id) ON DELETE CASCADE,
  -- 0 = domingo, a mesma convenção de `weekly_schedule.day_of_week` e de
  -- `EXTRACT(DOW …)`. Divergir aqui seria erro garantido na comparação.
  day_of_week   smallint    NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time     time,
  close_time    time,
  is_closed     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Um envelope por dia. É o que sustenta a validação por contenção simples.
  CONSTRAINT business_hours_one_per_day UNIQUE (barbershop_id, day_of_week),

  -- Fechado não tem horário; aberto tem os dois, e abre antes de fechar.
  -- Sem virada de dia: decisão explícita, não esquecimento.
  CONSTRAINT business_hours_coerent CHECK (
    (is_closed AND open_time IS NULL AND close_time IS NULL)
    OR (NOT is_closed AND open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
  )
);

COMMENT ON TABLE public.business_hours IS
  'Expediente da barbearia: um envelope por dia da semana. LINHA AUSENTE = SEM '
  'RESTRIÇÃO (não é "fechado"); is_closed = true é a afirmação explícita de que '
  'não se abre no dia. Limita weekly_schedule, que é por profissional. Leitura '
  'pública NÃO sai daqui — o PR 3 expõe por RPC SECURITY DEFINER.';

COMMENT ON COLUMN public.business_hours.day_of_week IS '0 = domingo, como em weekly_schedule e EXTRACT(DOW).';
COMMENT ON COLUMN public.business_hours.is_closed IS 'true = nenhum turno pessoal aceito neste dia.';

CREATE INDEX IF NOT EXISTS business_hours_barbershop_idx
  ON public.business_hours (barbershop_id, day_of_week);

DROP TRIGGER IF EXISTS trg_business_hours_updated_at ON public.business_hours;
CREATE TRIGGER trg_business_hours_updated_at
  BEFORE UPDATE ON public.business_hours
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* ═══════════ 2. RLS e grants ═════════════════════════════════════════════ */

ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;

-- A equipe INTEIRA lê: o barbeiro precisa ver o limite contra o qual esbarra,
-- senão a mensagem do trigger vira mistério na tela dele.
CREATE POLICY "Staff can view business hours of their barbershop"
  ON public.business_hours
  FOR SELECT
  TO authenticated
  USING (
    public.viewer_is_barbershop_staff(barbershop_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Escrita: administração do próprio tenant. `super_admin` entra junto, como em
-- toda tabela de configuração — ver o cabeçalho.
CREATE POLICY "Admins manage business hours of their barbershop"
  ON public.business_hours
  FOR ALL
  TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Nominal, porque a tabela nasce sem nada (20260805150000). `anon` fica fora.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_hours TO authenticated;

/* ═══════════ 3. auxiliar de mensagem ═════════════════════════════════════ */

-- Existe só para o texto do erro. `to_char` dependeria de lc_time do servidor;
-- um CASE fixo é previsível e não muda com a configuração da instância.
CREATE OR REPLACE FUNCTION public.weekday_pt(_dow smallint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _dow
    WHEN 0 THEN 'domingo'
    WHEN 1 THEN 'segunda-feira'
    WHEN 2 THEN 'terça-feira'
    WHEN 3 THEN 'quarta-feira'
    WHEN 4 THEN 'quinta-feira'
    WHEN 5 THEN 'sexta-feira'
    WHEN 6 THEN 'sábado'
    ELSE 'dia ' || _dow::text
  END;
$$;

/* ═══════════ 4. trigger 1 — turno pessoal dentro do envelope ═════════════ */

CREATE OR REPLACE FUNCTION public.enforce_shift_within_business_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _env RECORD;
BEGIN
  -- Turno desativado não é oferecido a ninguém, e validá-lo prenderia o admin
  -- entre dois triggers na hora de resolver conflito. Ver o cabeçalho.
  IF NOT COALESCE(NEW.is_active, true) THEN
    RETURN NEW;
  END IF;

  SELECT bh.open_time, bh.close_time, bh.is_closed
    INTO _env
    FROM public.business_hours bh
   WHERE bh.barbershop_id = NEW.barbershop_id
     AND bh.day_of_week   = NEW.day_of_week;

  -- Ausência de envelope = sem restrição. É o que mantém compatibilidade com
  -- todas as barbearias de hoje.
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF _env.is_closed THEN
    RAISE EXCEPTION
      'A barbearia não abre %. Ajuste o expediente antes de cadastrar turno neste dia.',
      public.weekday_pt(NEW.day_of_week)
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.start_time < _env.open_time OR NEW.end_time > _env.close_time THEN
    RAISE EXCEPTION
      'A barbearia funciona das % às % %. O turno %–% fica fora do expediente — ajuste o horário ou peça ao administrador para ampliar o funcionamento.',
      to_char(_env.open_time, 'HH24:MI'),
      to_char(_env.close_time, 'HH24:MI'),
      public.weekday_pt(NEW.day_of_week),
      to_char(NEW.start_time, 'HH24:MI'),
      to_char(NEW.end_time, 'HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_shift_within_business_hours() IS
  'Turno pessoal precisa caber no expediente da barbearia. Sem envelope para o '
  'dia, passa livre. Turno inativo não é validado — é o que permite ao admin '
  'desativar conflitos ao apertar o expediente.';

DROP TRIGGER IF EXISTS trg_enforce_shift_within_business_hours ON public.weekly_schedule;
CREATE TRIGGER trg_enforce_shift_within_business_hours
  BEFORE INSERT OR UPDATE ON public.weekly_schedule
  FOR EACH ROW EXECUTE FUNCTION public.enforce_shift_within_business_hours();

/* ═══════════ 5. trigger 2 — envelope não órfã turno existente ════════════ */

CREATE OR REPLACE FUNCTION public.enforce_business_hours_fit_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _conflitos text;
  _total     integer;
BEGIN
  -- Só turnos ATIVOS contam como conflito: os inativos são justamente a saída
  -- que o admin usa para resolver, e recontá-los faria a saída não funcionar.
  SELECT count(*),
         string_agg(
           format('%s (%s–%s)',
                  COALESCE(NULLIF(btrim(p.full_name), ''), 'profissional'),
                  to_char(w.start_time, 'HH24:MI'),
                  to_char(w.end_time, 'HH24:MI')),
           ', ' ORDER BY w.start_time)
    INTO _total, _conflitos
    FROM public.weekly_schedule w
    LEFT JOIN public.profiles p ON p.user_id = w.barber_id
   WHERE w.barbershop_id = NEW.barbershop_id
     AND w.day_of_week   = NEW.day_of_week
     AND w.is_active
     AND (
       NEW.is_closed
       OR w.start_time < NEW.open_time
       OR w.end_time   > NEW.close_time
     );

  IF COALESCE(_total, 0) = 0 THEN
    RETURN NEW;
  END IF;

  -- Nunca apaga nem apara turno de outra pessoa: recusa e diz exatamente quais
  -- são. A saída deliberada (desativar) é do admin, na tela do PR 2.
  IF NEW.is_closed THEN
    RAISE EXCEPTION
      'Não dá para marcar % como fechado: % turno(s) ativo(s) neste dia — %. Desative-os antes.',
      public.weekday_pt(NEW.day_of_week), _total, _conflitos
      USING ERRCODE = 'check_violation';
  ELSE
    RAISE EXCEPTION
      'Este expediente (%–%) deixaria % turno(s) de fora %: %. Amplie o horário ou desative os turnos em conflito antes de salvar.',
      to_char(NEW.open_time, 'HH24:MI'),
      to_char(NEW.close_time, 'HH24:MI'),
      _total,
      public.weekday_pt(NEW.day_of_week),
      _conflitos
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.enforce_business_hours_fit_shifts() IS
  'Recusa expediente que deixaria turno ATIVO de fora, listando os conflitos. '
  'Nunca apaga nem apara dado de outra pessoa — a decisão de desativar é do '
  'admin, explícita. Sem esta trava a regra seria contornável pela ordem: '
  'envelope largo, turno fora, envelope apertado depois.';

DROP TRIGGER IF EXISTS trg_business_hours_fit_shifts ON public.business_hours;
CREATE TRIGGER trg_business_hours_fit_shifts
  BEFORE INSERT OR UPDATE ON public.business_hours
  FOR EACH ROW EXECUTE FUNCTION public.enforce_business_hours_fit_shifts();
