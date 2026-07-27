/**
 * Interruptor da interface de cobrança.
 *
 * A frente de assinaturas está PAUSADA: o portal do Paddle
 * (`create-portal-session`) e o checkout não estão disponíveis para os
 * clientes. Enquanto isso valer, nenhuma tela pode oferecer uma ação que
 * termina em erro — o smoke test flagrou "Gerenciar assinatura" respondendo
 * "Não foi possível abrir o portal de assinatura".
 *
 * A infraestrutura do Paddle (hooks, edge functions, rota /upgrade, migrations)
 * permanece intacta de propósito. Para religar a frente, basta voltar esta
 * constante para `true` — nada mais precisa ser reescrito.
 *
 * Some com este flag: botões de "Gerenciar assinatura", checkout, e CTAs de
 * upgrade. Permanecem: rótulo do plano atual, uso e avisos de limite, que são
 * apenas informativos.
 */
// Anotado como `boolean` (e não com o tipo literal `false`) para que o
// TypeScript não trate cada uso como condição morta.
export const BILLING_UI_ENABLED: boolean = false;
