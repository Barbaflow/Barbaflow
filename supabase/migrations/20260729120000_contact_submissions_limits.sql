-- Limites de conteúdo e de vazão em `contact_submissions` (aditiva).
--
-- PROBLEMA
-- A tabela foi criada em 20260416012649 sem nenhuma restrição de conteúdo, e
-- `anon` tem `GRANT INSERT` direto (20260721140000). Os únicos limites que
-- existem hoje moram no formulário — `src/routes/contato.tsx` recusa nome acima
-- de 100, e-mail acima de 255 e mensagem acima de 2000 caracteres, e valida o
-- formato do e-mail com uma expressão regular. Nada disso é controle de acesso:
-- é validação de frontend, e o PostgREST está exposto sem ela.
--
-- Duas consequências concretas, agora que existe uma tela lendo essas linhas
-- (`/admin/mensagens`, item A4 do roadmap):
--
--   1. um POST direto na Data API grava nome, e-mail ou mensagem de qualquer
--      tamanho — uma mensagem de megabytes é renderizada por inteiro na caixa
--      de entrada do super_admin;
--   2. nada impede repetir o mesmo INSERT em laço. A caixa de entrada é o
--      único canal de contato do produto, e inundá-la a torna inútil.
--
-- O QUE ESTA MIGRATION FAZ
-- Repete no banco os limites que o formulário já aplica — os mesmos números,
-- conferidos em `contato.tsx`, não outros — e acrescenta um teto de vazão por
-- e-mail. É aditiva: só cria constraints, função, trigger e índices. Nenhuma
-- linha existente é alterada ou removida.
--
-- POR QUE AS CONSTRAINTS SÃO `NOT VALID`
-- `NOT VALID` não enfraquece a proteção do que vem pela frente: toda linha
-- inserida ou atualizada a partir daqui é verificada normalmente. O que ele
-- evita é a migration falhar no `db push` por causa de alguma linha antiga
-- gravada antes de qualquer limite existir — o histórico não pode ser reescrito
-- por uma migration, e recusar a aplicação inteira por causa dele deixaria a
-- tabela sem proteção nenhuma. A validação retroativa é um passo separado,
-- descrito no rodapé, a ser rodado depois de olhar o que existe.
--
-- POR QUE O LIMITE DE VAZÃO É POR E-MAIL, E O QUE ELE NÃO RESOLVE
-- O e-mail é o único identificador estável que a tabela guarda: não há sessão
-- (o remetente é anônimo por definição) nem IP disponível dentro do Postgres.
-- Isto é uma barreira contra envio repetido — o mesmo visitante mandando a
-- mesma dúvida dez vezes, ou um script ingênuo em laço. NÃO é proteção contra
-- abuso determinado: quem varia o e-mail a cada requisição passa. Fechar esse
-- caso exige rate limit na borda (Edge Function ou WAF), que é outra frente e
-- não cabe numa migration.
--
-- ROLLBACK CONCEITUAL (seguro: nada aqui é destrutivo)
--   DROP TRIGGER IF EXISTS contact_submissions_rate_limit ON public.contact_submissions;
--   DROP FUNCTION IF EXISTS public.enforce_contact_submission_rate_limit();
--   DROP INDEX IF EXISTS public.contact_submissions_email_recent_idx;
--   DROP INDEX IF EXISTS public.contact_submissions_created_at_idx;
--   ALTER TABLE public.contact_submissions
--     DROP CONSTRAINT IF EXISTS contact_submissions_name_length,
--     DROP CONSTRAINT IF EXISTS contact_submissions_email_length,
--     DROP CONSTRAINT IF EXISTS contact_submissions_email_format,
--     DROP CONSTRAINT IF EXISTS contact_submissions_phone_length,
--     DROP CONSTRAINT IF EXISTS contact_submissions_message_length;
-- Nenhum dado é migrado nem destruído: a mudança é só de restrição.

/* ═══════════ 1. limites de tamanho e formato ══════════════════════════════ */

-- Os números vêm de `src/routes/contato.tsx`: name 100, email 255, message
-- 2000 e o `maxLength={20}` do campo de telefone. `btrim` antes de medir porque
-- é assim que o formulário grava (`form.name.trim()`), e espaço em branco não
-- deve consumir o limite nem passar por conteúdo.
--
-- O piso de 1 caractere replica a validação de campo obrigatório do formulário:
-- `NOT NULL` sozinho aceita a string vazia, e uma mensagem vazia na caixa de
-- entrada é ruído puro.
ALTER TABLE public.contact_submissions
  ADD CONSTRAINT contact_submissions_name_length
  CHECK (char_length(btrim(name)) BETWEEN 1 AND 100) NOT VALID;

ALTER TABLE public.contact_submissions
  ADD CONSTRAINT contact_submissions_email_length
  CHECK (char_length(btrim(email)) BETWEEN 1 AND 255) NOT VALID;

-- Mesma regra do formulário: algo, arroba, algo, ponto, algo — sem espaços.
-- Deliberadamente frouxa. Validar e-mail por regex estrita recusa endereço
-- válido, e quem confirma de verdade é a resposta chegando.
ALTER TABLE public.contact_submissions
  ADD CONSTRAINT contact_submissions_email_format
  CHECK (btrim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') NOT VALID;

-- Telefone é opcional (a coluna é anulável e o formulário grava NULL quando o
-- campo fica em branco); quando vem, respeita o mesmo teto do campo.
ALTER TABLE public.contact_submissions
  ADD CONSTRAINT contact_submissions_phone_length
  CHECK (phone IS NULL OR char_length(btrim(phone)) BETWEEN 1 AND 20) NOT VALID;

ALTER TABLE public.contact_submissions
  ADD CONSTRAINT contact_submissions_message_length
  CHECK (char_length(btrim(message)) BETWEEN 1 AND 2000) NOT VALID;

/* ═══════════ 2. teto de vazão por e-mail ══════════════════════════════════ */

-- SECURITY DEFINER não é detalhe de estilo aqui, é o que faz a função
-- funcionar: o trigger roda com o papel de quem insere — `anon`, que não tem
-- SELECT na tabela e ainda esbarraria na policy de leitura restrita ao
-- super_admin. Como invocador, a contagem voltaria 0 sempre e o teto nunca
-- seria alcançado. Como definidor, a função conta sobre a tabela inteira.
--
-- `search_path` fixo em 'public' pelo motivo de sempre em SECURITY DEFINER:
-- impedir que um search_path de sessão redirecione os nomes não qualificados.
CREATE OR REPLACE FUNCTION public.enforce_contact_submission_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  -- Janela e teto juntos: até 3 mensagens do mesmo e-mail a cada 10 minutos.
  -- Folga suficiente para quem escreve, erra o telefone e reenvia — e baixo o
  -- bastante para que um laço pare no quarto disparo. Os mesmos dois valores
  -- estão em `src/mocks/rules.ts`; mudar aqui exige mudar lá, e o harness
  -- `mensagens-contato` compara os dois.
  janela   CONSTANT interval := interval '10 minutes';
  teto     CONSTANT integer  := 3;
  recentes integer;
BEGIN
  -- Comparação normalizada: "Fulano@Exemplo.com " e "fulano@exemplo.com" são o
  -- mesmo remetente, e sem `lower(btrim(...))` bastaria alternar maiúsculas
  -- para zerar a contagem.
  SELECT count(*) INTO recentes
  FROM public.contact_submissions c
  WHERE lower(btrim(c.email)) = lower(btrim(NEW.email))
    AND c.created_at > now() - janela;

  IF recentes >= teto THEN
    RAISE EXCEPTION
      'Muitas mensagens enviadas deste e-mail em pouco tempo. Tente novamente em alguns minutos.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_contact_submission_rate_limit() IS
  'Trigger BEFORE INSERT de contact_submissions: recusa a partir da 4ª mensagem '
  'do mesmo e-mail (normalizado) em 10 minutos. Barreira contra reenvio e laço '
  'ingênuo, não contra abuso que varia o remetente.';

-- Trigger não exige EXECUTE do papel que insere, então nada precisa ser
-- concedido; o REVOKE fecha a chamada direta, que não tem uso legítimo.
REVOKE ALL ON FUNCTION public.enforce_contact_submission_rate_limit() FROM PUBLIC;

DROP TRIGGER IF EXISTS contact_submissions_rate_limit ON public.contact_submissions;

CREATE TRIGGER contact_submissions_rate_limit
  BEFORE INSERT ON public.contact_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_contact_submission_rate_limit();

/* ═══════════ 3. índices de apoio ══════════════════════════════════════════ */

-- A contagem do trigger roda em TODO insert; sem índice ela é um seq scan que
-- cresce com a tabela — o custo do formulário passaria a subir com o histórico.
-- A expressão precisa ser idêntica à do WHERE para ser usada.
CREATE INDEX IF NOT EXISTS contact_submissions_email_recent_idx
  ON public.contact_submissions (lower(btrim(email)), created_at DESC);

-- A caixa de entrada lê sempre da mais recente para a mais antiga, com recorte
-- por período (`created_at >= …`) e teto de linhas.
CREATE INDEX IF NOT EXISTS contact_submissions_created_at_idx
  ON public.contact_submissions (created_at DESC);

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFICAÇÕES APÓS APLICAR

   Nada aqui foi aplicado a banco nenhum: este arquivo é só a migration.
   Ao aplicar (`supabase db push`), conferir, nesta ordem:

     1. o formulário público continua enviando — /contato com nome, e-mail e
        mensagem normais grava e mostra a confirmação;

     2. os limites recusam o que devem, via POST direto na Data API como anon
        (o formulário não consegue produzir estes casos):
          • mensagem com 2001 caracteres  → erro 23514 (check_violation);
          • nome vazio ou só espaços       → erro 23514;
          • e-mail sem arroba ou com espaço→ erro 23514;
          • telefone com 21 caracteres     → erro 23514;
          • telefone ausente (NULL)        → GRAVA (o campo é opcional);

     3. o teto de vazão: quatro INSERTs seguidos do mesmo e-mail — os três
        primeiros gravam, o quarto falha com a mensagem de "muitas mensagens";
        um e-mail diferente grava normalmente no mesmo intervalo;

     4. a leitura não mudou: /admin/mensagens continua listando para o
        super_admin, e continua vazia para qualquer outro papel;

     5. `\d+ public.contact_submissions` mostra as cinco constraints como
        NOT VALID e o trigger `contact_submissions_rate_limit`.

   VALIDAÇÃO RETROATIVA (passo separado, opcional, depois de olhar os dados)

   As constraints valem para toda escrita nova. Para estendê-las ao histórico,
   primeiro ver o que já não passaria:

     SELECT id, created_at,
            char_length(btrim(name))    AS n,
            char_length(btrim(email))   AS e,
            char_length(btrim(phone))   AS p,
            char_length(btrim(message)) AS m
     FROM public.contact_submissions
     WHERE char_length(btrim(name))    NOT BETWEEN 1 AND 100
        OR char_length(btrim(email))   NOT BETWEEN 1 AND 255
        OR btrim(email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        OR (phone IS NOT NULL AND char_length(btrim(phone)) NOT BETWEEN 1 AND 20)
        OR char_length(btrim(message)) NOT BETWEEN 1 AND 2000;

   Se não voltar nada, validar (cada VALIDATE toma um ACCESS EXCLUSIVE breve):

     ALTER TABLE public.contact_submissions VALIDATE CONSTRAINT contact_submissions_name_length;
     ALTER TABLE public.contact_submissions VALIDATE CONSTRAINT contact_submissions_email_length;
     ALTER TABLE public.contact_submissions VALIDATE CONSTRAINT contact_submissions_email_format;
     ALTER TABLE public.contact_submissions VALIDATE CONSTRAINT contact_submissions_phone_length;
     ALTER TABLE public.contact_submissions VALIDATE CONSTRAINT contact_submissions_message_length;

   Se voltar linhas, NÃO validar: são mensagens reais de gente real, e apagá-las
   para satisfazer uma constraint troca um problema de forma por perda de
   conteúdo. Deixar como NOT VALID é o resultado correto nesse caso.
   ═══════════════════════════════════════════════════════════════════════════ */
