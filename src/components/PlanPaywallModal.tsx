import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, ArrowUpRight } from "lucide-react";

interface PlanPaywallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlanPaywallModal({ open, onOpenChange }: PlanPaywallModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Crown className="w-6 h-6 text-primary" />
          </div>
          <DialogTitle className="text-center font-display">
            Limite de agendamentos atingido
          </DialogTitle>
          <DialogDescription className="text-center">
            Você atingiu o limite de 50 agendamentos do plano Free este mês.
            Faça upgrade para continuar atendendo seus clientes sem interrupções.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-4">
          <Link to="/upgrade" className="block">
            <Button className="w-full bg-primary text-primary-foreground" size="lg">
              <ArrowUpRight className="w-4 h-4 mr-2" />
              Ver planos e fazer upgrade
            </Button>
          </Link>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={() => onOpenChange(false)}
          >
            Continuar no plano Free
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
