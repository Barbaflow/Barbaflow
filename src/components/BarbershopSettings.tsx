import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePlan } from "@/hooks/use-plan";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, Palette, Check, Loader2, ImageIcon, Lock, Info, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

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
  const fileRef = useRef<HTMLInputElement>(null);

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
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
