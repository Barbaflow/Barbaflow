import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useBarbershop } from "./use-barbershop";

/**
 * Situação da resolução do plano. Existe porque `loading: false` sozinho não
 * distingue "plano carregado" de "a consulta falhou" — e tratar falha como
 * plano free aplica limites que não são os do cliente.
 */
export type PlanStatus =
  | "loading" // sessão/tenant ou a própria consulta ainda resolvendo
  | "no-tenant" // resolução terminou sem barbearia: não há plano a mostrar
  | "ready" // plano lido do banco
  | "not-found" // barbearia sem plano gravado — free é o padrão do produto
  | "error"; // consulta falhou: os limites abaixo NÃO são confiáveis

interface PlanInfo {
  planName: "free" | "pro" | "enterprise";
  appointmentLimit: number | null;
  appointmentsUsed: number;
  barberLimit: number | null;
  hasSubscriptions: boolean;
  price: number;
  /** Atalho para `status === "loading"`. Mantido para os consumidores atuais. */
  loading: boolean;
  status: PlanStatus;
  /** Mensagem real do Supabase quando `status === "error"`. */
  error: string | null;
  /** Recarrega o plano sob demanda (após upgrade, checkout ou uma falha). */
  refreshPlan: () => void;
}

/** Campos que vêm do banco — o restante do PlanInfo é derivado no hook. */
type PlanState = Omit<PlanInfo, "loading" | "refreshPlan">;

/**
 * Padrão do produto: free. Usado como base enquanto nada foi lido e quando a
 * barbearia não tem plano gravado — nunca para mascarar erro de consulta, que
 * é sinalizado por `status: "error"`.
 */
const FREE_DEFAULT: Omit<PlanState, "status"> = {
  planName: "free",
  appointmentLimit: 50,
  appointmentsUsed: 0,
  barberLimit: 1,
  hasSubscriptions: false,
  price: 0,
  error: null,
};

const LOADING: PlanState = { ...FREE_DEFAULT, status: "loading" };

/**
 * Plano de uma barbearia.
 *
 * `barbershopIdOverride` existe para as telas que operam um tenant explícito
 * (super_admin abrindo `?barbershop=<uuid>`): sem ele, o limite de
 * profissionais e o nome do plano vinham do tenant do PRÓPRIO usuário e a tela
 * misturava dados de duas barbearias. Sem override, vale o tenant resolvido —
 * e `null` (nenhum tenant) devolve `status: "no-tenant"`, nunca um plano
 * inventado.
 *
 * NÃO abre canal Realtime. O contador de uso do tenant do contexto já chega ao
 * vivo pelo canal `barbershop-context-<id>` de `use-barbershop` (mesma linha,
 * mesmo evento UPDATE) e é lido daqui via `barbershop.appointments_this_month`.
 * Um segundo canal para a mesma linha era redundante e, quando duas telas com
 * este hook montavam juntas (BarbershopSettings + TeamManager em
 * `/configuracoes`), o cliente Supabase devolvia o MESMO RealtimeChannel — já
 * inscrito — e o `.on("postgres_changes", …)` seguinte lançava
 * "cannot add `postgres_changes` callbacks … after `subscribe()`", derrubando a
 * rota. Para tenant de outra barbearia (seleção do super_admin) o contador é
 * lido no mount e pode ser atualizado por `refreshPlan()`.
 */
export function usePlan(barbershopIdOverride?: string | null): PlanInfo {
  const { barbershop, resolvedBarbershopId, tenantStatus } = useBarbershop();
  const tenantId = barbershopIdOverride ?? resolvedBarbershopId;
  // Quando o tenant pedido é o do contexto, plano e uso já estão em memória.
  const isContextTenant = Boolean(tenantId) && tenantId === barbershop?.id;
  const contextPlanId = isContextTenant ? (barbershop?.plan_id ?? null) : null;

  const [state, setState] = useState<PlanState>(LOADING);
  const [reloadToken, setReloadToken] = useState(0);
  const refreshPlan = useCallback(() => setReloadToken((n) => n + 1), []);

  // Trocar de barbearia volta para "loading". Sem isso o plano da barbearia
  // anterior continuaria valendo durante a consulta da nova, e a tela aplicaria
  // o limite do tenant errado por alguns quadros.
  useEffect(() => {
    setState(LOADING);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      // Enquanto a resolução acontece seguimos em "loading"; quando ela termina
      // sem barbearia não há plano — e isso não é um plano free.
      setState(tenantStatus === "loading" ? LOADING : { ...FREE_DEFAULT, status: "no-tenant" });
      return;
    }

    let cancelled = false;
    const fail = (message: string) => {
      if (!cancelled) setState({ ...FREE_DEFAULT, status: "error", error: message });
    };

    const fetchPlan = async () => {
      // Tenant de outra barbearia (seleção do super_admin): o contexto não tem
      // a linha, então buscamos plano e uso direto pelo id pedido.
      let planId = contextPlanId;
      let used = 0;

      if (!contextPlanId) {
        const { data: shop, error } = await supabase
          .from("barbershops")
          .select("plan_id, appointments_this_month")
          .eq("id", tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (error) return fail(error.message);
        planId = shop?.plan_id ?? null;
        used = shop?.appointments_this_month ?? 0;
      }

      if (!planId) {
        // Barbearia sem plano gravado: o padrão do produto é free.
        if (!cancelled) {
          setState({ ...FREE_DEFAULT, appointmentsUsed: used, status: "not-found" });
        }
        return;
      }

      const { data, error } = await supabase
        .from("plans")
        .select("*")
        .eq("id", planId)
        .maybeSingle();
      if (cancelled) return;
      if (error) return fail(error.message);

      if (!data) {
        // `plan_id` aponta para um plano que não existe mais.
        setState({ ...FREE_DEFAULT, appointmentsUsed: used, status: "not-found" });
        return;
      }

      setState({
        planName: (data.name as PlanInfo["planName"]) ?? "free",
        appointmentLimit: data.appointment_limit ?? null,
        appointmentsUsed: used,
        barberLimit: data.barber_limit ?? null,
        hasSubscriptions: data.has_subscriptions ?? false,
        price: Number(data.price ?? 0),
        status: "ready",
        error: null,
      });
    };

    fetchPlan();

    return () => {
      cancelled = true;
    };
    // `appointments_this_month` NÃO entra aqui: ele é aplicado abaixo, fora do
    // efeito. Como dependência, cada agendamento do tenant do contexto
    // disparava uma consulta nova ao plano — que não muda por isso.
  }, [tenantId, contextPlanId, tenantStatus, reloadToken]);

  return {
    ...state,
    // Tenant do contexto: o contador vem do provider, que já o mantém ao vivo.
    appointmentsUsed: isContextTenant
      ? (barbershop?.appointments_this_month ?? 0)
      : state.appointmentsUsed,
    loading: state.status === "loading",
    refreshPlan,
  };
}

export function usePlanUsagePercent() {
  const { appointmentLimit, appointmentsUsed } = usePlan();
  if (!appointmentLimit) return 0;
  return Math.round((appointmentsUsed / appointmentLimit) * 100);
}

/** Check if the current plan allows a feature */
export function useCanAccessFeature(feature: "reports" | "team_unlimited") {
  const { planName, status, refreshPlan } = usePlan();
  // Falha de consulta não é "plano free": negar o recurso é o lado seguro, mas
  // quem chama precisa saber que foi erro para não oferecer upgrade a um
  // cliente que já pagou.
  const failed = status === "error";
  if (status === "loading") {
    return { canAccess: false, loading: true, failed: false, refreshPlan };
  }

  const allowed = !failed && planName !== "free";
  switch (feature) {
    case "reports":
    case "team_unlimited":
      return { canAccess: allowed, loading: false, failed, refreshPlan };
    default:
      return { canAccess: !failed, loading: false, failed, refreshPlan };
  }
}
