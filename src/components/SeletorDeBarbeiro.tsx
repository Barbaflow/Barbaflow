import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, AlertCircle } from "lucide-react";
import { fetchBarberDisplayNames } from "@/lib/barber-names";
import { logTechnicalError } from "@/lib/error-reporting";

export type BarbeiroDaEquipe = { id: string; name: string };
export type EstadoDaEquipe = "loading" | "ready" | "error";

/** Valor do seletor quando ele oferece a opção "todos". */
export const TODOS_OS_BARBEIROS = "all";

/**
 * Quem atende nesta barbearia.
 *
 * Extraído do carregador que vivia inline no `BarberDashboard` — a mesma
 * consulta servia o filtro da Visão Geral e nada mais, e agora a aba Horários
 * precisa dela também. Fica separado do componente de propósito: quem só quer a
 * lista (para pré-selecionar, contar, decidir se mostra a seção) usa o hook sem
 * arrastar interface junto.
 *
 * Filtra `role = 'barbeiro'`: desde a 20260805200000 o admin não atende, então
 * oferecê-lo como opção mostraria uma agenda que ninguém pode escolher.
 */
export function useBarbeirosDoTenant(barbershopId: string | null) {
  const [estado, setEstado] = useState<EstadoDaEquipe>("loading");
  const [barbeiros, setBarbeiros] = useState<BarbeiroDaEquipe[]>([]);

  const carregar = useCallback(async () => {
    if (!barbershopId) {
      setBarbeiros([]);
      setEstado("loading");
      return;
    }
    setEstado("loading");

    const { data: papeis, error } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("barbershop_id", barbershopId)
      .eq("role", "barbeiro");

    // "Não carregou" e "não tem ninguém" são estados DIFERENTES (§8 do
    // CLAUDE.md). Antes desta extração o carregador fazia `return` no erro e na
    // lista vazia, sem distinguir — e o seletor simplesmente sumia da tela.
    if (error) {
      logTechnicalError("SeletorDeBarbeiro", "carregar profissionais", error);
      setBarbeiros([]);
      setEstado("error");
      return;
    }

    const ids = [...new Set((papeis ?? []).map((p) => p.user_id))];
    if (ids.length === 0) {
      setBarbeiros([]);
      setEstado("ready");
      return;
    }

    const nomes = await fetchBarberDisplayNames(ids);
    setBarbeiros(ids.map((id) => ({ id, name: nomes[id]?.display_name || "Sem nome" })));
    setEstado("ready");
  }, [barbershopId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return { estado, barbeiros, recarregar: carregar };
}

interface SeletorDeBarbeiroProps {
  estado: EstadoDaEquipe;
  barbeiros: BarbeiroDaEquipe[];
  value: string | null;
  onChange: (id: string) => void;
  onTentarNovamente: () => void;
  /** Acrescenta "Todos os barbeiros" — o filtro da Visão Geral precisa dela. */
  incluirTodos?: boolean;
  /** O que mostrar quando a equipe está vazia. Cada tela tem a sua saída. */
  vazio?: ReactNode;
  rotulo?: string;
}

/**
 * Seletor de profissional, com os quatro estados desenhados.
 *
 * Recebe a lista pronta em vez de carregá-la: assim a tela que precisa do
 * conteúdo (pré-seleção, contagem) usa `useBarbeirosDoTenant` uma vez só e
 * passa adiante, sem duas consultas para a mesma coisa.
 */
export function SeletorDeBarbeiro({
  estado,
  barbeiros,
  value,
  onChange,
  onTentarNovamente,
  incluirTodos = false,
  vazio,
  rotulo = "Filtrar por profissional",
}: SeletorDeBarbeiroProps) {
  if (estado === "loading") {
    return <Skeleton className="h-9 w-[220px] rounded-md" />;
  }

  if (estado === "error") {
    return (
      <div className="flex items-center gap-3 text-sm">
        <AlertCircle className="w-4 h-4 text-destructive shrink-0" />
        <span className="text-muted-foreground">Não foi possível carregar a equipe.</span>
        <Button variant="outline" size="sm" onClick={onTentarNovamente}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (barbeiros.length === 0 && !incluirTodos) {
    return <>{vazio ?? null}</>;
  }

  return (
    <div className="flex items-center gap-3">
      <Users className="w-4 h-4 text-muted-foreground shrink-0" />
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-[220px] h-9">
          <SelectValue placeholder={rotulo} />
        </SelectTrigger>
        <SelectContent>
          {incluirTodos && <SelectItem value={TODOS_OS_BARBEIROS}>Todos os barbeiros</SelectItem>}
          {barbeiros.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
