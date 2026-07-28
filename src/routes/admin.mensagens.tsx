import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Mail, MessageCircle, Phone, Search, Inbox } from "lucide-react";
import { toast } from "sonner";
import { logTechnicalError } from "@/lib/error-reporting";
import { displayBRPhone, whatsappUrl } from "@/lib/phone";

export const Route = createFileRoute("/admin/mensagens")({
  head: () => ({
    meta: [
      { title: "Mensagens de contato — BarbaFlow Admin" },
      { name: "description", content: "Mensagens enviadas pelo formulário público de contato." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ContactMessagesPage,
});

type ContactRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  created_at: string;
};

/**
 * Período de leitura. "all" existe porque mensagem antiga sem resposta continua
 * sendo mensagem sem resposta — não há marcação de "lida" no banco, então
 * esconder o histórico por padrão perderia justamente o que ficou para trás.
 */
type Period = "7" | "30" | "all";

const PERIOD_DAYS: Record<Period, number | null> = { "7": 7, "30": 30, all: null };

/** Data e hora legíveis; a hora importa para saber se a mensagem é de agora. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContactMessagesPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<Period>("30");
  const [rows, setRows] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  // Guarda de sessão e papel — mesma forma do relatório de churn.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({ to: "/login", search: { redirect: undefined } });
      return;
    }
    supabase
      .rpc("has_role", { _user_id: user.id, _role: "super_admin" })
      .then(({ data, error }) => {
        setAllowed(!error && Boolean(data));
      });
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);

    const days = PERIOD_DAYS[period];
    let query = supabase
      .from("contact_submissions")
      .select("id, name, email, phone, message, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (days !== null) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", since);
    }

    query.then(({ data, error }) => {
      if (error) {
        logTechnicalError("admin.mensagens", "carregar mensagens de contato", error);
        toast.error("Não foi possível carregar as mensagens. Tente novamente.");
        setRows([]);
      } else {
        setRows((data ?? []) as ContactRow[]);
      }
      setLoading(false);
    });
  }, [allowed, period]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.phone ?? "", r.message].some((campo) =>
        campo.toLowerCase().includes(termo),
      ),
    );
  }, [rows, busca]);

  // "Novas" = últimas 24h. Sem campo de leitura no banco, é o melhor sinal
  // honesto de que algo chegou desde ontem — e não finge saber o que já foi
  // respondido.
  const novas = useMemo(() => {
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    return rows.filter((r) => new Date(r.created_at).getTime() >= limite).length;
  }, [rows]);

  if (authLoading || allowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Acesso negado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Esta página é restrita a administradores do sistema.
            </p>
            <Link to="/dashboard" search={{ checkout: undefined }}>
              <Button variant="secondary" className="w-full">
                Voltar ao painel
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border px-4 py-4 md:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/dashboard" search={{ checkout: undefined }}>
              <Button variant="ghost" size="sm">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Voltar</span>
              </Button>
            </Link>
            <div className="min-w-0">
              <h1 className="font-display text-lg text-foreground truncate">
                Mensagens de contato
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Enviadas pelo formulário público
              </p>
            </div>
          </div>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <TabsList>
              <TabsTrigger value="7">7 dias</TabsTrigger>
              <TabsTrigger value="30">30 dias</TabsTrigger>
              <TabsTrigger value="all">Todas</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Inbox className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">
                  Mensagens no período
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-display font-bold text-foreground">
                  {rows.length}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <MessageCircle className="w-4 h-4 text-primary" />
                <span className="text-xs text-muted-foreground">
                  Últimas 24 horas
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-display font-bold text-foreground">
                  {novas}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="gap-3">
            <CardTitle className="text-base">
              Caixa de entrada — {period === "all" ? "todo o histórico" : `últimos ${period} dias`}
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar por nome, e-mail, telefone ou texto"
                className="pl-9"
                aria-label="Buscar mensagens"
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-28 w-full" />
                ))}
              </div>
            ) : filtradas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Inbox className="w-10 h-10 text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Nenhuma mensagem neste período."
                    : "Nenhuma mensagem corresponde à busca."}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtradas.map((m) => {
                  const wa = whatsappUrl(m.phone);
                  return (
                    <article
                      key={m.id}
                      className="p-4 rounded-lg border border-border bg-card/50 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground break-words">
                            {m.name}
                          </p>
                          <p className="text-xs text-muted-foreground break-all">
                            {m.email}
                            {m.phone ? ` · ${displayBRPhone(m.phone)}` : ""}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(m.created_at)}
                        </span>
                      </div>

                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                        {m.message}
                      </p>

                      <div className="flex items-center gap-2 flex-wrap">
                        <a href={`mailto:${m.email}`}>
                          <Button variant="secondary" size="sm">
                            <Mail className="w-4 h-4" />
                            Responder por e-mail
                          </Button>
                        </a>
                        {wa && (
                          <a href={wa} target="_blank" rel="noopener noreferrer">
                            <Button variant="ghost" size="sm">
                              <Phone className="w-4 h-4" />
                              WhatsApp
                            </Button>
                          </a>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
