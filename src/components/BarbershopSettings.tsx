import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePlan } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Palette, Check, Loader2, ImageIcon, Lock, Info, ExternalLink, Copy, QrCode, Download, FileText } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { QRCodeCanvas } from "qrcode.react";
import jsPDF from "jspdf";

interface BarbershopData {
  id: string;
  name: string;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  subdomain: string;
}

export function BarbershopSettings({ barbershopId }: { barbershopId: string }) {
  const { user } = useAuth();
  const { planName, loading: planLoading } = usePlan();
  const isFree = planName === "free";
  const [data, setData] = useState<BarbershopData | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#C8A96E");
  const [secondaryColor, setSecondaryColor] = useState("#1A1A2E");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [qrWithLogo, setQrWithLogo] = useState(true);
  const [qrSize, setQrSize] = useState<"small" | "medium" | "large">("medium");
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  const sizeMap = {
    small: { canvas: 320, preview: 120, logo: 28, pdfMm: 80, label: "Pequeno" },
    medium: { canvas: 480, preview: 160, logo: 36, pdfMm: 110, label: "Médio" },
    large: { canvas: 720, preview: 200, logo: 44, pdfMm: 150, label: "Grande" },
  } as const;
  const currentSize = sizeMap[qrSize];

  const publicUrl =
    typeof window !== "undefined" && data
      ? `${window.location.origin}/agendar/${data.subdomain}`
      : "";

  const handleDownloadQR = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas || !data) return;
    const link = document.createElement("a");
    link.download = `qrcode-${data.subdomain}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast.success("QR Code baixado!");
  };

  const handleDownloadPDF = () => {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas || !data) return;

    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = 210;
      const pageHeight = 297;

      // Background accent bar (top)
      pdf.setFillColor(26, 26, 46); // secondary dark
      pdf.rect(0, 0, pageWidth, 18, "F");

      // Brand title
      pdf.setTextColor(200, 169, 110); // gold
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(28);
      pdf.text(data.name, pageWidth / 2, 50, { align: "center" });

      // Subtitle
      pdf.setTextColor(60, 60, 60);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(14);
      pdf.text("Agende seu horário online", pageWidth / 2, 62, { align: "center" });

      // QR Code (centered)
      const qrDataUrl = canvas.toDataURL("image/png");
      const qrMm = currentSize.pdfMm;
      const qrX = (pageWidth - qrMm) / 2;
      const qrY = 78;

      // White card behind QR
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(200, 169, 110);
      pdf.setLineWidth(1);
      pdf.roundedRect(qrX - 8, qrY - 8, qrMm + 16, qrMm + 16, 4, 4, "FD");
      pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrMm, qrMm);

      // Instructions
      pdf.setTextColor(40, 40, 40);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Escaneie com a câmera do celular", pageWidth / 2, qrY + qrMm + 28, {
        align: "center",
      });

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(12);
      pdf.setTextColor(90, 90, 90);
      pdf.text(
        "Aponte a câmera para o código acima e toque no link que aparecer",
        pageWidth / 2,
        qrY + qrMm + 38,
        { align: "center" }
      );

      // URL footer
      pdf.setFont("helvetica", "italic");
      pdf.setFontSize(10);
      pdf.setTextColor(120, 120, 120);
      pdf.text(publicUrl, pageWidth / 2, qrY + qrMm + 50, { align: "center" });

      // Bottom accent bar
      pdf.setFillColor(200, 169, 110);
      pdf.rect(0, pageHeight - 8, pageWidth, 8, "F");

      pdf.save(`qrcode-${data.subdomain}.pdf`);
      toast.success("PDF baixado! Pronto para impressão A4.");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar PDF.");
    }
  };

  useEffect(() => {
    supabase
      .from("barbershops")
      .select("*")
      .eq("id", barbershopId)
      .single()
      .then(({ data: shop }) => {
        if (shop) {
          setData(shop);
          setPrimaryColor(shop.primary_color);
          setSecondaryColor(shop.secondary_color);
          setLogoUrl(shop.logo_url);
        }
      });
  }, [barbershopId]);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo deve ter no máximo 2MB.");
      return;
    }

    if (!file.type.startsWith("image/")) {
      toast.error("Apenas imagens são permitidas.");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${barbershopId}/logo.${ext}`;

    const { error } = await supabase.storage
      .from("logos")
      .upload(path, file, { upsert: true });

    if (error) {
      toast.error("Erro ao fazer upload do logo.");
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("logos").getPublicUrl(path);
    const newUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    setLogoUrl(newUrl);

    await supabase
      .from("barbershops")
      .update({ logo_url: newUrl })
      .eq("id", barbershopId);

    toast.success("Logo atualizado!");
    setUploading(false);
  };

  const handleSaveColors = async () => {
    if (!data) return;
    setSaving(true);

    const { error } = await supabase
      .from("barbershops")
      .update({ primary_color: primaryColor, secondary_color: secondaryColor })
      .eq("id", barbershopId);

    if (error) {
      toast.error("Erro ao salvar cores.");
    } else {
      toast.success("Cores atualizadas! Recarregue para ver as mudanças.");
    }
    setSaving(false);
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gold" />
      </div>
    );
  }

  if (isFree) {
    return (
      <Card className="border-border bg-card relative overflow-hidden">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <Lock className="w-10 h-10 text-gold" />
          <h3 className="font-display text-lg font-bold text-foreground">
            Personalização disponível no plano Pro
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Faça upgrade para personalizar o logo e as cores da sua barbearia.
          </p>
          <Link to="/upgrade">
            <Button variant="gold" size="sm">
              Fazer Upgrade
            </Button>
          </Link>
        </div>
        <CardContent className="p-6 opacity-40 pointer-events-none">
          <div className="flex items-center gap-6 mb-6">
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center bg-secondary">
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <Button variant="outline" size="sm" disabled>
                <Upload className="w-4 h-4" /> Enviar logo
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-10 rounded bg-secondary" />
            <div className="h-10 rounded bg-secondary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Logo Upload */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-gold" />
            Logo da Barbearia
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-secondary">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={`Logo ${data.name}`}
                  className="w-full h-full object-contain"
                />
              ) : (
                <ImageIcon className="w-8 h-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {uploading ? "Enviando..." : "Enviar logo"}
              </Button>
              <p className="text-xs text-muted-foreground">PNG, JPG ou SVG. Máx 2MB.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* QR Code */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <QrCode className="w-5 h-5 text-gold" />
            QR Code da página pública
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div
              ref={qrRef}
              className="p-3 bg-white rounded-lg border border-border shrink-0"
            >
              {publicUrl && (
                <QRCodeCanvas
                  value={publicUrl}
                  size={160}
                  level="H"
                  includeMargin={false}
                  imageSettings={
                    qrWithLogo && logoUrl
                      ? {
                          src: logoUrl,
                          height: 36,
                          width: 36,
                          excavate: true,
                          crossOrigin: "anonymous",
                        }
                      : undefined
                  }
                />
              )}
            </div>
            <div className="flex-1 space-y-3 text-center sm:text-left">
              <p className="text-sm text-muted-foreground">
                Imprima e coloque no balcão da sua barbearia. Os clientes escaneiam
                com a câmera do celular e abrem direto a página de agendamento.
              </p>
              {logoUrl && (
                <div className="flex items-center justify-center sm:justify-start gap-2">
                  <Switch
                    id="qr-logo"
                    checked={qrWithLogo}
                    onCheckedChange={setQrWithLogo}
                  />
                  <Label htmlFor="qr-logo" className="text-sm cursor-pointer">
                    Incluir logo no centro
                  </Label>
                </div>
              )}
              {!logoUrl && (
                <p className="text-xs text-muted-foreground italic">
                  Envie um logo acima para incluí-lo no centro do QR Code.
                </p>
              )}
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button variant="gold" onClick={handleDownloadQR} className="w-full sm:w-auto">
                  <Download className="w-4 h-4" />
                  Baixar PNG
                </Button>
                <Button variant="outline" onClick={handleDownloadPDF} className="w-full sm:w-auto">
                  <FileText className="w-4 h-4" />
                  Baixar PDF (A4)
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Color Picker */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Palette className="w-5 h-5 text-gold" />
            Cores do Branding
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-2 p-3 rounded-lg border border-gold/30 bg-gold/5">
            <Info className="w-4 h-4 text-gold shrink-0 mt-0.5" />
            <p className="text-xs text-foreground">
              As cores personalizadas são aplicadas na sua página pública de agendamento apenas para barbearias nos planos <strong>Pro</strong> e <strong>Enterprise</strong>. Clientes do plano Free verão o tema padrão.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="primary" className="text-sm text-foreground">
                Cor Primária
              </Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  id="primary"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#C8A96E"
                  className="font-mono text-sm uppercase"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="secondary" className="text-sm text-foreground">
                Cor Secundária
              </Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  id="secondary"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                />
                <Input
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  placeholder="#1A1A2E"
                  className="font-mono text-sm uppercase"
                  maxLength={7}
                />
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="p-4 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground mb-3">Pré-visualização</p>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ backgroundColor: primaryColor, color: secondaryColor }}
              >
                {data.name.charAt(0)}
              </div>
              <span className="font-display text-lg" style={{ color: primaryColor }}>
                {data.name}
              </span>
            </div>
            <div className="flex gap-2 mt-3">
              <div
                className="px-4 py-2 rounded-md text-sm font-medium"
                style={{ backgroundColor: primaryColor, color: secondaryColor }}
              >
                Agendar
              </div>
              <div
                className="px-4 py-2 rounded-md text-sm font-medium border"
                style={{ borderColor: primaryColor, color: primaryColor }}
              >
                Ver Serviços
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleSaveColors}
              disabled={saving}
              variant="gold"
              className="w-full sm:w-auto"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {saving ? "Salvando..." : "Salvar Cores"}
            </Button>
            <a
              href={`/agendar/${data.subdomain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <Button variant="outline" className="w-full sm:w-auto">
                <ExternalLink className="w-4 h-4" />
                Ver minha página pública
              </Button>
            </a>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                const url = `${window.location.origin}/agendar/${data.subdomain}`;
                navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success("Link copiado!"))
                  .catch(() => toast.error("Não foi possível copiar o link."));
              }}
            >
              <Copy className="w-4 h-4" />
              Copiar link
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
