import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Scissors, ArrowLeft } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — BarbaFlow" },
      { name: "description", content: "Como o BarbaFlow coleta, usa e protege seus dados pessoais. Conformidade com LGPD." },
      { property: "og:title", content: "Política de Privacidade — BarbaFlow" },
      { property: "og:description", content: "Como o BarbaFlow coleta, usa e protege seus dados pessoais." },
    ],
    links: [{ rel: "canonical", href: "https://barbaflow.pro/privacidade" }],
  }),
  component: PrivacidadePage,
});

function PrivacidadePage() {
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
          <h1 className="font-display text-4xl md:text-5xl text-foreground mb-2">Política de Privacidade</h1>
          <p className="text-sm text-muted-foreground mb-8">Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>

          <div className="space-y-6 text-muted-foreground leading-relaxed">
            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">1. Controlador de Dados</h2>
              <p>O <strong>BarbaFlow</strong> ("nós") atua como <strong>controlador</strong> dos dados pessoais coletados por meio da plataforma. Esta Política descreve como tratamos suas informações em conformidade com a LGPD (Lei 13.709/2018) e o GDPR, quando aplicável.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">2. Categorias de Dados Coletados</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Dados de cadastro:</strong> nome, e-mail, telefone, senha (criptografada).</li>
                <li><strong>Dados da barbearia:</strong> razão social, endereço, CEP, logotipo, horários, serviços, preços.</li>
                <li><strong>Dados de clientes finais:</strong> nome, telefone e histórico de agendamentos (inseridos pelo lojista).</li>
                <li><strong>Dados de uso:</strong> logs de acesso, endereço IP, dispositivo, navegador, páginas visitadas.</li>
                <li><strong>Mensagens de suporte:</strong> conteúdo enviado via formulário de contato.</li>
                <li><strong>Dados de pagamento:</strong> coletados e processados diretamente pela Paddle (não armazenamos cartões).</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">3. Finalidades do Tratamento</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li>Criar e manter sua conta e a operação da barbearia.</li>
                <li>Prestar o serviço de agendamento, comanda e relatórios.</li>
                <li>Processar assinaturas e cobranças (via Paddle).</li>
                <li>Prevenir fraudes e garantir segurança.</li>
                <li>Atender solicitações de suporte.</li>
                <li>Melhorar o produto (analytics agregado).</li>
                <li>Enviar comunicações transacionais e, mediante consentimento, marketing.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">4. Bases Legais</h2>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Execução de contrato:</strong> prestação do Serviço.</li>
                <li><strong>Legítimo interesse:</strong> segurança, prevenção de fraude e melhoria do produto.</li>
                <li><strong>Cumprimento de obrigação legal:</strong> retenção fiscal e atendimento a autoridades.</li>
                <li><strong>Consentimento:</strong> marketing e cookies não essenciais.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">5. Compartilhamento de Dados</h2>
              <p>Compartilhamos dados apenas com:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Provedores de infraestrutura</strong> (hospedagem em nuvem, banco de dados, e-mail transacional).</li>
                <li><strong>Paddle.com</strong> — nosso Merchant of Record, responsável pelo processamento de pagamentos, gestão de assinaturas, faturamento e conformidade fiscal.</li>
                <li><strong>Ferramentas de analytics e suporte</strong> sob acordos de confidencialidade.</li>
                <li><strong>Assessores profissionais</strong> (jurídico, contábil) quando necessário.</li>
                <li><strong>Autoridades competentes</strong> mediante exigência legal.</li>
              </ul>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">6. Retenção</h2>
              <p>Mantemos seus dados enquanto sua conta estiver ativa e pelo período necessário para cumprir obrigações legais e fiscais. Após esse prazo, os dados são excluídos ou anonimizados.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">7. Direitos do Titular</h2>
              <p>Você tem direito a: confirmação da existência de tratamento; acesso; correção; anonimização, bloqueio ou eliminação; portabilidade; informação sobre compartilhamento; revogação do consentimento; oposição. Para exercê-los, fale conosco pela <Link to="/contato" className="text-gold underline">página de contato</Link>. Responderemos em até 15 dias.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">8. Segurança</h2>
              <p>Adotamos medidas técnicas e organizacionais apropriadas para proteger seus dados, incluindo criptografia em trânsito (HTTPS), criptografia de senhas, controles de acesso baseados em papéis e políticas de Row-Level Security no banco de dados.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">9. Cookies</h2>
              <p>Utilizamos cookies essenciais (autenticação e funcionamento) e, mediante consentimento, cookies de analytics. Você pode gerenciar cookies pelas configurações do seu navegador.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">10. Transferências Internacionais</h2>
              <p>Alguns provedores podem armazenar dados fora do Brasil. Nesses casos, garantimos salvaguardas adequadas (cláusulas contratuais padrão ou decisões de adequação).</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">11. Alterações</h2>
              <p>Esta Política pode ser atualizada. Mudanças relevantes serão comunicadas pelo Serviço ou por e-mail.</p>
            </section>

            <section>
              <h2 className="font-display text-2xl text-foreground mb-2">12. Contato</h2>
              <p>Para questões sobre privacidade, fale com nosso encarregado pela <Link to="/contato" className="text-gold underline">página de contato</Link>.</p>
            </section>
          </div>
        </article>
      </main>

      <SiteFooter />
    </div>
  );
}
