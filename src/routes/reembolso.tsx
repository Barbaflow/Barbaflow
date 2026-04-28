import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Scissors, ArrowLeft } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/reembolso")({
  head: () => ({
    meta: [
      { title: "Política de Reembolso — BarbaFlow" },
      { name: "description", content: "Garantia de reembolso de 30 dias do BarbaFlow. Saiba como solicitar." },
      { property: "og:title", content: "Política de Reembolso — BarbaFlow" },
      { property: "og:description", content: "Garantia de reembolso de 30 dias do BarbaFlow." },
    ],
    links: [{ rel: "canonical", href: "https://barbaflow.pro/reembolso" }],
  }),
  component: ReembolsoPage,
});

function ReembolsoPage() {
  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      <nav aria-label="Navegação principal" className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-gold flex items-center justify-center shadow-gold">
            <Scissors className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl text-foreground">BarbaFlow</span>
        </Link>
        <Link to="/">
          <Button variant="ghost" size="sm"><ArrowLeft className="w-4 h-4" /> Voltar</Button>
        </Link>
      </nav>

      <main role="main" className="relative z-10 flex-1 px-6 py-12 md:px-12">
        <article className="max-w-3xl mx-auto">
          <h1 className="font-display text-4xl md:text-5xl text-foreground mb-2">Política de Reembolso</h1>
          <p className="text-sm text-muted-foreground mb-8">Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>

          <div className="space-y-6 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">Garantia de 30 dias</h2>
              <p>O <strong>BarbaFlow</strong> oferece uma <strong>garantia de reembolso de 30 dias</strong>. Se você não estiver satisfeito com sua assinatura, pode solicitar o reembolso integral em até <strong>30 dias</strong> a partir da data da compra.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">Como solicitar</h2>
              <p>Os reembolsos são processados pelo nosso processador de pagamentos, a Paddle. Para solicitar:</p>
              <ol className="list-decimal pl-6 space-y-1">
                <li>Acesse <a href="https://paddle.net" target="_blank" rel="noopener noreferrer" className="text-gold underline">paddle.net</a> e localize sua compra pelo e-mail usado no pagamento; ou</li>
                <li>Entre em contato pela nossa <Link to="/contato" className="text-gold underline">página de contato</Link> que encaminharemos sua solicitação.</li>
              </ol>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">Prazo de processamento</h2>
              <p>Após aprovado, o reembolso é processado pela Paddle em até 5 a 10 dias úteis, dependendo do método de pagamento utilizado.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">Renovações de assinatura</h2>
              <p>Você pode cancelar sua assinatura a qualquer momento para evitar a próxima cobrança. Cobranças de renovação podem ser reembolsadas se solicitadas dentro de 30 dias da data da renovação.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">Cancelamento</h2>
              <p>O cancelamento da assinatura encerra a renovação automática. Você mantém o acesso ao plano contratado até o final do período já pago.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">Dúvidas</h2>
              <p>Estamos à disposição para esclarecer qualquer dúvida sobre reembolsos pela <Link to="/contato" className="text-gold underline">página de contato</Link>.</p>
            </section>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
