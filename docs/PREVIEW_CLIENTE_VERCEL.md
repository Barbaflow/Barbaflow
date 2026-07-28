# Preview do cliente na Vercel — branch `preview/cliente-vercel`

> ⛔ **Esta branch NÃO deve ser mesclada na `main`, em hipótese alguma.**
> Ela existe para uma finalidade única: dar ao cliente uma URL de Preview que
> funcione contra o schema que o Supabase remoto tem **hoje**. Nada aqui é
> melhoria de produto; é compatibilidade temporária.

## O que ela é

`preview/cliente-vercel` = `chore/vercel-nitro` (migração do build Cloudflare →
Nitro/Vercel) **+ a reversão da frente de catálogo público**.

A migração Nitro é permanente e deve seguir para a `main` pelo seu próprio PR
(`chore/vercel-nitro`). A reversão do catálogo é descartável e morre com o
Preview.

## Por que o catálogo foi revertido

A `main` já contém a frente de catálogo público (PR #29): `ProductsShowcase`
passou a consumir a RPC `get_public_products` em vez de ler `products` direto.

Só que a migration `20260727120000_public_product_catalog.sql`, que **cria** essa
função, ainda não foi aplicada no projeto remoto `qfcngyyzyiwotehubifx`. Nesse
estado o PostgREST responde `PGRST202` (função inexistente) e a vitrine de
produtos da página pública exibe *"Não foi possível carregar os produtos"* — não
há fallback para a tabela.

Reverter o merge do PR #29 devolve o fluxo anterior (`supabase.from("products")`),
que é exatamente o que o schema remoto atual suporta.

**O caminho correto — e definitivo — é aplicar a migration no remoto.** A
reversão é o atalho enquanto isso não acontece.

## Consequência de segurança que continua valendo

Enquanto a migration não for aplicada, **a exposição pública antiga de `products`
permanece**, tanto nesta branch quanto no banco:

- `GRANT SELECT ... TO anon` (migration `20260721140000`) mais a policy
  "Anyone can view products of approved barbershops" (`20260416141800`) deixam
  qualquer visitante anônimo ler a tabela direto no PostgREST;
- RLS filtra **linhas**, não **colunas** — `stock_quantity` (o estoque exato) é
  legível por qualquer um;
- a policy não filtra `active`, então produtos inativos/descontinuados também
  são legíveis. O `.eq("active", true)` do frontend é filtro de exibição, não
  controle de acesso.

Isso **não é uma regressão introduzida por esta branch**: é o estado em que o
banco remoto já está. A reversão apenas alinha o frontend a ele. A correção é a
fase 1 da migration `20260727120000` (aditiva) seguida da fase 2 (descrita no
rodapé daquele arquivo, ainda não versionada de propósito).

## Ambiente

- Projeto Supabase: `qfcngyyzyiwotehubifx` — **homologação**, compartilhado com
  o desenvolvimento.
- 🔶 **O cliente não deve inserir dados reais.** Tudo que ele criar, editar ou
  apagar altera esse banco de verdade, é visível para a equipe e pode ser
  removido sem aviso por um seed ou cleanup.
- Sem Docker e sem Supabase local — o fluxo é remote-first
  (ver [DESENVOLVIMENTO_REMOTO.md](./DESENVOLVIMENTO_REMOTO.md)).

## Como encerrar

Quando a migration `20260727120000` for aplicada no remoto:

1. apagar `preview/cliente-vercel` (local e remota);
2. apontar o Preview para uma branch derivada da `main` já com o catálogo;
3. apagar este arquivo junto com a branch.
