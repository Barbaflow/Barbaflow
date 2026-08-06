import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/agenda` virou redirect para a aba "Horários" do dashboard (fase 2).
 *
 * POR QUE A ROTA CONTINUA EXISTINDO, EM VEZ DE SER APAGADA
 *
 * Ela é destino de deep-link em três notificações de staff —
 * `new_appointment`, `appointment_cancelled` e `appointment_rescheduled`
 * (`lib/notification-links.ts`). Apagá-la exigiria mexer naquele arquivo e nas
 * verificações que o cobrem, e quebraria toda notificação JÁ ENVIADA, cujo link
 * está gravado no dispositivo de quem recebeu. Um redirect custa três linhas e
 * mantém tudo isso de pé — inclusive favorito antigo e URL digitada.
 *
 * O QUE ELA CARREGA ADIANTE
 *
 *   • `tab: "schedule"` — abre direto na aba certa, não na Visão Geral;
 *   • `barbershop` — preservado como veio. É o parâmetro que o super_admin usa
 *     para operar outra barbearia, honrado só para ele por `useTenantScope`.
 *     Descartá-lo aqui mandaria o super_admin para o próprio tenant sem avisar,
 *     que é a pior falha possível: silenciosa e com cara de sucesso.
 *
 * `beforeLoad` em vez de um componente que redireciona no `useEffect`: assim
 * nada da tela antiga chega a montar, e não há um piscar de conteúdo antes da
 * troca de URL. `replace: true` mantém o botão "voltar" apontando para onde a
 * pessoa realmente estava, e não para este salto.
 */
export const Route = createFileRoute("/agenda")({
  validateSearch: (search: Record<string, unknown>): { barbershop?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/dashboard",
      search: { tab: "schedule", barbershop: search.barbershop, checkout: undefined },
      replace: true,
    });
  },
});
