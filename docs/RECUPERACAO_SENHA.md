# Recuperação de senha — como o fluxo funciona e o que configurar

Este documento cobre duas coisas: o caminho que o usuário percorre e a única
parte que **não** está no código — o cadastro de URLs no painel do Supabase.

## O caminho

1. **Solicitação** — `AuthForm` (modo "Esqueci a senha") ou `/perfil`.
   O e-mail é normalizado (espaços removidos, caixa baixa) e validado antes do
   envio. A chamada é `supabase.auth.resetPasswordForEmail(email, { redirectTo })`,
   com `redirectTo` vindo de `passwordRecoveryRedirectUrl()`
   (`src/lib/auth-redirect.ts`).
2. **Resposta** — sempre a mesma frase, para e-mail cadastrado ou não. A tela
   não é um verificador de cadastro.
3. **E-mail** — o Supabase monta o link a partir do template de *Reset Password*
   e do `redirectTo`. **Se o `redirectTo` não estiver na lista de Redirect URLs,
   ele é descartado silenciosamente e o link aponta para o Site URL** — é a
   causa mais comum de "o link abre o ambiente errado".
4. **Retorno** — o usuário cai em `/reset-password`. A tela aceita os três
   formatos que o Supabase pode devolver:
   - implícito: `#access_token=…&type=recovery` (padrão deste projeto);
   - PKCE: `?code=…`;
   - token hash: `?token_hash=…&type=recovery`.
   Os parâmetros são lidos na primeira renderização, antes de qualquer efeito,
   porque o supabase-js limpa o fragmento assim que valida o link. A sessão é
   confirmada por `getSession()`, que aguarda a inicialização do cliente — é o
   sinal determinístico, sem corrida com o evento `PASSWORD_RECOVERY`.
5. **Nova senha** — `supabase.auth.updateUser({ password })`, seguido de
   `signOut()`: a sessão de recuperação cumpriu o papel e o acesso é refeito com
   a senha nova.

`/reset-password` é rota pública: não tem guarda de carregamento, não exige
papel nem barbearia e não redireciona para `/login` nem para o dashboard.

## Authentication → URL Configuration

Painel do Supabase → **Authentication → URL Configuration**.

### Site URL

```
https://barbaflow-delta.vercel.app
```

É o endereço para onde o Supabase manda o usuário quando o `redirectTo` não é
aceito. Deixá-lo apontando para produção é a rede de segurança: um link que
falhe abre a aplicação real, não `localhost`.

### Redirect URLs

Cadastre uma linha por ambiente. Prefira endereços exatos.

| Ambiente | URL |
| --- | --- |
| Desenvolvimento local | `http://localhost:8080/reset-password` |
| Preview (Vercel) | `https://<SUBSTITUIR-PELA-URL-DO-PREVIEW>/reset-password` |
| Produção | `https://barbaflow-delta.vercel.app/reset-password` |

Observações:

- **8080** é a porta fixada por `@lovable.dev/vite-tanstack-config`
  (`strictPort`). Confirme no que o `npm run dev` imprimir.
- A URL do Preview **não está registrada em nenhum arquivo deste repositório** —
  só o id do projeto Vercel, em `.vercel/repo.json`, que não é um endereço.
  Pegue-a no painel da Vercel e substitua o placeholder acima.
- Previews da Vercel mudam de subdomínio a cada branch. Se cadastrar cada uma
  for inviável, use **um** curinga, e só para isso:
  `https://*-<slug-da-org>.vercel.app/reset-password`. Curinga só na linha do
  Preview — nunca no Site URL, nunca em produção.
- Se o cadastro de conta também precisar voltar para o Preview, acrescente
  `/login` nas mesmas origens.

### Templates de e-mail

Em **Authentication → Emails → Reset Password**, o link precisa continuar usando
`{{ .ConfirmationURL }}`. Se o template for trocado para `{{ .TokenHash }}`, o
fluxo continua funcionando — a tela aceita esse formato —, desde que a URL final
aponte para `/reset-password`.

## Variável opcional

`VITE_PUBLIC_SITE_URL` (ou `PUBLIC_SITE_URL`, no processo de SSR) define a
origem usada **apenas quando não há navegador**. No navegador, a origem atual
sempre vence. Sem a variável, o SSR cai em `https://barbaflow-delta.vercel.app`.

## Teste sem caixa de e-mail

`npm run harness:senha` cobre solicitação, leitura do link, decisão da tela,
troca da senha e mensagens, com a auth fictícia de `src/mocks/auth.ts`. Nenhum
e-mail é enviado. Para o teste ponta a ponta, use um endereço real seu — e-mails
`.test`/`.teste` não têm caixa de entrada e o link nunca chega.
