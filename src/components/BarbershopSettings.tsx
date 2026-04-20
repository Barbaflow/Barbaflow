import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePlan } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Palette, Check, Loader2, ImageIcon, Lock, Info, ExternalLink, Copy, QrCode, Download, FileText, MessageCircle, CalendarClock } from "lucide-react";
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
  whatsapp_message: string | null;
  pdf_template: string | null;
  pdf_slogan: string | null;
  qr_size: string | null;
  reschedule_min_hours: number | null;
}

const DEFAULT_WA_TEMPLATE =
  "Olá! 💈 Agende seu horário na *{nome}* de forma rápida e fácil pelo link: {link}";

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
  const [pdfSlogan, setPdfSlogan] = useState("Agende seu horário online");
  const [pdfTemplate, setPdfTemplate] = useState<"minimal" | "colorful" | "vintage">("minimal");
  const [waMessage, setWaMessage] = useState(DEFAULT_WA_TEMPLATE);
  const [savingWa, setSavingWa] = useState(false);
  const [savingPrint, setSavingPrint] = useState(false);
  const [rescheduleMinHours, setRescheduleMinHours] = useState<number>(2);
  const [savingReschedule, setSavingReschedule] = useState(false);
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
      const qrDataUrl = canvas.toDataURL("image/png");
      const qrMm = currentSize.pdfMm;
      const qrX = (pageWidth - qrMm) / 2;
      const slogan = (pdfSlogan || "").trim() || "Agende seu horário online";

      if (pdfTemplate === "minimal") {
        // ===== MINIMALIST =====
        // Clean white, thin gold rule, refined typography
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, "F");

        // Top thin gold line
        pdf.setDrawColor(200, 169, 110);
        pdf.setLineWidth(0.4);
        pdf.line(30, 28, pageWidth - 30, 28);

        pdf.setTextColor(20, 20, 20);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(26);
        pdf.text(data.name.toUpperCase(), pageWidth / 2, 48, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(11);
        pdf.setTextColor(110, 110, 110);
        pdf.text(slogan, pageWidth / 2, 58, { align: "center", maxWidth: pageWidth - 40 });

        const qrY = 78;
        pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrMm, qrMm);

        pdf.setTextColor(40, 40, 40);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(13);
        pdf.text("Escaneie para agendar", pageWidth / 2, qrY + qrMm + 20, { align: "center" });

        pdf.setFont("helvetica", "italic");
        pdf.setFontSize(9);
        pdf.setTextColor(140, 140, 140);
        pdf.text(publicUrl, pageWidth / 2, qrY + qrMm + 30, { align: "center" });

        // Bottom thin gold line
        pdf.setDrawColor(200, 169, 110);
        pdf.setLineWidth(0.4);
        pdf.line(30, pageHeight - 28, pageWidth - 30, pageHeight - 28);
      } else if (pdfTemplate === "colorful") {
        // ===== COLORFUL =====
        // Vibrant gradient bands, bold colors using brand palette
        const [pr, pg, pb] = hexToRgb(primaryColor);
        const [sr, sg, sb] = hexToRgb(secondaryColor);

        // Background
        pdf.setFillColor(sr, sg, sb);
        pdf.rect(0, 0, pageWidth, pageHeight, "F");

        // Top color block
        pdf.setFillColor(pr, pg, pb);
        pdf.rect(0, 0, pageWidth, 50, "F");

        // Diagonal accent
        pdf.setFillColor(pr, pg, pb);
        pdf.triangle(0, 50, 80, 50, 0, 90, "F");

        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(32);
        pdf.text(data.name, pageWidth / 2, 30, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(13);
        pdf.text(slogan, pageWidth / 2, 42, { align: "center", maxWidth: pageWidth - 30 });

        const qrY = 90;
        // White card with shadow effect
        pdf.setFillColor(0, 0, 0);
        pdf.roundedRect(qrX - 9, qrY - 7, qrMm + 18, qrMm + 18, 6, 6, "F");
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(qrX - 10, qrY - 8, qrMm + 18, qrMm + 18, 6, 6, "F");
        pdf.addImage(qrDataUrl, "PNG", qrX - 1, qrY - 1, qrMm, qrMm);

        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text("AGENDE AGORA!", pageWidth / 2, qrY + qrMm + 25, { align: "center" });

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(11);
        pdf.text("Escaneie com a câmera do celular", pageWidth / 2, qrY + qrMm + 35, {
          align: "center",
        });

        // Bottom color band
        pdf.setFillColor(pr, pg, pb);
        pdf.rect(0, pageHeight - 25, pageWidth, 25, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "italic");
        pdf.setFontSize(10);
        pdf.text(publicUrl, pageWidth / 2, pageHeight - 10, { align: "center" });
      } else {
        // ===== VINTAGE =====
        // Cream paper, ornate borders, classic barbershop pole feel
        pdf.setFillColor(245, 235, 215); // cream
        pdf.rect(0, 0, pageWidth, pageHeight, "F");

        // Outer ornate border
        pdf.setDrawColor(80, 40, 20); // deep brown
        pdf.setLineWidth(2);
        pdf.rect(15, 15, pageWidth - 30, pageHeight - 30);
        pdf.setLineWidth(0.4);
        pdf.rect(20, 20, pageWidth - 40, pageHeight - 40);

        // Decorative top scroll
        pdf.setFontSize(20);
        pdf.setTextColor(80, 40, 20);
        pdf.setFont("times", "italic");
        pdf.text("~ ~ ~", pageWidth / 2, 38, { align: "center" });

        // Title
        pdf.setFont("times", "bold");
        pdf.setFontSize(32);
        pdf.setTextColor(60, 30, 15);
        pdf.text(data.name.toUpperCase(), pageWidth / 2, 58, { align: "center" });

        // Subtitle in italic
        pdf.setFont("times", "italic");
        pdf.setFontSize(14);
        pdf.setTextColor(120, 70, 30);
        pdf.text(`— ${slogan} —`, pageWidth / 2, 70, {
          align: "center",
          maxWidth: pageWidth - 50,
        });

        // EST. line (decorative)
        pdf.setFont("times", "normal");
        pdf.setFontSize(10);
        pdf.text("· BARBEARIA · TRADIÇÃO · ESTILO ·", pageWidth / 2, 80, { align: "center" });

        const qrY = 92;
        // Brown frame around QR
        pdf.setFillColor(60, 30, 15);
        pdf.rect(qrX - 6, qrY - 6, qrMm + 12, qrMm + 12, "F");
        pdf.setFillColor(255, 255, 255);
        pdf.rect(qrX - 3, qrY - 3, qrMm + 6, qrMm + 6, "F");
        pdf.addImage(qrDataUrl, "PNG", qrX, qrY, qrMm, qrMm);

        pdf.setFont("times", "bold");
        pdf.setFontSize(16);
        pdf.setTextColor(60, 30, 15);
        pdf.text("Escaneie & Agende", pageWidth / 2, qrY + qrMm + 22, { align: "center" });

        pdf.setFont("times", "italic");
        pdf.setFontSize(11);
        pdf.setTextColor(120, 70, 30);
        pdf.text(publicUrl, pageWidth / 2, qrY + qrMm + 32, { align: "center" });

        // Bottom decorative scroll
        pdf.setFont("times", "italic");
        pdf.setFontSize(20);
        pdf.setTextColor(80, 40, 20);
        pdf.text("~ ~ ~", pageWidth / 2, pageHeight - 30, { align: "center" });
      }

      pdf.save(`qrcode-${data.subdomain}-${pdfTemplate}.pdf`);
      toast.success("PDF baixado! Pronto para impressão A4.");
    } catch (err) {
      console.error(err);
      toast.error("Erro ao gerar PDF.");
    }
  };

  const hexToRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace("#", "");
    const full =
      clean.length === 3
        ? clean.split("").map((c) => c + c).join("")
        : clean.padEnd(6, "0").slice(0, 6);
    const num = parseInt(full, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  };


  useEffect(() => {
    supabase
      .from("barbershops")
      .select("*")
      .eq("id", barbershopId)
      .single()
      .then(({ data: shop }) => {
        if (shop) {
          const s = shop as BarbershopData;
          setData(s);
          setPrimaryColor(shop.primary_color);
          setSecondaryColor(shop.secondary_color);
          setLogoUrl(shop.logo_url);
          if (s.whatsapp_message) setWaMessage(s.whatsapp_message);
          if (s.pdf_template === "minimal" || s.pdf_template === "colorful" || s.pdf_template === "vintage") {
            setPdfTemplate(s.pdf_template);
          }
          if (s.pdf_slogan) setPdfSlogan(s.pdf_slogan);
          if (s.qr_size === "small" || s.qr_size === "medium" || s.qr_size === "large") {
            setQrSize(s.qr_size);
          }
          if (typeof s.reschedule_min_hours === "number") {
            setRescheduleMinHours(s.reschedule_min_hours);
          }
        }
      });
  }, [barbershopId]);

  const renderWaMessage = () => {
    const url = `${window.location.origin}/agendar/${data?.subdomain ?? ""}`;
    const template = (waMessage || "").trim() || DEFAULT_WA_TEMPLATE;
    return template.replace(/\{nome\}/gi, data?.name ?? "").replace(/\{link\}/gi, url);
  };

  const handleSaveWaMessage = async () => {
    if (!data) return;
    setSavingWa(true);
    const { error } = await supabase
      .from("barbershops")
      .update({ whatsapp_message: waMessage.trim() || null })
      .eq("id", barbershopId);
    if (error) {
      toast.error("Erro ao salvar mensagem.");
    } else {
      toast.success("Mensagem do WhatsApp salva!");
    }
    setSavingWa(false);
  };

  const handleSavePrintPrefs = async () => {
    setSavingPrint(true);
    const { error } = await supabase
      .from("barbershops")
      .update({
        pdf_template: pdfTemplate,
        pdf_slogan: pdfSlogan.trim() || null,
        qr_size: qrSize,
      })
      .eq("id", barbershopId);
    if (error) {
      toast.error("Erro ao salvar preferências.");
    } else {
      toast.success("Preferências de impressão salvas!");
    }
    setSavingPrint(false);
  };

  const handleSaveReschedule = async () => {
    setSavingReschedule(true);
    const { error } = await supabase
      .from("barbershops")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ reschedule_min_hours: rescheduleMinHours } as any)
      .eq("id", barbershopId);
    if (error) {
      toast.error("Erro ao salvar limite de reagendamento.");
    } else {
      toast.success("Limite de reagendamento salvo!");
    }
    setSavingReschedule(false);
  };

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
                  size={currentSize.canvas}
                  level="H"
                  includeMargin={false}
                  style={{
                    width: currentSize.preview,
                    height: currentSize.preview,
                  }}
                  imageSettings={
                    qrWithLogo && logoUrl
                      ? {
                          src: logoUrl,
                          height: currentSize.logo * (currentSize.canvas / currentSize.preview),
                          width: currentSize.logo * (currentSize.canvas / currentSize.preview),
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
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tamanho do QR Code</Label>
                <div className="flex gap-1.5 justify-center sm:justify-start">
                  {(["small", "medium", "large"] as const).map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={qrSize === s ? "gold" : "outline"}
                      onClick={() => setQrSize(s)}
                      className="flex-1 sm:flex-none"
                    >
                      {sizeMap[s].label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pdf-slogan" className="text-xs text-muted-foreground">
                  Slogan no PDF de impressão
                </Label>
                <Input
                  id="pdf-slogan"
                  value={pdfSlogan}
                  onChange={(e) => setPdfSlogan(e.target.value)}
                  placeholder="Ex: Agende já o seu corte!"
                  maxLength={80}
                  className="text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Template do cartaz PDF</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: "minimal", label: "Minimalista" },
                      { id: "colorful", label: "Colorido" },
                      { id: "vintage", label: "Vintage" },
                    ] as const
                  ).map((t) => {
                    const selected = pdfTemplate === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setPdfTemplate(t.id)}
                        className={`group flex flex-col items-center gap-1.5 rounded-lg border-2 p-1.5 transition-all ${
                          selected
                            ? "border-gold bg-gold/10"
                            : "border-border hover:border-gold/50"
                        }`}
                        aria-pressed={selected}
                      >
                        <TemplateThumbnail
                          template={t.id}
                          primaryColor={primaryColor}
                          secondaryColor={secondaryColor}
                        />
                        <span
                          className={`text-[11px] font-medium ${
                            selected ? "text-gold" : "text-foreground"
                          }`}
                        >
                          {t.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button variant="gold" onClick={handleDownloadQR} className="w-full sm:w-auto">
                  <Download className="w-4 h-4" />
                  Baixar PNG
                </Button>
                <Button variant="outline" onClick={handleDownloadPDF} className="w-full sm:w-auto">
                  <FileText className="w-4 h-4" />
                  Baixar PDF (A4)
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleSavePrintPrefs}
                  disabled={savingPrint}
                  className="w-full sm:w-auto"
                >
                  {savingPrint ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Salvar preferências
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp message */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-gold" />
            Mensagem do WhatsApp
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Personalize a mensagem que aparece quando você clica em "Compartilhar no WhatsApp".
            Use <code className="px-1 py-0.5 rounded bg-secondary text-gold">{"{nome}"}</code> para
            o nome da barbearia e{" "}
            <code className="px-1 py-0.5 rounded bg-secondary text-gold">{"{link}"}</code> para o
            link de agendamento.
          </p>
          <Textarea
            value={waMessage}
            onChange={(e) => setWaMessage(e.target.value)}
            placeholder={DEFAULT_WA_TEMPLATE}
            rows={4}
            maxLength={500}
            className="text-sm"
          />
          <div className="p-3 rounded-lg border border-border bg-secondary/50">
            <p className="text-xs text-muted-foreground mb-1">Pré-visualização:</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{renderWaMessage()}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handleSaveWaMessage}
              disabled={savingWa}
              variant="gold"
              className="w-full sm:w-auto"
            >
              {savingWa ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {savingWa ? "Salvando..." : "Salvar mensagem"}
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setWaMessage(DEFAULT_WA_TEMPLATE)}
            >
              Restaurar padrão
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reschedule limit */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-gold" />
            Limite para reagendamento do cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Quanto tempo de antecedência o cliente precisa ter para reagendar sozinho pelo app.
            Quando faltar menos do que isso para o horário, o botão "Reagendar" fica bloqueado e
            ele precisa entrar em contato com a barbearia.
          </p>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Antecedência mínima</Label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { v: 0, label: "Sem limite" },
                { v: 1, label: "1 hora" },
                { v: 2, label: "2 horas" },
                { v: 4, label: "4 horas" },
                { v: 12, label: "12 horas" },
                { v: 24, label: "24 horas" },
              ].map((opt) => {
                const selected = rescheduleMinHours === opt.v;
                return (
                  <Button
                    key={opt.v}
                    type="button"
                    size="sm"
                    variant={selected ? "gold" : "outline"}
                    onClick={() => setRescheduleMinHours(opt.v)}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="p-3 rounded-lg border border-border bg-secondary/50">
            <p className="text-xs text-muted-foreground mb-1">Como o cliente verá:</p>
            <p className="text-sm text-foreground">
              {rescheduleMinHours === 0
                ? "Reagendamento liberado a qualquer momento (até a hora do horário)."
                : `Reagendamento bloqueado quando faltar menos de ${rescheduleMinHours}h para o atendimento.`}
            </p>
          </div>

          <Button
            onClick={handleSaveReschedule}
            disabled={savingReschedule}
            variant="gold"
            className="w-full sm:w-auto"
          >
            {savingReschedule ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {savingReschedule ? "Salvando..." : "Salvar limite"}
          </Button>
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
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => {
                const message = renderWaMessage();
                const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
                window.open(waUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <MessageCircle className="w-4 h-4" />
              Compartilhar no WhatsApp
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TemplateThumbnail({
  template,
  primaryColor,
  secondaryColor,
}: {
  template: "minimal" | "colorful" | "vintage";
  primaryColor: string;
  secondaryColor: string;
}) {
  // SVG miniature of an A4 portrait page (ratio ~1:1.41)
  const w = 70;
  const h = 99;

  if (template === "minimal") {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="rounded shadow-sm">
        <rect width={w} height={h} fill="#ffffff" />
        <line x1="10" y1="14" x2={w - 10} y2="14" stroke="#C8A96E" strokeWidth="0.4" />
        <rect x="14" y="22" width={w - 28} height="3" fill="#1a1a1a" rx="0.5" />
        <rect x="20" y="28" width={w - 40} height="1.5" fill="#999" rx="0.5" />
        {/* QR placeholder */}
        <rect x={w / 2 - 14} y="38" width="28" height="28" fill="#1a1a1a" />
        <rect x={w / 2 - 11} y="41" width="22" height="22" fill="#fff" />
        <rect x={w / 2 - 8} y="44" width="16" height="16" fill="#1a1a1a" />
        <rect x={w / 2 - 5} y="47" width="10" height="10" fill="#fff" />
        <rect x="20" y="72" width={w - 40} height="1.5" fill="#666" rx="0.5" />
        <line x1="10" y1={h - 14} x2={w - 10} y2={h - 14} stroke="#C8A96E" strokeWidth="0.4" />
      </svg>
    );
  }

  if (template === "colorful") {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="rounded shadow-sm">
        <rect width={w} height={h} fill={secondaryColor} />
        <rect width={w} height="22" fill={primaryColor} />
        <polygon points={`0,22 26,22 0,38`} fill={primaryColor} />
        <rect x="12" y="9" width={w - 24} height="3" fill="#fff" rx="0.5" />
        <rect x="20" y="15" width={w - 40} height="1.5" fill="#fff" opacity="0.8" rx="0.5" />
        {/* QR card with shadow */}
        <rect x={w / 2 - 15} y="44" width="30" height="30" fill="#000" opacity="0.3" rx="2" />
        <rect x={w / 2 - 16} y="43" width="30" height="30" fill="#fff" rx="2" />
        <rect x={w / 2 - 13} y="46" width="24" height="24" fill="#1a1a1a" />
        <rect x={w / 2 - 10} y="49" width="18" height="18" fill="#fff" />
        <rect x={w / 2 - 7} y="52" width="12" height="12" fill="#1a1a1a" />
        <rect x="14" y="80" width={w - 28} height="2.5" fill="#fff" rx="0.5" />
        <rect x={0} y={h - 10} width={w} height="10" fill={primaryColor} />
      </svg>
    );
  }

  // vintage
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="rounded shadow-sm">
      <rect width={w} height={h} fill="#f5ebd7" />
      <rect
        x="5"
        y="5"
        width={w - 10}
        height={h - 10}
        fill="none"
        stroke="#502814"
        strokeWidth="0.7"
      />
      <rect
        x="7.5"
        y="7.5"
        width={w - 15}
        height={h - 15}
        fill="none"
        stroke="#502814"
        strokeWidth="0.2"
      />
      <text
        x={w / 2}
        y="18"
        textAnchor="middle"
        fontSize="5"
        fill="#502814"
        fontFamily="serif"
        fontStyle="italic"
      >
        ~ ~ ~
      </text>
      <rect x="14" y="22" width={w - 28} height="3.5" fill="#3c1e0f" rx="0.3" />
      <rect x="20" y="29" width={w - 40} height="1.5" fill="#78461e" rx="0.3" />
      <rect x="22" y="33" width={w - 44} height="1" fill="#78461e" opacity="0.7" rx="0.3" />
      {/* Framed QR */}
      <rect x={w / 2 - 15} y="40" width="30" height="30" fill="#3c1e0f" />
      <rect x={w / 2 - 13} y="42" width="26" height="26" fill="#fff" />
      <rect x={w / 2 - 11} y="44" width="22" height="22" fill="#1a1a1a" />
      <rect x={w / 2 - 8} y="47" width="16" height="16" fill="#fff" />
      <rect x={w / 2 - 5} y="50" width="10" height="10" fill="#1a1a1a" />
      <rect x="20" y="76" width={w - 40} height="1.5" fill="#3c1e0f" rx="0.3" />
      <text
        x={w / 2}
        y={h - 8}
        textAnchor="middle"
        fontSize="5"
        fill="#502814"
        fontFamily="serif"
        fontStyle="italic"
      >
        ~ ~ ~
      </text>
    </svg>
  );
}
