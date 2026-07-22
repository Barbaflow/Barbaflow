-- Privacidade de `profiles`.
--
-- Falha comprovada: a policy de SELECT era
--
--   CREATE POLICY "Users can view all profiles"
--     ON public.profiles FOR SELECT TO authenticated USING (true);
--
-- Como `authenticated` também tinha o GRANT de SELECT na tabela, QUALQUER
-- usuário logado lia a tabela inteira — inclusive a coluna `phone`. Medido com
-- `SET LOCAL ROLE authenticated` + claims de JWT: um cliente comum enumerou 6
-- perfis e leu o telefone de outro cliente (11988887777). `anon` já estava
-- corretamente bloqueado (não tem o GRANT).
--
-- Correção, em duas partes:
--
--   1. A TABELA passa a ser privada: cada pessoa vê a própria linha. O acesso
--      administrativo global fica só com super_admin — e não como desculpa para
--      manter `USING (true)`, mas como o papel que de fato precisa dele
--      (painel administrativo, suporte).
--
--      Admin e barbeiro deixam de ter SELECT direto. Nada se perde: o que eles
--      realmente precisam já existe em RPCs com validação de tenant —
--      `get_barbershop_clients` (nome, avatar e telefone dos clientes DAQUELA
--      barbearia) e `get_client_phone` (telefone de um cliente que tem
--      atendimento com eles).
--
--   2. Para o que é legitimamente público — o nome de quem escreveu uma
--      avaliação, o nome do profissional no cartão de um agendamento — entra
--      uma RPC de resumo com retorno MÍNIMO. Ela devolve três campos e só:
--      user_id, full_name e avatar_url. Nunca telefone, nunca e-mail, nunca a
--      linha inteira.
--
-- `phone` não recebe tratamento de coluna à parte porque não precisa: com a
-- policy acima, a única linha em que ele é alcançável é a do próprio dono.
--
-- Nada de dados é alterado: nenhum perfil é criado, editado ou apagado.
-- As policies de INSERT e UPDATE já eram mínimas (`user_id = auth.uid()`) e
-- ficam exatamente como estão.

/* ----------------------- 1. a tabela vira privada ---------------------- */

DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Usuário lê o próprio perfil"
ON public.profiles FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
);

COMMENT ON TABLE public.profiles IS
  'Perfil do usuário. A tabela é privada: cada pessoa lê apenas a própria '
  'linha (super_admin lê todas). Nome e avatar de terceiros vêm de '
  'get_public_profile_summaries; telefone de cliente vem de get_client_phone '
  'ou get_barbershop_clients, ambos com validação de tenant.';

/* ------------------ 2. resumo público, retorno mínimo ------------------ */

CREATE OR REPLACE FUNCTION public.get_public_profile_summaries(_user_ids uuid[])
RETURNS TABLE (user_id uuid, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Três colunas, ponto. Sem telefone e sem o fallback de e-mail que
  -- `get_barber_display_names` usa para profissionais — aqui um cliente sem
  -- nome preenchido simplesmente não tem nome a exibir, e a interface decide
  -- o rótulo. Vazar a parte local do e-mail seria trocar um vazamento por outro.
  SELECT p.user_id,
         NULLIF(TRIM(p.full_name), '') AS full_name,
         p.avatar_url
  FROM public.profiles p
  WHERE p.user_id = ANY(_user_ids)
    -- Conta anonimizada não volta a aparecer em lugar nenhum.
    AND p.anonymized_at IS NULL;
$$;

COMMENT ON FUNCTION public.get_public_profile_summaries(uuid[]) IS
  'Nome e avatar de um conjunto conhecido de usuários, para exibição pública '
  '(autores de avaliação, profissionais em cartões). Retorno mínimo: nunca '
  'telefone, nunca e-mail, nunca a linha completa.';

REVOKE ALL ON FUNCTION public.get_public_profile_summaries(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile_summaries(uuid[]) TO anon, authenticated;
