-- Devolve o ramo `super_admin` à policy de INSERT de `weekly_schedule`.
--
-- CORREÇÃO DE EFEITO COLATERAL NÃO DOCUMENTADO, não mudança de produto.
--
-- A 20260805200000 ("só `barbeiro` atende") recriou a policy de INSERT de
-- `weekly_schedule` para exigir o papel `barbeiro`. Ao recriá-la, escreveu o
-- predicado do zero e não trouxe de volta o `OR has_role(auth.uid(),
-- 'super_admin')` que a 20260722220000 tinha acrescentado. Nem o arquivo da
-- migration, nem a mensagem do commit, nem a descrição do PR #64 mencionam
-- `super_admin` — a palavra não aparece uma única vez naquele diff. Foi perda
-- silenciosa, e é o que esta migration desfaz.
--
-- Efeito concreto da perda: o super_admin deixou de conseguir cadastrar grade
-- em nome de um profissional pelo AdminDashboard, que é o caminho de correção
-- de tenant com problema. É exatamente o buraco que a 20260722220000 existiu
-- para fechar — lá o sintoma era o encaixe manual mostrando ZERO horários.
--
-- ────────────────────────────────────────────────────────────────────────────
-- A REGRA NOVA CONTINUA INTEIRA
--
-- `admin_barbearia` segue RECUSADO, e é de propósito: a decisão de produto da
-- 20260805200000 não muda aqui. O predicado restaurado é o da regra nova com o
-- ramo de plataforma de volta:
--
--     ( barber_id = auth.uid() AND papel `barbeiro` no tenant )
--     OR super_admin
--
-- Repare que o `OR` é alternativa ao BLOCO INTEIRO, incluindo
-- `barber_id = auth.uid()`. É assim desde a 20260722220000 e é o que faz o caso
-- de uso funcionar: o super_admin cadastra a grade DE OUTRA PESSOA. Amarrá-lo a
-- `barber_id = auth.uid()` devolveria a palavra `super_admin` ao predicado sem
-- devolver a capacidade — a grade que ele precisa consertar nunca é a dele.
--
-- ────────────────────────────────────────────────────────────────────────────
-- É ADITIVA, ENTÃO NÃO ENTRA EM DUAS FASES (§2.1 do CLAUDE.md)
--
-- Só devolve acesso a um papel; ninguém perde nada. Não há frontend a migrar
-- antes, não há fase 2 a escrever. O conjunto de quem pode inserir depois desta
-- migration é um SUPERCONJUNTO do de agora.
--
-- ────────────────────────────────────────────────────────────────────────────
-- AUDITORIA: A INSERT DE weekly_schedule FOI A ÚNICA PERDA
--
-- A 20260722220000 acrescentou `super_admin` a OITO policies — quatro em
-- `weekly_schedule` e quatro em `schedule_blocks`. Conferido no banco remoto em
-- 06/08/2026, depois de a 20260805200000 já estar aplicada:
--
--     schedule_blocks   INSERT/UPDATE/DELETE/SELECT   super_admin presente
--     weekly_schedule   SELECT/UPDATE/DELETE          super_admin presente
--     weekly_schedule   INSERT                        AUSENTE  ← esta
--
-- As três funções que a 20260805200000 substituiu com CREATE OR REPLACE
-- (`get_public_barbers`, `get_public_barbers_v2`,
-- `role_counts_toward_barber_limit`) não citavam `super_admin` em NENHUMA das
-- suas definições anteriores — conferido nos corpos em 20260420123902,
-- 20260804120000 e 20260720130000. Não havia o que perder ali.
--
-- ────────────────────────────────────────────────────────────────────────────
-- O MOCK JÁ ESTAVA CERTO — QUEM DIVERGIU FOI O BANCO
--
-- `authorizeWeeklySchedule` (src/mocks/rules.ts) sempre teve
-- `if (actorIsSuperAdmin()) return null;` ANTES da checagem de `barbeiroRoleIn`.
-- Ou seja: de 05/08 até esta migration o mock permitia o que o banco recusava,
-- e o harness "provava" um fluxo que a produção barraria — o inverso do defeito
-- que a §1 do CLAUDE.md pede que se evite, e igualmente ruim. Esta migration
-- realinha o banco ao mock; `rules.ts` NÃO muda.
--
-- VERIFICAÇÕES APÓS APLICAR
--   • como super_admin: INSERT em `weekly_schedule` com `barber_id` de OUTRA
--     pessoa é ACEITO;
--   • como barbeiro: a própria grade continua ACEITA; a de outro, RECUSADA;
--   • como admin_barbearia: a própria grade continua RECUSADA (42501);
--   • as outras sete policies de 20260722220000 seguem com `super_admin`;
--   • `get_public_barbers_v2` não muda (esta migration não toca em função).
--
-- ROLLBACK
--   -- volta ao predicado da 20260805200000 (sem o ramo de plataforma):
--   DROP POLICY IF EXISTS "Barbers can create own schedule" ON public.weekly_schedule;
--   CREATE POLICY "Barbers can create own schedule"
--     ON public.weekly_schedule FOR INSERT TO authenticated
--     WITH CHECK (
--       barber_id = auth.uid()
--       AND public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
--     );
-- ============================================================================

DROP POLICY IF EXISTS "Barbers can create own schedule" ON public.weekly_schedule;

CREATE POLICY "Barbers can create own schedule"
  ON public.weekly_schedule
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      barber_id = auth.uid()
      AND public.has_role_in_barbershop(auth.uid(), barbershop_id, 'barbeiro'::public.app_role)
    )
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

COMMENT ON POLICY "Barbers can create own schedule" ON public.weekly_schedule IS
  'Só quem atende cadastra grade, e só a própria — a regra da 20260805200000 '
  'segue valendo, e `admin_barbearia` continua fora. O ramo `super_admin` é '
  'alternativa ao bloco inteiro (não fica preso a barber_id = auth.uid()), '
  'porque o caso de uso é justamente consertar a grade DE OUTRA pessoa pelo '
  'AdminDashboard. Ele existia desde 20260722220000 e a 20260805200000 o '
  'removeu sem documentar; 20260806120000 devolve.';
