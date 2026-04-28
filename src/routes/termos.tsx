import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Scissors, ArrowLeft } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — BarbaFlow" },
      { name: "description", content: "Termos e condições de uso da plataforma BarbaFlow para barbearias e clientes." },
      { property: "og:title", content: "Termos de Uso — BarbaFlow" },
      { property: "og:description", content: "Termos e condições de uso da plataforma BarbaFlow." },
    ],
    links: [{ rel: "canonical", href: "https://barbaflow.pro/termos" }],
  }),
  component: TermosPage,
});

function TermosPage() {
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
        <article className="max-w-3xl mx-auto prose prose-invert">
          <h1 className="font-display text-4xl md:text-5xl text-foreground mb-2">Termos de Uso</h1>
          <p className="text-sm text-muted-foreground mb-8">Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>

          <div className="space-y-6 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">1. Identificação do Vendedor</h2>
              <p>Estes Termos regem o uso da plataforma <strong>BarbaFlow</strong> ("Serviço"), operada por <strong>NETS OPERAÇÕES E SUPORTE EM TI LTDA</strong>, inscrita no CNPJ sob nº <strong>29.068.773/0001-91</strong> ("BarbaFlow", "nós", "nosso"). Ao usar o Serviço, você ("Usuário") celebra um contrato com a NETS OPERAÇÕES E SUPORTE EM TI LTDA.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">2. Aceitação</h2>
              <p>Ao criar uma conta, acessar ou continuar usando o Serviço, você declara ter lido, compreendido e concordado integralmente com estes Termos. Se não concorda, não utilize o Serviço.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">3. Descrição do Serviço</h2>
              <p>O BarbaFlow é uma plataforma SaaS de agendamento online e gestão para barbearias, incluindo agenda, equipe, serviços, ficha de atendimento (comanda) e relatórios.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">4. Conta e Credenciais</h2>
              <p>Você é responsável por manter a confidencialidade de suas credenciais e por toda atividade realizada em sua conta. Deve fornecer informações verdadeiras, precisas e atualizadas.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">5. Uso Aceitável</h2>
              <p>Você se compromete a não: (a) usar o Serviço de forma ilícita; (b) cometer fraude ou enviar spam; (c) violar direitos de propriedade intelectual; (d) interferir na segurança do Serviço (malware, sondagem, scraping); (e) revender ou redistribuir o Serviço sem autorização; (f) realizar engenharia reversa ou contornar limites técnicos.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">6. Propriedade Intelectual</h2>
              <p>Todos os direitos sobre o Serviço, software, marca, design e documentação pertencem ao BarbaFlow. Concedemos a você uma licença limitada, não exclusiva e intransferível para usar o Serviço dentro do plano contratado.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">7. Pagamentos, Assinaturas e Faturamento</h2>
              <p>Os pagamentos, faturamento, impostos, cancelamentos e reembolsos do Serviço são processados pelo nosso revendedor autorizado, conforme os <a href="https://www.paddle.com/legal/checkout-buyer-terms" target="_blank" rel="noopener noreferrer" className="text-gold underline">Termos do Comprador da Paddle</a>. As assinaturas são renovadas automaticamente conforme o ciclo escolhido (mensal ou anual) até cancelamento.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">8. Paddle como Merchant of Record</h2>
              <p><strong>O processamento dos pedidos é realizado por nosso revendedor online, Paddle.com. A Paddle.com é o Merchant of Record (vendedor oficial) de todos os nossos pedidos. A Paddle responde pelas consultas de atendimento ao cliente relacionadas a pagamentos e processa devoluções.</strong></p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">9. Reembolso</h2>
              <p>Oferecemos garantia de reembolso conforme nossa <Link to="/reembolso" className="text-gold underline">Política de Reembolso</Link>.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">10. Conteúdo do Usuário</h2>
              <p>Você mantém a propriedade do conteúdo que insere (cadastros, fotos, dados de clientes). Concede ao BarbaFlow uma licença limitada para hospedar e processar esse conteúdo exclusivamente para prestar o Serviço.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">11. Disponibilidade</h2>
              <p>Empenhamo-nos para manter o Serviço disponível, mas não garantimos operação ininterrupta ou livre de erros. Podemos realizar manutenções programadas.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">12. Suspensão e Encerramento</h2>
              <p>Podemos suspender ou encerrar o acesso em caso de: (a) violação material destes Termos; (b) inadimplência; (c) risco de fraude ou segurança; (d) violações graves ou reiteradas de políticas. Você pode encerrar sua conta a qualquer momento.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">13. Garantias e Limitação de Responsabilidade</h2>
              <p>O Serviço é fornecido "no estado em que se encontra". Na máxima extensão permitida em lei, excluímos garantias implícitas. Nossa responsabilidade total agregada limita-se aos valores pagos por você nos 12 meses anteriores ao evento. Não respondemos por danos indiretos, lucros cessantes ou perda de dados.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">14. Indenização</h2>
              <p>Você concorda em indenizar o BarbaFlow por reclamações decorrentes de seu conteúdo, uso indevido ou violação destes Termos.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">15. Lei Aplicável</h2>
              <p>Estes Termos são regidos pelas leis do Brasil. Fica eleito o foro da comarca do domicílio do BarbaFlow para dirimir controvérsias.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">16. Alterações</h2>
              <p>Podemos atualizar estes Termos. Mudanças relevantes serão comunicadas com antecedência razoável. O uso contínuo após a vigência implica aceitação.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">17. Contato</h2>
              <p>Dúvidas sobre estes Termos: <Link to="/contato" className="text-gold underline">página de contato</Link>.</p>
            </section>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
