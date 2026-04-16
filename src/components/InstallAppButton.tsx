import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, Smartphone, Share, MoreVertical, Plus } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function detectPlatform() {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

export function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);
  const platform = detectPlatform();

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferredPrompt(null);
    } else {
      setShowInstructions(true);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleClick}
        className="gap-2"
      >
        <Download className="w-4 h-4" />
        <span className="hidden sm:inline">Instalar App</span>
      </Button>

      <Dialog open={showInstructions} onOpenChange={setShowInstructions}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="w-5 h-5 text-gold" />
              Instalar BarbaFlow
            </DialogTitle>
            <DialogDescription>
              Adicione o BarbaFlow à tela inicial do seu celular para acesso
              rápido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            {platform === "ios" ? (
              <>
                <Step
                  number={1}
                  icon={<Share className="w-4 h-4" />}
                  text='Toque no botão "Compartilhar" na barra do Safari'
                />
                <Step
                  number={2}
                  icon={<Plus className="w-4 h-4" />}
                  text='Selecione "Adicionar à Tela de Início"'
                />
                <Step
                  number={3}
                  icon={<Download className="w-4 h-4" />}
                  text='Toque em "Adicionar" para confirmar'
                />
              </>
            ) : platform === "android" ? (
              <>
                <Step
                  number={1}
                  icon={<MoreVertical className="w-4 h-4" />}
                  text="Toque no menu ⋮ do Chrome"
                />
                <Step
                  number={2}
                  icon={<Plus className="w-4 h-4" />}
                  text='Selecione "Adicionar à tela inicial"'
                />
                <Step
                  number={3}
                  icon={<Download className="w-4 h-4" />}
                  text="Confirme a instalação"
                />
              </>
            ) : (
              <>
                <Step
                  number={1}
                  icon={<MoreVertical className="w-4 h-4" />}
                  text="Abra o menu do navegador"
                />
                <Step
                  number={2}
                  icon={<Download className="w-4 h-4" />}
                  text='Clique em "Instalar BarbaFlow"'
                />
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Step({
  number,
  icon,
  text,
}: {
  number: number;
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-7 h-7 rounded-full bg-gold/20 text-gold flex items-center justify-center shrink-0 text-sm font-bold">
        {number}
      </div>
      <div className="flex items-center gap-2 text-sm text-foreground">
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
}
