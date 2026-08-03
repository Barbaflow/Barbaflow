import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scissors, CheckCircle, MailWarning } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { logTechnicalError } from "@/lib/error-reporting";
import {
  decideRecoveryState,
  parseRecoveryLink,
  recoveryLinkMessage,
  resetFlowMessage,
  validateNewPassword,
  PASSWORD_MIN_LENGTH,
  RECOVERY_MISSING_SESSION_MESSAGE,
  RESET_UPDATE_FALLBACK,
  type RecoveryLink,
} from "@/lib/password-recovery";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Redefinir Senha — BarbaFlow" },
      { name: "description", content: "Defina sua nova senha de acesso ao BarbaFlow." },
      { property: "og:title", content: "Redefinir Senha — BarbaFlow" },
      { property: "og:description", content: "Defina sua nova senha de acesso ao BarbaFlow." },
      { property: "og:image", content: "https://barbaflow-delta.vercel.app/og-image.jpg" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Redefinir Senha — BarbaFlow" },
      { name: "twitter:image", content: "https://barbaflow-delta.vercel.app/og-image.jpg" },
    ],
  }),
  // Rota pública de propósito: quem chega aqui vem do e-mail, sem sessão comum.
  // Sem guarda de carregamento, sem papel exigido, sem desvio para /login.
  component: ResetPasswordPage,
});

/** Estados possíveis da tela. `verificando` é o único que o SSR renderiza. */
type Estado = "verificando" | "pronto" | "invalido" | "sem-sessao" | "sucesso";

/**
 * Lê o link uma única vez, ainda na primeira renderização: o supabase-js limpa
 * o fragmento assim que valida os tokens, e um `useEffect` chegaria tarde.
 */
function lerLinkAtual(): RecoveryLink {
  if (typeof window === "undefined") return { kind: "ausente" };
  return parseRecoveryLink({ hash: window.location.hash, search: window.location.search });
}

function ResetPasswordPage() {
  const [link] = useState<RecoveryLink>(lerLinkAtual);
  const [estado, setEstado] = useState<Estado>("verificando");
  const [aviso, setAviso] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let ativo = true;

    /** Só sai de "verificando"/"sem-sessao"; nunca desfaz sucesso ou erro do link. */
    const liberarFormulario = () => {
      setEstado((atual) => (atual === "verificando" || atual === "sem-sessao" ? "pronto" : atual));
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!ativo) return;
      if (event === "PASSWORD_RECOVERY" || session) liberarFormulario();
    });

    const resolver = async () => {
      // `getSession()` aguarda a inicialização do cliente — inclusive a leitura
      // do fragmento. É o sinal determinístico, sem corrida com o evento.
      const { data } = await supabase.auth.getSession();
      if (!ativo) return;

      const decisao = decideRecoveryState({ link, hasSession: Boolean(data.session) });

      if (decisao.status === "pronto") {
        liberarFormulario();
        return;
      }

      if (decisao.status === "invalido") {
        setAviso(recoveryLinkMessage(decisao.reason));
        setEstado("invalido");
        return;
      }

      if (decisao.status === "trocar") {
        const trocada = await trocarPorSessao(decisao.link);
        if (!ativo) return;
        if (trocada) {
          liberarFormulario();
        } else {
          setAviso(recoveryLinkMessage("expirado"));
          setEstado("invalido");
        }
        return;
      }

      setAviso(RECOVERY_MISSING_SESSION_MESSAGE);
      setEstado("sem-sessao");
    };

    resolver().catch((err: unknown) => {
      logTechnicalError("reset-password", "verificar link de recuperação", err);
      if (!ativo) return;
      setAviso(RECOVERY_MISSING_SESSION_MESSAGE);
      setEstado("sem-sessao");
    });

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [link]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setError("");

      const validacao = validateNewPassword(password, confirmPassword);
      if (!validacao.ok) {
        setError(validacao.message);
        return;
      }

      setSubmitting(true);
      try {
        const { error: falha } = await supabase.auth.updateUser({ password });
        if (falha) throw falha;

        setEstado("sucesso");
        // A sessão de recuperação cumpriu o papel: encerramos para que o acesso
        // seja refeito com a senha nova, e nenhum token do e-mail siga válido.
        try {
          await supabase.auth.signOut();
        } catch (err: unknown) {
          logTechnicalError("reset-password", "encerrar sessão de recuperação", err);
        }
      } catch (err: unknown) {
        logTechnicalError("reset-password", "redefinir senha", err);
        setError(resetFlowMessage(err, RESET_UPDATE_FALLBACK));
      } finally {
        setSubmitting(false);
      }
    },
    [confirmPassword, password, submitting],
  );

  if (estado === "sucesso") {
    return (
      <Moldura>
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-display text-foreground mb-2">Senha redefinida!</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Sua senha foi alterada. Entre com a nova senha para continuar.
          </p>
          <Link to="/login">
            <Button variant="gold" size="lg" className="w-full">
              Ir para o login
            </Button>
          </Link>
        </div>
      </Moldura>
    );
  }

  if (estado === "verificando") {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Verificando seu link…</p>
        </div>
      </Moldura>
    );
  }

  if (estado === "invalido" || estado === "sem-sessao") {
    return (
      <Moldura>
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
            <MailWarning className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-display text-foreground mb-2">Link indisponível</h1>
          <p className="text-muted-foreground text-sm mb-6">{aviso}</p>
          <Link to="/login">
            <Button variant="gold" size="lg" className="w-full">
              Solicitar novo link
            </Button>
          </Link>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-4 shadow-gold">
          <Scissors className="w-8 h-8 text-primary-foreground" />
        </div>
        <h1 className="text-3xl font-display text-foreground">Nova senha</h1>
        <p className="text-muted-foreground mt-2 text-sm">Defina sua nova senha abaixo.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Nova senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={PASSWORD_MIN_LENGTH}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar senha</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
            minLength={PASSWORD_MIN_LENGTH}
          />
        </div>

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>
        )}

        <Button type="submit" variant="gold" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Aguarde..." : "Redefinir senha"}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-primary hover:underline font-medium">
            Voltar ao login
          </Link>
        </p>
      </form>
    </Moldura>
  );
}

/**
 * Troca o código do link por uma sessão. `false` quando o código não vale mais
 * — o motivo técnico fica no console, nunca na tela.
 */
async function trocarPorSessao(
  link: Extract<RecoveryLink, { kind: "pkce" } | { kind: "token-hash" }>,
): Promise<boolean> {
  try {
    if (link.kind === "pkce") {
      const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);
      if (error) throw error;
      return Boolean(data.session);
    }

    const { data, error } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: link.tokenHash,
    });
    if (error) throw error;
    return Boolean(data.session);
  } catch (err: unknown) {
    logTechnicalError("reset-password", "validar código de recuperação", err);
    return false;
  }
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md mx-auto">{children}</div>
    </div>
  );
}
