-- O barbeiro passa a poder apagar a PRÓPRIA disponibilidade.
--
-- DEFEITO, não mudança de regra. A policy de DELETE de `availability` era
-- `admin_barbearia OR super_admin` — sem ramo nenhum para o dono da linha. As
-- outras três policies da mesma tabela sempre tiveram esse ramo:
--
--     INSERT  admin OR (barbeiro AND barber_id = auth.uid()) OR super
--     UPDATE  admin OR (barbeiro AND barber_id = auth.uid()) OR super
--     DELETE  admin                                          OR super   ← esta
--     SELECT  público OR staff                               OR super
--
-- Ou seja: o barbeiro podia CRIAR e EDITAR a própria janela e não podia
-- APAGÁ-LA. O botão de excluir existe na tela (`ScheduleManager`) desde sempre
-- e simplesmente não funcionava para ele — a chamada saía, a RLS recusava, e a
-- tela nem avisava, porque o `if (!error)` do componente só mostrava sucesso e
-- ficava calado no erro. Dois defeitos que se escondiam um ao outro.
--
-- É ADITIVA: só concede, e a quem já pode inserir e editar a mesma linha. O
-- conjunto de quem apaga depois desta migration é um SUPERCONJUNTO do de agora,
-- então não entra nas duas fases da §2.1.
--
-- ────────────────────────────────────────────────────────────────────────────
-- POR QUE O RAMO EXIGE O PAPEL `barbeiro`, E NÃO SÓ `barber_id = auth.uid()`
--
-- Para ficar idêntico ao de INSERT e UPDATE. Sem o `AND` do papel, alguém que
-- deixou de ser barbeiro do tenant — mas cujas linhas antigas continuam
-- gravadas com o id dele — seguiria apagando dado de uma barbearia à qual não
-- pertence mais. É o mesmo raciocínio que a 20260805200000 aplicou à grade.
--
-- O QUE NÃO MUDA
--
--   • o admin continua apagando qualquer linha do tenant, inclusive de
--     terceiros. Isso já era assim e não é tocado aqui — o aviso na tela, que
--     entra no mesmo PR, é a resposta de PRODUTO para essa capacidade, não uma
--     restrição de RLS;
--   • `weekly_schedule` e `schedule_blocks` NÃO são tocadas. O admin continua
--     sem escrever a grade alheia, como a 20260805200000 e a 20260806120000
--     deixaram;
--   • nenhuma linha é apagada por esta migration. Ela muda quem PODE apagar,
--     não apaga nada.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • como barbeiro: apagar a própria linha de `availability` é ACEITO;
--   • como barbeiro: apagar a linha de OUTRO barbeiro é RECUSADO (42501);
--   • como admin: apagar qualquer linha do tenant continua ACEITO;
--   • como barbeiro de OUTRA barbearia: recusado, mesmo com o id casando —
--     é o que o `AND` do papel garante;
--   • as outras três policies de `availability` seguem com o mesmo texto.
--
-- ROLLBACK
--   DROP POLICY IF EXISTS "Admins can delete availability" ON public.availability;
--   CREATE POLICY "Admins can delete availability"
--     ON public.availability FOR DELETE TO authenticated
--     USING (
--       public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
--       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
--     );
-- ============================================================================

DROP POLICY IF EXISTS "Admins can delete availability" ON public.availability;

CREATE POLICY "Admins can delete availability"
  ON public.availability
  FOR DELETE
  TO authenticated
  USING (
    public.has_role_in_barbershop(auth.uid(), barbershop_id, 'admin_barbearia'::public.app_role)
    -- O ramo que faltava, no mesmo formato de INSERT e UPDATE.
    OR (
      barber_id = auth.uid()
      AND public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Admins can delete availability" ON public.availability IS
  'Apaga janela de disponibilidade: a administração do tenant (qualquer linha), '
  'o próprio profissional (só a dele, e só enquanto for `barbeiro` da casa) e o '
  'super_admin. O ramo do dono entrou em 20260806150000 — até então ele podia '
  'criar e editar a própria linha mas não apagá-la, e o botão da tela falhava '
  'em silêncio. O nome da policy é o de origem e ficou: renomear exigiria '
  'DROP/CREATE num arquivo que já faz exatamente isso por outro motivo.';
