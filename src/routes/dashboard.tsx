import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { AdminDashboard } from "@/components/AdminDashboard";
import { BarberDashboard } from "@/components/BarberDashboard";
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveDashboardRole,
  dashboardRedirect,
  isDifferentUser,
  type DashboardRole,
  type QueryFailure,
} from "@/lib/dashboard-role";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — BarbaFlow" },
      { name: "description", content: "Painel de controle da sua barbearia. Gerencie agendamentos, equipe e serviços." },
      { property: "og:title", content: "Dashboard — BarbaFlow" },
      { property: "og:description", content: "Painel de controle da sua barbearia no BarbaFlow." },
      { property: "og:image", content: "https://barbaflow-delta.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Dashboard — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-delta.vercel.app/og-image.jpg" },
    ],
  }),
  // `barbershop` é honrado APENAS para super_admin — ver `useTenantScope`. É o
  // mesmo parâmetro que `/agenda`, `/clientes`, `/comandas` e `/relatorios` já
  // aceitam, e existe aqui porque a "Agenda Semanal" migrou para a aba
  // Horários: sem ele o super_admin perderia o caminho de operar a agenda de um
  // tenant com problema, que hoje passa por `/agenda?barbershop=<uuid>`.
  //
  // `tab` abre o dashboard numa aba específica. Existe para o redirect de
  // `/agenda` (fase 2) cair direto em "Horários" em vez da Visão Geral. Não é
  // uma autorização: o valor é CONFERIDO contra as abas que o papel realmente
  // enxerga, e um `?tab=settings` de barbeiro cai na primeira aba dele.
  validateSearch: (
    search: Record<string, unknown>,
  ): { checkout?: string; barbershop?: string; tab?: string } => ({
    checkout: (search.checkout as string) || undefined,
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: DashboardPage,
});

type OrphanShop = { id: string; name: string; subdomain: string };

function DashboardPage() {
  const { user, loading } = useAuth();
  // `resolvedBarbershopId` (null enquanto não resolvido) no lugar do legado
  // `barbershopId`, que nunca é null e cai no uuid da barbearia do mock. Aqui
  // ele só serve de dependência do efeito de papel — nenhuma consulta o usa —,
  // mas ler o campo legado convidava a exatamente esse erro.
  const { resolvedBarbershopId, loading: barbershopLoading } = useBarbershop();
  const navigate = useNavigate();
  const { checkout, barbershop: requestedBarbershopId, tab } = Route.useSearch();
  const [role, setRole] = useState<DashboardRole | null>(null);
  const [roleStatus, setRoleStatus] = useState<"loading" | "ready" | "error">("loading");
  const [orphanShop, setOrphanShop] = useState<OrphanShop | null>(null);
  const [repairing, setRepairing] = useState(false);
  const toastShown = useRef(false);
  const redirectDone = useRef(false);
  /**
   * id do usuário cujo papel já foi resolvido COM SUCESSO — evita reexecutar as
   * consultas a cada novo objeto `user`. Volta a `null` em erro, senão uma falha
   * transitória deixaria o painel travado sem chance de nova tentativa.
   */
  const resolvedForUser = useRef<string | null>(null);
  /**
   * Usuário cuja resolução falhou. Segura o efeito para que um erro persistente
   * não vire uma enxurrada de re-tentativas automáticas — daqui em diante só o
   * botão "Tentar novamente" reconsulta.
   */
  const failedForUser = useRef<string | null>(null);
  /** Descarta resultado de execução antiga quando outra já assumiu. */
  const runId = useRef(0);
  /** Último usuário observado, para limpar o estado ao trocar de conta. */
  const lastUserId = useRef<string | null>(null);

  useEffect(() => {
    if (checkout === "success" && !toastShown.current) {
      toastShown.current = true;
      toast.success("Upgrade realizado com sucesso! 🎉", {
        description: "Seu plano foi atualizado. Aproveite todos os recursos.",
      });
      navigate({ to: "/dashboard", search: { checkout: undefined }, replace: true });
    }
  }, [checkout, navigate]);

  useEffect(() => {
    if (!loading && !user) {
      navigate({ to: "/login", search: { redirect: undefined } });
    }
  }, [user, loading, navigate]);

  // Trocou de conta: nada do usuário anterior — papel, barbearia órfã ou estado
  // de erro — pode sobreviver para o próximo. Declarado ANTES do efeito de
  // resolução para que a limpeza aconteça primeiro no mesmo ciclo.
  useEffect(() => {
    const id = user?.id ?? null;
    if (isDifferentUser(lastUserId.current, id)) {
      runId.current += 1; // invalida qualquer consulta em voo do usuário antigo
      resolvedForUser.current = null;
      failedForUser.current = null;
      redirectDone.current = false;
      setRole(null);
      setOrphanShop(null);
      setRoleStatus("loading");
    }
    lastUserId.current = id;
  }, [user]);

  const resolveRoles = useCallback(
    async (userId: string) => {
      const myRun = ++runId.current;
      setRoleStatus("loading");

      const superAdminR = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });

      // Todos os papéis do usuário, em qualquer barbearia: um admin/barbeiro
      // que abre /dashboard sempre vê o painel, mesmo que o tenant resolvido
      // seja um em que ele é apenas cliente.
      const rolesR = await supabase.from("user_roles").select("role").eq("user_id", userId);
      // `null` (e não `[]`) quando a consulta falhou — a diferença é o ponto
      // todo: lista vazia é resposta, erro não é.
      const rolesList = rolesR.error || !rolesR.data ? null : rolesR.data.map((r) => r.role as string);

      // Só quem não tem papel algum precisa deste desempate; a maioria dos
      // acessos nem dispara a consulta. Procuramos a PRESENÇA de uma barbearia
      // criada por este usuário: único sinal confiável de vínculo incompleto.
      const precisaOwner = !superAdminR.error && !superAdminR.data && rolesList !== null && rolesList.length === 0;
      let ownedRow: OrphanShop | null = null;
      let ownedOutcome: { value: boolean; error: QueryFailure | null } | undefined;

      if (precisaOwner) {
        const ownedR = await supabase
          .from("barbershops")
          .select("id, name, subdomain")
          .eq("owner_id", userId)
          .neq("subdomain", "_system")
          .limit(1)
          .maybeSingle();
        ownedRow = ownedR.data ?? null;
        ownedOutcome = { value: Boolean(ownedR.data), error: ownedR.error };
      }

      // Outra execução (retry ou troca de usuário) assumiu no meio do caminho.
      if (myRun !== runId.current) return;

      const resolution = resolveDashboardRole({
        superAdmin: { value: Boolean(superAdminR.data), error: superAdminR.error },
        roles: { value: rolesList, error: rolesR.error },
        owned: ownedOutcome,
      });

      if (resolution.status === "expired") {
        // Token inválido/expirado: limpa a sessão morta e devolve ao login, em
        // vez de oferecer um "tentar novamente" que falharia de novo.
        resolvedForUser.current = null;
        failedForUser.current = null;
        await supabase.auth.signOut();
        navigate({ to: "/login", search: { redirect: undefined }, replace: true });
        return;
      }

      if (resolution.status === "error") {
        // Sem decisão: nada de redirecionar e nada de conteúdo administrativo.
        // `failedForUser` impede re-tentativa automática em laço; a reconsulta
        // passa a ser exclusivamente pelo botão "Tentar novamente".
        resolvedForUser.current = null;
        failedForUser.current = userId;
        setRole(null);
        setOrphanShop(null);
        setRoleStatus("error");
        return;
      }

      failedForUser.current = null;
      resolvedForUser.current = userId;
      setOrphanShop(ownedRow);
      setRole(resolution.role);
      setRoleStatus("ready");
    },
    [navigate],
  );

  useEffect(() => {
    if (!user || barbershopLoading) return;
    // Sem esta trava, qualquer novo objeto `user` vindo do useAuth (ou um toggle
    // de `barbershopLoading`) refazia as consultas e realimentava o render.
    // Ela só é gravada em caso de sucesso, então erro sempre permite retry.
    if (resolvedForUser.current === user.id || failedForUser.current === user.id) return;
    // Marcado ANTES da chamada: a trava também cobre a consulta em andamento,
    // senão um novo objeto `user` durante o voo dispararia outra rodada.
    resolvedForUser.current = user.id;
    void resolveRoles(user.id);
  }, [user, resolvedBarbershopId, barbershopLoading, resolveRoles]);

  const retryRoles = useCallback(() => {
    if (!user) return;
    failedForUser.current = null;
    resolvedForUser.current = user.id;
    void resolveRoles(user.id);
  }, [user, resolveRoles]);

  // Quem não tem papel operacional vai para a própria área de cliente. O
  // onboarding não é destino daqui: criar barbearia é uma ação declarada, feita
  // pelos CTAs públicos. O único destino possível não volta para /dashboard,
  // então não há loop; o ref garante um único disparo por montagem.
  useEffect(() => {
    // `roleStatus !== "ready"` cobre o caso de erro: sem decisão, sem redirect.
    if (roleStatus !== "ready" || !role || redirectDone.current) return;
    const to = dashboardRedirect(role);
    if (!to) return;
    redirectDone.current = true;
    navigate({ to, replace: true });
  }, [role, roleStatus, navigate]);

  /** Cria o vínculo de admin que faltou, sem criar outra barbearia. */
  const repairOrphanOwner = useCallback(async () => {
    if (!user || !orphanShop || repairing) return;
    setRepairing(true);
    const { error } = await supabase.from("user_roles").insert({
      user_id: user.id,
      barbershop_id: orphanShop.id,
      role: "admin_barbearia" as const,
    });
    if (error) {
      setRepairing(false);
      // O detalhe técnico (tabela, política, código SQL) fica no console; o
      // usuário vê só o que pode fazer a respeito.
      console.error("[dashboard] falha ao reparar vínculo de proprietário:", error);
      toast.error("Não foi possível concluir a configuração. Tente novamente.");
      return;
    }
    toast.success("Configuração concluída!");
    window.location.reload();
  }, [user, orphanShop, repairing]);

  if (loading || !user || roleStatus === "loading" || barbershopLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Não deu para determinar o acesso. Nada de painel, nada de redirect e nada
  // de detalhe interno do banco na mensagem — só o que o usuário pode fazer.
  if (roleStatus === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full text-center space-y-5">
          <h1 className="font-display text-2xl text-foreground">Não foi possível verificar seu acesso</h1>
          <p className="text-sm text-muted-foreground">
            A verificação das suas permissões não pôde ser concluída. Isso costuma ser temporário.
            Tente novamente em instantes.
          </p>
          <Button onClick={retryRoles} className="w-full">
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  if (role === "super_admin") {
    // Sem `?barbershop=`, o super_admin vê o painel da PLATAFORMA. Com ele, vê o
    // dashboard DAQUELE tenant — é o que `/agenda?barbershop=<uuid>` já fazia, e
    // que precisa continuar existindo agora que a "Agenda Semanal" mora na aba
    // Horários.
    //
    // A nav de abas nesse modo mostra só "Horários", e a restrição é de
    // correção, não de cautela: as demais abas leem `useBarbershop()`, que
    // resolve a barbearia DO USUÁRIO e não aceita override. Exibi-las aqui
    // mostraria dado da barbearia errada — ou vazio — com o nome da certa no
    // cabeçalho. Tornar as outras abas escopáveis é trabalho à parte.
    return requestedBarbershopId ? (
      <BarberDashboard isAdmin requestedBarbershopId={requestedBarbershopId} abaInicial={tab} />
    ) : (
      <AdminDashboard />
    );
  }

  if (role === "admin_barbearia") {
    return <BarberDashboard isAdmin abaInicial={tab} />;
  }

  if (role === "barbeiro") {
    return <BarberDashboard abaInicial={tab} />;
  }

  // Dono sem vínculo de admin: barbearia existe, papel não. Nunca criamos uma
  // segunda barbearia — oferecemos concluir o vínculo que faltou.
  if (role === "orphan_owner" && orphanShop) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md w-full text-center space-y-5">
          <h1 className="font-display text-2xl text-foreground">Configuração incompleta</h1>
          <p className="text-sm text-muted-foreground">
            Sua barbearia <strong className="text-foreground">{orphanShop.name}</strong> foi criada,
            mas o vínculo de administrador não foi concluído. Nenhuma barbearia nova será criada —
            basta finalizar o vínculo existente.
          </p>
          <Button onClick={repairOrphanOwner} disabled={repairing} className="w-full">
            {repairing ? "Concluindo…" : "Concluir configuração"}
          </Button>
        </div>
      </div>
    );
  }

  // Cliente — o efeito de redirect acima já o está mandando para a própria área
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

