import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { Scissors } from "lucide-react";

interface AuthFormProps {
  /** Path to redirect to after a successful login or after the email confirmation flow. */
  redirectTo?: string;
}

export function AuthForm({ redirectTo }: AuthFormProps = {}) {
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp } = useAuth();

  const buildLoginRedirect = () => {
    if (typeof window === "undefined") return undefined;
    const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/login";
    return `${window.location.origin}/login${target !== "/login" ? `?redirect=${encodeURIComponent(target)}` : ""}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setSuccess("Enviamos um link de recuperação para seu email.");
      } else if (mode === "login") {
        await signIn(email, password);
      } else {
        await signUp(email, password, fullName, buildLoginRedirect());
        setSuccess("Verifique seu email para confirmar o cadastro. Após confirmar, você poderá fazer login.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex flex-col items-center mb-8">
        <div className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-4 shadow-gold">
          <Scissors className="w-8 h-8 text-primary-foreground" />
        </div>
        <h1 className="text-3xl font-display text-foreground">
          {mode === "login" ? "Entrar" : mode === "register" ? "Criar conta" : "Recuperar senha"}
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {mode === "login"
            ? "Acesse sua barbearia"
            : mode === "register"
              ? "Crie sua conta para começar"
              : "Enviaremos um link para redefinir sua senha"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "register" && (
          <div className="space-y-2">
            <Label htmlFor="fullName">Nome completo</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Seu nome"
              required
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="seu@email.com"
            required
          />
        </div>
        {mode !== "forgot" && (
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
            />
          </div>
        )}

        {mode === "login" && (
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
              onClick={() => { setMode("forgot"); setError(""); setSuccess(""); }}
            >
              Esqueceu a senha?
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>
        )}
        {success && (
          <p className="text-sm text-primary bg-primary/10 p-3 rounded-md">{success}</p>
        )}

        <Button type="submit" variant="gold" size="lg" className="w-full" disabled={submitting}>
          {submitting ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "register" ? "Criar conta" : "Enviar link"}
        </Button>
      </form>

      {mode !== "forgot" && (
        <>
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-background px-2 text-muted-foreground">ou continue com</span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={async () => {
                const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
                const result = await lovable.auth.signInWithOAuth("google", {
                  redirect_uri: `${window.location.origin}${target}`,
                });
                if (result.error) setError("Erro ao entrar com Google");
              }}
              type="button"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Google
            </Button>

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              onClick={async () => {
                const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/";
                const result = await lovable.auth.signInWithOAuth("apple", {
                  redirect_uri: `${window.location.origin}${target}`,
                });
                if (result.error) setError("Erro ao entrar com Apple");
              }}
              type="button"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Apple
            </Button>
          </div>
        </>
      )}

      <p className="text-center text-sm text-muted-foreground mt-6">
        {mode === "forgot" ? (
          <button
            type="button"
            className="text-primary hover:underline font-medium"
            onClick={() => { setMode("login"); setError(""); setSuccess(""); }}
          >
            Voltar ao login
          </button>
        ) : (
          <>
            {mode === "login" ? "Não tem conta?" : "Já tem conta?"}{" "}
            <button
              type="button"
              className="text-primary hover:underline font-medium"
              onClick={() => {
                setMode(mode === "login" ? "register" : "login");
                setError("");
                setSuccess("");
              }}
            >
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
