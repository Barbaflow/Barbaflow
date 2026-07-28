import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, DollarSign, AlertCircle } from "lucide-react";
import { fetchPublicProducts, type PublicProduct } from "@/lib/public-catalog";
import { logTechnicalError } from "@/lib/error-reporting";

interface ProductsShowcaseProps {
  barbershopId: string;
}

/**
 * Vitrine pública de produtos.
 *
 * Consome `fetchPublicProducts` (RPC `get_public_products`) — nunca a tabela
 * `products`. O anônimo não tem acesso direto a ela desde a migration
 * 20260727120000, e o motivo é justamente esta tela: aqui só entram produtos
 * ativos, e a disponibilidade é o booleano `in_stock`, não a quantidade.
 */
export function ProductsShowcase({ barbershopId }: ProductsShowcaseProps) {
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    const { data, error } = await fetchPublicProducts(barbershopId);

    if (error) {
      // Falha de consulta não pode virar vitrine vazia: são estados diferentes.
      logTechnicalError("ProductsShowcase", "carregar catálogo público", error);
      setLoadError("Não foi possível carregar os produtos.");
      setProducts([]);
    } else {
      setProducts(data ?? []);
    }
    setLoading(false);
  }, [barbershopId]);

  useEffect(() => {
    let cancelado = false;
    // O estado só é aplicado se este efeito ainda for o vigente — trocar de
    // barbearia no meio da requisição não pode pintar a vitrine anterior.
    void (async () => {
      if (cancelado) return;
      await carregar();
    })();
    return () => {
      cancelado = true;
    };
  }, [carregar]);

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-48 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => void carregar()}>
          Tentar novamente
        </Button>
      </section>
    );
  }

  // Barbearia sem produtos publicados: a seção inteira some, como antes.
  if (products.length === 0) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl md:text-2xl font-display font-bold text-foreground">
          <span className="text-gradient-gold">Produtos</span>
        </h2>
        <p className="text-sm text-muted-foreground">Disponíveis na barbearia</p>
      </div>

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => (
          <Card
            key={product.id}
            className={`bg-card border-border hover:border-primary/40 transition-colors group overflow-hidden ${
              product.in_stock ? "" : "opacity-60"
            }`}
          >
            {product.image_url ? (
              <div className="aspect-square overflow-hidden">
                <img
                  src={product.image_url}
                  alt={product.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="aspect-square bg-muted flex items-center justify-center">
                <Package className="w-10 h-10 text-muted-foreground/40" />
              </div>
            )}
            <CardContent className="p-3 space-y-1">
              <h3 className="font-medium text-sm text-foreground truncate">{product.name}</h3>
              {product.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{product.description}</p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Badge variant="outline" className="border-primary/40 text-primary text-xs">
                  <DollarSign className="w-3 h-3" />
                  R$ {Number(product.price).toFixed(2)}
                </Badge>
                {/* Só o estado, nunca o número: a quantidade é interna. */}
                {!product.in_stock && (
                  <span className="text-[10px] text-destructive font-medium shrink-0">Esgotado</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
