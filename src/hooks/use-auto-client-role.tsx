import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./use-auth";
import { useBarbershop } from "./use-barbershop";
import {
  decideAutoClientRole,
  classifyRoleInsert,
  roleIsEnsured,
} from "@/lib/auto-client-role";
import { logTechnicalError } from "@/lib/error-reporting";

/**
 * Cria o papel "cliente" quando o usuário entra pelo subdomínio de uma
 * barbearia e ainda não tem papel algum nela.
 *
 * O hook não tem UI: falha em silêncio para o usuário e em alto e bom som para
 * o console. Nada aqui bloqueia a área do cliente — se o papel não for criado,
 * o restante do app continua funcionando (o guard de /dashboard trata "sem
 * papel" como cliente e a lista de clientes vem de `appointments`).
 *
 * Antes, a consulta por papel existente descartava `error`: uma falha de rede
 * virava "não tem papel" e disparava um INSERT desnecessário. Agora só criamos
 * depois de uma consulta que concluiu.
 */
export function useAutoClientRole() {
  const { user, loading: authLoading } = useAuth();
  const { barbershopId, isDefault, loading } = useBarbershop();
  /**
   * Par `userId:barbershopId` já processado. Chaveado (em vez de um booleano)
   * para que uma troca de conta ou de tenant na mesma montagem seja tratada —
   * e para que a mesma combinação não seja reprocessada a cada render.
   */
  const processedKey = useRef<string | null>(null);

  useEffect(() => {
    const authIsLoading = authLoading || loading;
    const key = user && barbershopId ? `${user.id}:${barbershopId}` : null;

    // Decisão preliminar: os guardas baratos evitam até a consulta.
    const preliminar = decideAutoClientRole({
      hasSession: Boolean(user),
      authLoading: authIsLoading,
      isDefaultTenant: isDefault,
      alreadyProcessed: key !== null && processedKey.current === key,
    });
    if (preliminar.action === "skip" && preliminar.reason !== "consulta-falhou") return;
    if (!user || !key) return;

    // Marcado antes da consulta: sem isto, um novo objeto `user` a cada render
    // dispararia uma nova rodada. Em falha permanece marcado — não há
    // re-tentativa automática, e portanto não há laço.
    processedKey.current = key;

    let cancelled = false;

    (async () => {
      const existing = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("barbershop_id", barbershopId)
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      const decisao = decideAutoClientRole({
        hasSession: true,
        authLoading: false,
        isDefaultTenant: isDefault,
        alreadyProcessed: false,
        existing: { found: Boolean(existing.data), error: existing.error },
      });

      if (decisao.action === "skip") {
        if (decisao.reason === "consulta-falhou" || decisao.reason === "sessao-expirada") {
          logTechnicalError("useAutoClientRole", `consultar papel existente (${decisao.reason})`, existing.error);
          // Libera para uma próxima montagem tentar de novo — sem repetir agora.
          processedKey.current = null;
        }
        return;
      }

      const { error: insertError } = await supabase.from("user_roles").insert({
        user_id: user.id,
        barbershop_id: barbershopId,
        role: "cliente" as const,
      });

      if (cancelled) return;

      const outcome = classifyRoleInsert(insertError);
      if (!roleIsEnsured(outcome)) {
        logTechnicalError("useAutoClientRole", `criar papel de cliente (${outcome})`, insertError);
        processedKey.current = null;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authLoading, barbershopId, isDefault, loading]);
}
