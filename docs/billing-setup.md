# Assinatura SaaS da barbearia — configuração (Paddle Billing)

Esta é a **assinatura da barbearia para usar o BarbaFlow**. Não tem relação com
pagamento de serviços/comandas pelo cliente, split, marketplace ou pagamento de
barbeiros.

## Gateway

**Paddle Billing**, acessado através do *connector gateway* da Lovable
(`https://connector-gateway.lovable.dev/paddle`). O checkout é o overlay do
Paddle.js (client-side); a **fonte da verdade** da assinatura é o **webhook**
confirmado pelo Paddle — o retorno do checkout no navegador nunca ativa o plano
sozinho.

Por que Paddle (primeira versão): é *Merchant of Record* (assume imposto e
compliance no Brasil), cobra recorrente em cartão, tem webhooks assinados,
ambiente sandbox, SDK Node/Deno e nos tira do escopo PCI (nenhum dado de cartão
passa pelo nosso banco). Um único gateway nesta versão.

## Variáveis de ambiente

### Público (frontend — `.env`)

| Nome | Descrição |
|------|-----------|
| `VITE_PAYMENTS_CLIENT_TOKEN` | Token de cliente do Paddle. Em testes começa com `test_` (o app detecta sandbox por esse prefixo). **Público**, mas nunca é uma chave secreta. |

### Secreto (Edge Functions — `supabase secrets set`, **nunca** no frontend)

| Nome | Descrição |
|------|-----------|
| `PADDLE_SANDBOX_API_KEY` | Chave de conexão Paddle (sandbox). |
| `PADDLE_LIVE_API_KEY` | Chave de conexão Paddle (produção). |
| `LOVABLE_API_KEY` | Autenticação do connector gateway. |
| `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Segredo de verificação HMAC do webhook (sandbox). |
| `PAYMENTS_LIVE_WEBHOOK_SECRET` | Segredo de verificação HMAC do webhook (produção). |
| `SUPABASE_SERVICE_ROLE_KEY` | Escrita de `subscriptions`/`barbershops` pelo webhook (ignora RLS). |
| `BILLING_ALLOW_LIVE` | Trava anti-produção. O webhook **recusa** eventos `live` a menos que seja `true`. Deixe ausente durante os testes. |

Nenhum valor real deve ser commitado. `.env.example` lista apenas os nomes.

## Regras de segurança já aplicadas

- Escrita de `subscriptions` só pelo `service_role` (RLS). O frontend apenas lê
  a própria via `get_barbershop_subscription`, restrita a admin/super do tenant.
- Webhook: valida assinatura HMAC, **idempotente** (`record_billing_event` grava
  o `event_id` uma vez), e **valida posse** — `apply_subscription_from_webhook`
  recusa aplicar a assinatura a uma barbearia que o usuário não administra
  (não confia no `barbershopId` do `customData`).
- `BILLING_ALLOW_LIVE` impede processar cobrança real por engano nos testes.

## Passos manuais no painel do Paddle (sandbox) — fora deste repositório

1. Criar conta **sandbox** no Paddle e habilitar Paddle Billing.
2. Criar o produto/preço do plano Pro (e Enterprise) e anotar o `external_id`
   usado em `PLAN_CONFIG` (`pro_monthly`, `enterprise_monthly`).
3. Gerar o **client-side token** (`test_...`) → `VITE_PAYMENTS_CLIENT_TOKEN`.
4. Gerar a **API key** de conexão → `PADDLE_SANDBOX_API_KEY`.
5. Cadastrar o endpoint do webhook apontando para a Edge Function
   `payments-webhook?env=sandbox` e copiar o **webhook secret** →
   `PAYMENTS_SANDBOX_WEBHOOK_SECRET`.
6. Assinar os eventos: `subscription.created/updated/canceled`,
   `transaction.completed`, `transaction.payment_failed`.

> Nesta rodada **não** houve deploy de função, cobrança real, criação de cliente
> real no gateway nem `db push` remoto. Tudo validado localmente (sandbox/mock).
