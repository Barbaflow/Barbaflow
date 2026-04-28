import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="relative z-10 border-t border-border px-6 py-8 md:px-12 mt-auto">
      <div className="max-w-6xl mx-auto flex flex-col gap-6 text-sm text-muted-foreground">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <span>© {new Date().getFullYear()} BarbaFlow. Todos os direitos reservados.</span>
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
            <Link to="/" className="hover:text-foreground transition-colors">Início</Link>
            <Link to="/sobre" className="hover:text-foreground transition-colors">Sobre</Link>
            <Link to="/contato" className="hover:text-foreground transition-colors">Contato</Link>
            <Link to="/upgrade" className="hover:text-foreground transition-colors">Planos</Link>
          </div>
        </div>
        <div className="flex flex-wrap justify-center md:justify-end gap-x-6 gap-y-2 border-t border-border pt-4">
          <Link to="/termos" className="hover:text-foreground transition-colors">Termos de Uso</Link>
          <Link to="/privacidade" className="hover:text-foreground transition-colors">Política de Privacidade</Link>
          <Link to="/reembolso" className="hover:text-foreground transition-colors">Política de Reembolso</Link>
        </div>
      </div>
    </footer>
  );
}
