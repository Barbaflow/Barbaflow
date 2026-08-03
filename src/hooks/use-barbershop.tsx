import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_BARBERSHOP_ID } from "@/lib/constants";
import { setActiveTenantTZ, DEFAULT_TENANT_TZ } from "@/lib/tz";
import type { Tables } from "@/integrations/supabase/types";

type Barbershop = Tables<"barbershops">;

/** Situação da resolução do tenant. Use isto para autorizar, não `isDefault`. */
export type TenantStatus = "loading" | "resolved" | "none";

interface BarbershopContextValue {
  barbershop: Barbershop | null;
  /**
   * LEGADO — sempre uma string, caindo em DEFAULT_BARBERSHOP_ID quando nada foi
   * resolvido. Esse default é o MESMO uuid da barbearia fictícia do mock
   * (`MOCK_BARBERSHOP_ID`), então no modo Supabase ele aponta para uma linha
   * que NÃO EXISTE. Serve para telas que só precisam de um id para consultar;
   * NUNCA use para decidir acesso — use `resolvedBarbershopId`.
   */
  barbershopId: string;
  /**
   * Fonte única e explícita do tenant atual: `null` quando não há barbearia
   * resolvida. Nunca vale um uuid de mock no modo Supabase.
   */
  resolvedBarbershopId: string | null;
  tenantStatus: TenantStatus;
  loading: boolean;
  isDefault: boolean; // true when using fallback (no subdomain matched)
  /** Re-resolve o tenant (ex.: logo após o onboarding criar a barbearia). */
  refreshBarbershop: () => void;
}

const BarbershopContext = createContext<BarbershopContextValue>({
  barbershop: null,
  barbershopId: DEFAULT_BARBERSHOP_ID,
  resolvedBarbershopId: null,
  tenantStatus: "loading",
  loading: true,
  isDefault: true,
  refreshBarbershop: () => {},
});

/**
 * Extracts subdomain from hostname.
 */
function extractSubdomain(): string | null {
  if (typeof window === "undefined") return null;

  const hostname = window.location.hostname;

  if (hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    return null;
  }

  const parts = hostname.split(".");

  if (parts.length < 3) return null;

  const subdomain = parts[0];

  if (["www", "app", "api", "admin"].includes(subdomain)) return null;

  if (subdomain.includes("preview--")) return null;

  return subdomain;
}

export function BarbershopProvider({ children }: { children: React.ReactNode }) {
  const [barbershop, setBarbershop] = useState<Barbershop | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDefault, setIsDefault] = useState(true);
  // Incrementado para forçar nova resolução (troca de sessão, onboarding).
  const [resolveToken, setResolveToken] = useState(0);
  const refreshBarbershop = useCallback(() => setResolveToken((n) => n + 1), []);

  // Último usuário para o qual uma resolução foi disparada. `undefined` = nada
  // observado ainda (distinto de `null`, que é "observado, e não há sessão").
  const lastUserId = useRef<string | null | undefined>(undefined);

  // A resolução acontecia UMA única vez, no mount. Quem entrasse sem barbearia
  // — ou criasse a sua no meio da sessão, pelo onboarding — ficava com o
  // fallback antigo para sempre, e as telas que autorizam por tenant passavam a
  // comparar o usuário com um id que não é o dele. Re-resolvemos quando a
  // sessão muda (login/logout/refresh) e sob demanda via refreshBarbershop().
  //
  // O NOME DO EVENTO NÃO BASTA, e é por isso que comparamos o `user.id`:
  // o GoTrueClient registra um `visibilitychange` próprio quando
  // `autoRefreshToken` está ligado (GoTrueClient.js, `_handleVisibilityChange`).
  // Ao voltar para a aba ele chama `_recoverAndRefresh()`, que termina em
  // `_notifyAllSubscribers('SIGNED_IN', currentSession)` — ou seja, dispara
  // `SIGNED_IN` na revalidação, com a MESMA sessão e o MESMO usuário de antes.
  // Reagir a isso incrementava `resolveToken`, o efeito abaixo fazia
  // `setLoading(true)`, e toda tela que usa esse `loading` como portão de
  // renderização (dashboard e as demais com dados) desmontava e remontava a
  // árvore inteira: estado local perdido e todas as consultas refeitas. Para o
  // usuário isso é indistinguível de a página ter recarregado sozinha ao trocar
  // de aba.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const id = session?.user?.id ?? null;

      // `INITIAL_SESSION` é emitido para cada assinante logo após a inscrição
      // (GoTrueClient.js, `_emitInitialSession`), com a sessão que já estava em
      // storage. Ele só ESTABELECE A LINHA DE BASE e nunca dispara resolução —
      // o efeito de mount abaixo já resolve por conta própria.
      //
      // Sem gravar o id aqui, o ref ficaria `undefined` até o primeiro
      // `SIGNED_IN`; como `undefined !== id`, a primeira revalidação de aba
      // passaria pela comparação e remontaria a árvore assim mesmo — que é
      // exatamente o bug que esta mudança existe para fechar.
      if (event === "INITIAL_SESSION") {
        lastUserId.current = id;
        return;
      }

      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;

      // `USER_UPDATED` mantém o mesmo id de propósito — o que mudou foram os
      // dados do usuário, não quem ele é. Aqui a re-resolução é o objetivo.
      if (event !== "USER_UPDATED" && lastUserId.current === id) return;

      lastUserId.current = id;
      setResolveToken((n) => n + 1);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const subdomain = extractSubdomain();

    if (subdomain) {
      supabase
        .from("barbershops")
        .select("*")
        .eq("subdomain", subdomain)
        .eq("status", "approved")
        .single()
        .then(({ data, error }) => {
          if (cancelled) return;
          if (data && !error) {
            setBarbershop(data);
            setIsDefault(false);
            setLoading(false);
          } else {
            resolveFromUserRoles(() => cancelled);
          }
        });
    } else {
      resolveFromUserRoles(() => cancelled);
    }

    return () => {
      cancelled = true;
    };
  }, [resolveToken]);

  // Sincroniza o fuso horário ativo do tenant assim que a barbearia carrega
  // (e em qualquer atualização realtime). Isso garante que todayISOInTenantTZ
  // e isRetroactiveSlot usem sempre a mesma base, em qualquer parte do app.
  useEffect(() => {
    const tz = (barbershop as unknown as { timezone?: string } | null)?.timezone;
    setActiveTenantTZ(tz ?? DEFAULT_TENANT_TZ);
  }, [barbershop]);

  // Subscribe to realtime updates on the resolved barbershop
  useEffect(() => {
    if (!barbershop?.id) return;

    const channel = supabase
      .channel(`barbershop-context-${barbershop.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "barbershops",
          filter: `id=eq.${barbershop.id}`,
        },
        (payload) => {
          setBarbershop((prev) => prev ? { ...prev, ...payload.new } as Barbershop : prev);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [barbershop?.id]);

  async function resolveFromUserRoles(isCancelled: () => boolean = () => false) {
    const { data: { user } } = await supabase.auth.getUser();
    if (isCancelled()) return;

    if (user) {
      const { data: roleData } = await supabase
        .from("user_roles")
        .select("barbershop_id")
        .eq("user_id", user.id)
        .in("role", ["admin_barbearia", "barbeiro"])
        .neq("barbershop_id", "00000000-0000-0000-0000-000000000000")
        .limit(1)
        .maybeSingle();

      if (roleData?.barbershop_id) {
        const { data: shop } = await supabase
          .from("barbershops")
          .select("*")
          .eq("id", roleData.barbershop_id)
          .single();

        if (shop) {
          setBarbershop(shop);
          setIsDefault(false);
          setLoading(false);
          return;
        }
      }

      const { data: ownedShop } = await supabase
        .from("barbershops")
        .select("*")
        .eq("owner_id", user.id)
        .neq("subdomain", "_system")
        .limit(1)
        .maybeSingle();

      if (ownedShop) {
        setBarbershop(ownedShop);
        setIsDefault(false);
        setLoading(false);
        return;
      }
    }

    // Último recurso: a barbearia de DEFAULT_BARBERSHOP_ID. No modo mock ela
    // existe e é o tenant de demonstração; no modo Supabase quase nunca existe,
    // e é justamente por isso que `resolvedBarbershopId` fica null quando o
    // SELECT não devolve nada — em vez de fingir um tenant.
    const { data } = await supabase
      .from("barbershops")
      .select("*")
      .eq("id", DEFAULT_BARBERSHOP_ID)
      .maybeSingle();

    if (isCancelled()) return;

    setBarbershop(data ?? null);
    setIsDefault(true);
    setLoading(false);
  }

  const barbershopId = barbershop?.id ?? DEFAULT_BARBERSHOP_ID;
  const resolvedBarbershopId = barbershop?.id ?? null;
  const tenantStatus: TenantStatus = loading ? "loading" : barbershop ? "resolved" : "none";

  return (
    <BarbershopContext.Provider
      value={{
        barbershop,
        barbershopId,
        resolvedBarbershopId,
        tenantStatus,
        loading,
        isDefault,
        refreshBarbershop,
      }}
    >
      {children}
    </BarbershopContext.Provider>
  );
}

export function useBarbershop() {
  return useContext(BarbershopContext);
}
