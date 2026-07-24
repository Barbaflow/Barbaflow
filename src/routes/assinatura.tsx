import { useEffect, useState, useCallback } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useBarbershop } from "@/hooks/use-barbershop";
import { useTenantScope, tenantAccessMessage } from "@/hooks/use-tenant-scope";
import { usePlan } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Crown,
  CreditCard,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Store,
} from "lucide-react";
import {
  resolveBillingView,
  BILLING_VIEW_META,
  fmtDateBR,
  type BarbershopSubscription,
} from "@/lib/subscription";

export const Route = createFileRoute("/assinatura")({
  head: () => ({
    meta: [
      { title: "Assinatura — BarbaFlow" },
      { name: "description", content: "Gerencie o plano e a cobrança da sua barbearia." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { barbershop?: string } => ({
    barbershop: typeof search.barbershop === "string" ? search.barbershop : undefined,
  }),
  component: AssinaturaPage,
});

/** Ambiente Paddle resolvido do token público (test_ → sandbox). */
function paddleEnv(): "sandbox" | "live" {
  const token = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;
  return token && token.startsWith("test_") ? "sandbox" : "live";
}

/**
 * Página de cobrança da assinatura da barbearia.
 *
 * Gate: só admin_barbearia (ou super_admin com tenant selecionado). Barbeiro e
 * cliente não gerenciam a assinatura. O tenant vem de useTenantScope (nunca do
 * barbershopId legado). A verdade do status vem do banco (webhook do Paddle);
 * cancelar/gerenciar acontecem no portal hospedado do Paddle.
 */
function AssinaturaPage() {
  const { user, loading: authLoading } = useAuth();
  const { barbershop, tenantStatus } = useBarbershop();
  const { barbershop: requestedId } = Route.useSearch();
  const scope = useTenantScope({
    requestedBarbershopId: requestedId ?? null,
    allow: ["admin_barbearia"], // barbeiro NÃO gerencia assinatura
  });
  const plan = usePlan(scope.access === "granted" ? scope.tenantId ?? undefined : undefined);

  const [sub, setSub] = useState<BarbershopSubscription | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const isForeignTenant = Boolean(scope.tenantId && scope.tenantId !== barbershop?.id);

  const resolving =
    authLoading || !user || scope.isSuper === null || tenantStatus === "loading" || scope.access === "checking";
  const tenantId = scope.access === "granted" ? scope.tenantId : null;

  const fetchSubscription = useCallback(async () => {
    if (!tenantId) return;
    setStatus("loading");
    const { data, error } = await supabase.rpc("get_barbershop_subscription", {
      _barbershop_id: tenantId,
    });
    if (error) {
      setStatus("error");
      return;
    }
    setSub((data?.[0] as BarbershopSubscription | undefined) ?? null);
    setStatus("ready");
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) fetchSubscription();
  }, [tenantId, fetchSubscription]);

  const openPortal = useCallback(async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-portal-session", {
        body: { environment: paddleEnv() },
      });
      if (error || !data?.url) {
        setPortalError("O portal de cobrança está indisponível no momento. Tente novamente em instantes.");
        return;
      }
      window.open(data.url as string, "_blank", "noopener");
    } catch {
      setPortalError("O portal de cobrança está indisponível no momento.");
    } finally {
      setPortalLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link to="/dashboard" search={{ checkout: undefined }}>
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-lg font-bold text-foreground truncate">Assinatura</h1>
            <p className="text-xs text-muted-foreground truncate">
              {isForeignTenant ? "Barbearia selecionada" : barbershop?.name ?? "Sua barbearia"}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {isForeignTenant && tenantId && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <Store className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              Você está gerenciando a assinatura desta barbearia como super admin.
            </p>
          </div>
        )}

        {resolving ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : !tenantId ? (
          <AccessDenied scope={scope} />
        ) : status === "loading" || plan.loading ? (
          <Skeleton className="h-48 rounded-xl" />
        ) : status === "error" ? (
          <ErrorCard onRetry={fetchSubscription} />
        ) : (
          <SubscriptionBody
            planName={plan.planName}
            price={plan.price}
            sub={sub}
            portalLoading={portalLoading}
            portalError={portalError}
            onPortal={openPortal}
          />
        )}
      </main>
    </div>
  );
}

function SubscriptionBody({
  planName,
  price,
  sub,
  portalLoading,
  portalError,
  onPortal,
}: {
  planName: string;
  price: number;
  sub: BarbershopSubscription | null;
  portalLoading: boolean;
  portalError: string | null;
  onPortal: () => void;
}) {
  const view = resolveBillingView(planName, sub);
  const meta = BILLING_VIEW_META[view];
  const isFree = view === "free";
  const hasSubscription = !isFree && view !== "canceled";

  const toneClass =
    meta.tone === "good"
      ? "text-emerald-500"
      : meta.tone === "warn"
        ? "text-amber-500"
        : meta.tone === "danger"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <>
      {/* Plano atual + status */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Plano atual</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crown className={`w-5 h-5 ${isFree ? "text-muted-foreground" : "text-primary"}`} />
              <span className="text-xl font-display font-bold text-foreground capitalize">{planName}</span>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-foreground">
                {price > 0 ? `R$ ${price.toFixed(0)}/mês` : "Grátis"}
              </p>
            </div>
          </div>

          <div className={`flex items-center gap-2 text-sm ${toneClass}`}>
            {meta.tone === "good" ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : meta.tone === "neutral" ? (
              <CreditCard className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            <span className="font-medium">{meta.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">{meta.hint}</p>
        </CardContent>
      </Card>

      {/* Detalhes do período (só quando há assinatura) */}
      {sub && !isFree && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cobrança</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2 text-sm">
            <Row label="Início do período" value={fmtDateBR(sub.current_period_start)} />
            <Row
              label={sub.cancel_at_period_end ? "Encerra em" : "Próxima renovação"}
              value={fmtDateBR(sub.current_period_end)}
            />
            {view === "trialing" && <Row label="Fim do teste" value={fmtDateBR(sub.trial_end)} />}
            {view === "cancel-scheduled" && (
              <Row label="Cancelamento programado" value={`para ${fmtDateBR(sub.current_period_end)}`} />
            )}
            {sub.canceled_at && <Row label="Cancelada em" value={fmtDateBR(sub.canceled_at)} />}
            <Row label="Ambiente" value={sub.environment} />
          </CardContent>
        </Card>
      )}

      {/* Ações */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3">
        {(isFree || view === "canceled") && (
          <Link to="/upgrade" className="flex-1">
            <Button variant="gold" size="lg" className="w-full">
              <Crown className="w-4 h-4" />
              Fazer upgrade
            </Button>
          </Link>
        )}
        {hasSubscription && (
          <Button variant="outline" size="lg" className="flex-1" onClick={onPortal} disabled={portalLoading}>
            <CreditCard className="w-4 h-4" />
            {portalLoading ? "Abrindo…" : "Gerenciar cobrança"}
          </Button>
        )}
        {view === "cancel-scheduled" && (
          <Button variant="outline" size="lg" className="flex-1" onClick={onPortal} disabled={portalLoading}>
            Reativar assinatura
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Alterações de pagamento, cancelamento e reativação são feitas no portal seguro do provedor. A
        confirmação chega por webhook — o status acima reflete o que o provedor confirmou.
      </p>
      {portalError && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          {portalError}
        </p>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}

function AccessDenied({ scope }: { scope: ReturnType<typeof useTenantScope> }) {
  const { titulo, texto } = tenantAccessMessage(scope.access, scope.accessError, "a assinatura");
  return (
    <Card className="border-border">
      <CardContent className="p-8 text-center space-y-3">
        <ShieldAlert className="w-10 h-10 mx-auto text-muted-foreground" />
        <h2 className="font-display text-lg text-foreground">{titulo || "Acesso restrito"}</h2>
        <p className="text-sm text-muted-foreground">
          {texto || "Apenas o administrador da barbearia pode gerenciar a assinatura."}
        </p>
        <Link to="/dashboard" search={{ checkout: undefined }}>
          <Button variant="ghost">Voltar ao painel</Button>
        </Link>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="p-8 text-center space-y-4">
        <AlertTriangle className="w-10 h-10 mx-auto text-destructive" />
        <h2 className="font-display text-lg text-foreground">Não foi possível carregar a assinatura</h2>
        <Button variant="outline" onClick={onRetry}>
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  );
}
