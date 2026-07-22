import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";

/**
 * Regra única de tenant das telas operacionais.
 *
 * Existe porque `useBarbershop().barbershopId` é LEGADO: ele nunca é `null` e
 * cai em `DEFAULT_BARBERSHOP_ID` — o mesmo uuid da barbearia fictícia do mock.
 * No modo Supabase esse id aponta para uma linha que não existe, e as telas que
 * o usavam consultavam um tenant inventado. Aqui o tenant só existe quando foi
 * de fato resolvido: `tenantId === null` significa "ainda não sei" ou "não há",
 * nunca "use um padrão".
 *
 * Ordem de resolução, explícita:
 *   1. `?barbershop=<uuid>` — honrado APENAS para super_admin (ação vinda do
 *      AdminDashboard). Um admin_barbearia ou barbeiro que edite a URL continua
 *      preso ao tenant do próprio papel;
 *   2. tenant resolvido pelo papel/propriedade do usuário (useBarbershop);
 *   3. nenhum — a tela pede seleção ou explica a ausência, em vez de consultar.
 *
 * A sentinela `_system` nunca é aceita como tenant operacional.
 */

/** Sentinela `_system` — ancora o papel global super_admin, não é barbearia. */
export const SYSTEM_BARBERSHOP_ID = "00000000-0000-0000-0000-000000000000";

/** Estados possíveis da autorização de uma tela por tenant. */
export type TenantAccess =
  | "checking" // sessão/papel/tenant ainda resolvendo
  | "granted"
  | "forbidden" // autenticado, mas sem papel suficiente no tenant
  | "no-tenant" // sem barbearia vinculada
  | "needs-selection" // super_admin sem barbearia escolhida
  | "error"; // falha de rede/banco na verificação

export type TenantRole = "admin_barbearia" | "barbeiro";

export interface TenantScope {
  /** Tenant operacional. `null` enquanto não resolvido ou inexistente. */
  tenantId: string | null;
  access: TenantAccess;
  /** Mensagem real devolvida pelo Supabase quando `access === "error"`. */
  accessError: string | null;
  /** `null` enquanto o papel global ainda não foi verificado. */
  isSuper: boolean | null;
  /** Administra o tenant atual (admin_barbearia dele, ou super_admin). */
  isAdmin: boolean;
  /** Atende no tenant atual (barbeiro dele, ou super_admin). */
  isBarber: boolean;
  /** `true` quando o tenant veio de `?barbershop=` (seleção do super_admin). */
  isExplicitSelection: boolean;
}

interface UseTenantScopeOptions {
  /**
   * Tenant pedido pela URL. A rota valida o parâmetro e passa o valor; só o
   * super_admin tem esse pedido honrado.
   */
  requestedBarbershopId?: string | null;
  /** Papéis que liberam a tela. Padrão: administrador e barbeiro. */
  allow?: readonly TenantRole[];
}

const DEFAULT_ALLOW: readonly TenantRole[] = ["admin_barbearia", "barbeiro"];

export function useTenantScope(options: UseTenantScopeOptions = {}): TenantScope {
  const { requestedBarbershopId = null, allow = DEFAULT_ALLOW } = options;
  const { user, loading: authLoading } = useAuth();
  const { resolvedBarbershopId, tenantStatus } = useBarbershop();

  const [isSuper, setIsSuper] = useState<boolean | null>(null);
  const [access, setAccess] = useState<TenantAccess>("checking");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [roles, setRoles] = useState<{ admin: boolean; barber: boolean }>({
    admin: false,
    barber: false,
  });

  const allowAdmin = allow.includes("admin_barbearia");
  const allowBarber = allow.includes("barbeiro");

  // A seleção por URL só vale para super_admin e nunca pode ser a sentinela.
  const requested =
    requestedBarbershopId && requestedBarbershopId !== SYSTEM_BARBERSHOP_ID
      ? requestedBarbershopId
      : null;
  const isExplicitSelection = Boolean(isSuper && requested);
  const tenantId = isExplicitSelection ? requested : resolvedBarbershopId;

  // Papel global primeiro: a seleção por URL depende dele.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsSuper(false);
      return;
    }
    let cancelled = false;
    supabase.rpc("has_role", { _user_id: user.id, _role: "super_admin" }).then(({ data }) => {
      if (!cancelled) setIsSuper(Boolean(data));
    });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  // Checagem de acesso — só roda depois que sessão, papel global e tenant
  // terminaram de resolver. Antes disso o estado permanece "checking", nunca
  // "acesso negado": mostrar recusa por resolução incompleta é falso negativo.
  useEffect(() => {
    if (authLoading || isSuper === null || tenantStatus === "loading") return;

    // Toda troca de tenant volta para "checking". Sem isso, ao mudar de
    // barbearia o estado anterior ("granted") continuaria valendo durante a
    // verificação e a tela renderizaria o novo tenant como se já estivesse
    // autorizado.
    setAccess("checking");
    setAccessError(null);

    if (!user) {
      setRoles({ admin: false, barber: false });
      setAccess("forbidden");
      return;
    }

    if (!tenantId) {
      setRoles({ admin: false, barber: false });
      // Sem tenant operacional. Distinguimos os motivos para a mensagem não
      // mentir: super_admin precisa escolher; quem só tem papel de `cliente`
      // tem barbearia — falta permissão; quem não tem papel nenhum ainda não
      // criou a sua.
      if (isSuper) {
        setAccess("needs-selection");
        return;
      }
      let cancelled = false;
      supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled) setAccess(data ? "forbidden" : "no-tenant");
        });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;
    (async () => {
      // super_admin com tenant explicitamente selecionado: a RLS já lhe dá
      // poder de administrador naquele tenant, sem consultar user_roles.
      if (isSuper) {
        if (cancelled) return;
        setRoles({ admin: true, barber: true });
        setAccess("granted");
        return;
      }

      const [{ data: admin, error: e1 }, { data: barber, error: e2 }] = await Promise.all([
        supabase.rpc("has_role_in_barbershop", {
          _user_id: user.id,
          _barbershop_id: tenantId,
          _role: "admin_barbearia",
        }),
        supabase.rpc("has_role_in_barbershop", {
          _user_id: user.id,
          _barbershop_id: tenantId,
          _role: "barbeiro",
        }),
      ]);
      if (cancelled) return;
      if (e1 || e2) {
        setRoles({ admin: false, barber: false });
        setAccessError((e1 ?? e2)?.message ?? "Falha ao verificar permissão.");
        setAccess("error");
        return;
      }
      setRoles({ admin: Boolean(admin), barber: Boolean(barber) });
      const permitted = (allowAdmin && admin) || (allowBarber && barber);
      setAccess(permitted ? "granted" : "forbidden");
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, isSuper, tenantId, tenantStatus, allowAdmin, allowBarber]);

  return {
    tenantId,
    access,
    accessError,
    isSuper,
    isAdmin: roles.admin,
    isBarber: roles.barber,
    isExplicitSelection,
  };
}

/** Textos padrão dos estados de recusa, para as telas não divergirem. */
export function tenantAccessMessage(
  access: TenantAccess,
  accessError: string | null,
  what: string,
): { titulo: string; texto: string } {
  switch (access) {
    case "needs-selection":
      return {
        titulo: "Selecione uma barbearia",
        texto: `Como super admin você pode gerenciar ${what} de qualquer barbearia — mas precisa escolher qual. Abra o painel administrativo e use a ação da barbearia desejada.`,
      };
    case "no-tenant":
      return {
        titulo: "Nenhuma barbearia vinculada",
        texto: `Sua conta ainda não está vinculada a uma barbearia. Conclua a criação da sua barbearia para gerenciar ${what}.`,
      };
    case "forbidden":
      return {
        titulo: "Acesso negado",
        texto: `Você não tem permissão para gerenciar ${what} nesta barbearia.`,
      };
    case "error":
      return {
        titulo: "Não foi possível verificar seu acesso",
        texto: accessError ?? "Tente novamente em instantes.",
      };
    default:
      return { titulo: "", texto: "" };
  }
}
