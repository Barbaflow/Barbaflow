import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, DollarSign } from "lucide-react";

interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock_quantity: number;
  image_url: string | null;
}

interface ProductsShowcaseProps {
  barbershopId: string;
}

export function ProductsShowcase({ barbershopId }: ProductsShowcaseProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("products")
      .select("id, name, description, price, stock_quantity, image_url")
      .eq("barbershop_id", barbershopId)
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        setProducts(data || []);
        setLoading(false);
      });
  }, [barbershopId]);

  if (loading) {
    return (
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-48 rounded-xl bg-card border border-border animate-pulse" />
        ))}
      </div>
    );
  }

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
            className="bg-card border-border hover:border-primary/40 transition-colors group overflow-hidden"
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
              <div className="flex items-center justify-between pt-1">
                <Badge variant="outline" className="border-primary/40 text-primary text-xs">
                  <DollarSign className="w-3 h-3" />
                  R$ {Number(product.price).toFixed(2)}
                </Badge>
                {product.stock_quantity <= 0 && (
                  <span className="text-[10px] text-destructive font-medium">Esgotado</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
