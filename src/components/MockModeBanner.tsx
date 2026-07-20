/**
 * Indicador do modo offline + ação para restaurar os dados fictícios.
 * Só renderiza quando VITE_DATA_SOURCE=mock.
 */
import { useState } from "react";
import { isMockDataSource } from "@/lib/data-source";
import { resetMockDatabase } from "@/mocks/store";
import { clearMockSession } from "@/mocks/auth";
import { MOCK_ADMIN_EMAIL } from "@/mocks/fixtures";

export function MockModeBanner() {
  const [open, setOpen] = useState(false);

  if (!isMockDataSource) return null;

  function handleReset() {
    resetMockDatabase();
    clearMockSession();
    if (typeof window !== "undefined") window.location.reload();
  }

  return (
    <div className="fixed bottom-3 left-3 z-[9999] font-mono text-xs">
      {open && (
        <div className="mb-2 w-64 rounded-md border border-amber-500/40 bg-background p-3 shadow-lg">
          <p className="font-semibold text-foreground">Modo offline</p>
          <p className="mt-1 leading-relaxed text-muted-foreground">
            Dados fictícios em localStorage. Nenhuma requisição ao Supabase.
          </p>
          <p className="mt-2 break-all text-muted-foreground">
            Login: <span className="text-foreground">{MOCK_ADMIN_EMAIL}</span>
            <br />
            Senha: qualquer valor
          </p>
          <button
            type="button"
            onClick={handleReset}
            className="mt-3 w-full rounded border border-input bg-background px-2 py-1.5 font-medium text-foreground transition-colors hover:bg-accent"
          >
            Restaurar dados fictícios
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 font-semibold text-amber-600 shadow-sm transition-colors hover:bg-amber-500/20"
      >
        offline · mock
      </button>
    </div>
  );
}
