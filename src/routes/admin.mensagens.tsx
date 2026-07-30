import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Mail, MessageCircle, Phone, Search, Inbox, AlertTriangle, RefreshCw } from "lucide-react";
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

/**
 * Teto de linhas por consulta. Quando a resposta vem exatamente com este
 * tamanho, muito provavelmente há mais mensagens do que couberam — a contagem
 * então é exibida como "500+", nunca como se fosse o total exato.
 */
const LIMITE_CONSULTA = 500;

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
  /**
   * "Não é super_admin" e "não deu para verificar" são coisas diferentes.
   * Colapsar as duas em `allowed = false` mostraria "Acesso negado" a um
   * super_admin legítimo só porque a rede caiu, sem nenhuma saída. Este estado
   * separa o segundo caso, e `roleAttempt` é o que permite tentar de novo.
   */
  const [roleError, setRoleError] = useState(false);
  const [roleAttempt, setRoleAttempt] = useState(0);
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
    let cancelled = false;
    setRoleError(false);
    setAllowed(null);
    (async () => {
      try {
        const { data, error } = await supabase.rpc("has_role", {
          _user_id: user.id,
          _role: "super_admin",
        });
        if (cancelled) return;
        if (error) {
          logTechnicalError("admin.mensagens", "verificar papel de super_admin", error);
          setRoleError(true);
          return;
        }
        setAllowed(Boolean(data));
      } catch (err) {
        // O supabase-js normalmente resolve com `error` em vez de rejeitar; se
        // rejeitar mesmo assim, sem este catch o estado ficaria em `null` e o
        // spinner giraria para sempre.
        if (cancelled) return;
        logTechnicalError("admin.mensagens", "verificar papel de super_admin", err);
        setRoleError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, navigate, roleAttempt]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);

    // Trocar de período rápido deixa duas consultas no ar. Sem esta flag, a que
    // responder por último vence — e pode ser a antiga, mostrando 30 dias sob a
    // aba "7 dias". Mesma forma usada em use-tenant-scope.
    let cancelled = false;

    const days = PERIOD_DAYS[period];
    let query = supabase
      .from("contact_submissions")
      .select("id, name, email, phone, message, created_at")
      .order("created_at", { ascending: false })
      .limit(LIMITE_CONSULTA);

    if (days !== null) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", since);
    }

    query.then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        logTechnicalError("admin.mensagens", "carregar mensagens de contato", error);
        toast.error("Não foi possível carregar as mensagens. Tente novamente.");
        setRows([]);
      } else {
        setRows((data ?? []) as ContactRow[]);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
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

  /**
   * A consulta veio cheia até o teto: existe a chance real de haver mensagem
   * mais antiga que ficou de fora. Mostrar "500" seco afirmaria um total que
   * não foi apurado.
   */
  const truncado = rows.length >= LIMITE_CONSULTA;

  /**
   * Com busca ativa, o card passa a contar o que está de fato na tela. Antes
   * ele mostrava o total bruto enquanto a lista mostrava o filtrado — dois
   * números discordando na mesma tela, e o de cima era o errado.
   */
  const buscaAtiva = busca.trim().length > 0;
  const contagem = buscaAtiva ? filtradas.length : rows.length;

  // "Novas" = últimas 24h. Sem campo de leitura no banco, é o melhor sinal
  // honesto de que algo chegou desde ontem — e não finge saber o que já foi
  // respondido.
  const novas = useMemo(() => {
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    return rows.filter((r) => new Date(r.created_at).getTime() >= limite).length;
  }, [rows]);

  // Falha na verificação vem antes do spinner: com `roleError`, `allowed`
  // continua `null`, e sem este ramo a tela ficaria carregando para sempre.
  if (roleError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Não foi possível verificar seu acesso
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A verificação de permissão falhou — isso costuma ser problema de
              conexão, não de permissão. Tente novamente.
            </p>
            <Button className="w-full" onClick={() => setRoleAttempt((n) => n + 1)}>
              <RefreshCw className="w-4 h-4" />
              Tentar novamente
            </Button>
            <Link to="/dashboard" search={{ checkout: undefined }}>
              <Button variant="ghost" className="w-full">
                Voltar ao painel
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

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
                  {buscaAtiva ? "Mensagens encontradas" : "Mensagens no período"}
                </span>
              </div>
              {loading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <p className="text-2xl font-display font-bold text-foreground">
                    {contagem}
                    {truncado ? "+" : ""}
                  </p>
                  {truncado && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {buscaAtiva
                        ? `Busca feita sobre as ${LIMITE_CONSULTA} mais recentes — pode haver mais.`
                        : `Exibindo as ${LIMITE_CONSULTA} mais recentes — pode haver mais.`}
                    </p>
                  )}
                </>
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
                        {/* O e-mail vem de inserção pública e o banco não o
                            valida: sem encode, um valor como
                            "a@b.c?subject=…&body=…" pré-preencheria o rascunho
                            de resposta com texto de terceiro. */}
                        <a href={`mailto:${encodeURIComponent(m.email)}`}>
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
