/**
 * Catálogo público de produtos.
 *
 * O visitante anônimo não lê `products`: a tabela guarda `stock_quantity` e
 * produtos inativos, e RLS filtra linhas, não colunas. O acesso público passa
 * pela função `get_public_products` (migration 20260727120000), que devolve
 * colunas explícitas e um `in_stock` booleano no lugar da quantidade.
 *
 * Este módulo é a ÚNICA porta do frontend público para produtos. Nenhuma tela
 * pública deve chamar `supabase.from("products")`.
 *
 * Sobre a tipagem: `src/integrations/supabase/types.ts` é gerado a partir do
 * schema REMOTO e a migration ainda não foi aplicada lá, então a função ainda
 * não existe em `Database["public"]["Functions"]`. Por isso a chamada usa um
 * cast estreito, isolado aqui. Depois de aplicar a migration e rodar
 * `npm run types:remote`, troque o cast por `supabase.rpc("get_public_products",
 * { _barbershop_id })` tipado e remova `RpcCaller`.
 */
import { supabase } from "@/integrations/supabase/client";

/** Produto como o público o vê. Note a AUSÊNCIA de `stock_quantity`. */
export interface PublicProduct {
  id: string;
  barbershop_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  /** `true` quando há pelo menos uma unidade. A quantidade exata é interna. */
  in_stock: boolean;
}

export const PUBLIC_PRODUCTS_RPC = "get_public_products";

/** Assinatura mínima da chamada — ver a nota sobre tipagem no topo. */
type RpcCaller = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Converte uma linha crua na forma pública, sem confiar no que veio.
 *
 * Se um dia a função passar a devolver `stock_quantity`, ele morre aqui: só os
 * campos abaixo são copiados. É a última barreira antes da tela.
 */
function toPublicProduct(raw: unknown): PublicProduct | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;

  return {
    id: r.id,
    barbershop_id: typeof r.barbershop_id === "string" ? r.barbershop_id : "",
    name: r.name,
    description: typeof r.description === "string" ? r.description : null,
    price: Number(r.price ?? 0),
    image_url: typeof r.image_url === "string" ? r.image_url : null,
    // Ausente ou indefinido é tratado como esgotado: na dúvida, não prometemos
    // ao cliente um produto que talvez não exista.
    in_stock: r.in_stock === true,
  };
}

/**
 * Busca o catálogo público de uma barbearia.
 *
 * Barbearia inexistente, não aprovada ou sentinela devolve lista vazia — a
 * função no banco não distingue os casos, de propósito: a página pública não
 * deve revelar que uma barbearia não aprovada existe.
 */
export async function fetchPublicProducts(
  barbershopId: string,
): Promise<{ data: PublicProduct[] | null; error: unknown }> {
  // Guarda barata: sem tenant não há consulta a fazer.
  if (!barbershopId) return { data: [], error: null };

  const client = supabase as unknown as RpcCaller;
  const { data, error } = await client.rpc(PUBLIC_PRODUCTS_RPC, {
    _barbershop_id: barbershopId,
  });

  if (error) return { data: null, error };
  if (!Array.isArray(data)) return { data: [], error: null };

  return { data: data.map(toPublicProduct).filter((p): p is PublicProduct => p !== null), error: null };
}
