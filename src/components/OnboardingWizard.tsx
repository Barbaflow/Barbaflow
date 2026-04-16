import { useState, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Scissors,
  Upload,
  Palette,
  Globe,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ImageIcon,
  Check,
} from "lucide-react";
import { toast } from "sonner";

const STEPS = ["Barbearia", "Branding", "Revisão"] as const;

export function OnboardingWizard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#C8A96E");
  const [secondaryColor, setSecondaryColor] = useState("#1A1A2E");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const subdomainSlug = subdomain
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 30);

  const canAdvance = () => {
    if (step === 0) return name.trim().length >= 2 && subdomainSlug.length >= 3;
    return true;
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo deve ter no máximo 2MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Apenas imagens são permitidas.");
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async () => {
    if (!user) return;
    setSubmitting(true);

    try {
      // 1. Check subdomain availability
      const { data: existing } = await supabase
        .from("barbershops")
        .select("id")
        .eq("subdomain", subdomainSlug)
        .maybeSingle();

      if (existing) {
        toast.error("Subdomínio já está em uso. Escolha outro.");
        setStep(0);
        setSubmitting(false);
        return;
      }

      // 2. Create barbershop
      const { data: shop, error: insertError } = await supabase
        .from("barbershops")
        .insert({
          name: name.trim(),
          subdomain: subdomainSlug,
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          owner_id: user.id,
        })
        .select()
        .single();

      if (insertError || !shop) {
        throw new Error(insertError?.message || "Erro ao criar barbearia.");
      }

      // 3. Upload logo if selected
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
        const path = `${shop.id}/logo.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("logos")
          .upload(path, logoFile, { upsert: true });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("logos").getPublicUrl(path);
          await supabase
            .from("barbershops")
            .update({ logo_url: urlData.publicUrl })
            .eq("id", shop.id);
        }
      }

      // 4. Assign admin role only — barbers join via invitation link
      await supabase.from("user_roles").insert({
        user_id: user.id,
        barbershop_id: shop.id,
        role: "admin_barbearia" as const,
      });

      toast.success("Barbearia criada com sucesso!");
      navigate({ to: "/dashboard", search: { checkout: undefined } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro inesperado.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Progress */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i <= step
                  ? "bg-gold text-gold-foreground"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {i < step ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <span
              className={`text-xs hidden sm:inline ${
                i <= step ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`w-8 h-px ${
                  i < step ? "bg-gold" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Name & Subdomain */}
      {step === 0 && (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <Globe className="w-10 h-10 text-gold mx-auto mb-3" />
            <h2 className="text-2xl font-display font-bold text-foreground">
              Sua Barbearia
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Nome e endereço web da sua barbearia
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Nome da Barbearia</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!subdomain) {
                  setSubdomain(
                    e.target.value
                      .toLowerCase()
                      .replace(/\s+/g, "-")
                      .replace(/[^a-z0-9-]/g, "")
                  );
                }
              }}
              placeholder="Ex: Barbearia do João"
              maxLength={100}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="subdomain">Subdomínio</Label>
            <div className="flex items-center gap-0">
              <Input
                id="subdomain"
                value={subdomain}
                onChange={(e) => setSubdomain(e.target.value)}
                placeholder="minha-barbearia"
                className="rounded-r-none"
                maxLength={30}
              />
              <span className="px-3 py-2 bg-secondary border border-l-0 border-border rounded-r-md text-xs text-muted-foreground whitespace-nowrap">
                .barbaflow.app
              </span>
            </div>
            {subdomainSlug && (
              <p className="text-xs text-muted-foreground">
                URL: <span className="text-gold">{subdomainSlug}.barbaflow.app</span>
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 2: Branding */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <Palette className="w-10 h-10 text-gold mx-auto mb-3" />
            <h2 className="text-2xl font-display font-bold text-foreground">
              Branding
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Logo e cores da sua marca
            </p>
          </div>

          {/* Logo */}
          <div className="space-y-3">
            <Label>Logo (opcional)</Label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-secondary">
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                ) : (
                  <ImageIcon className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoSelect}
                  className="hidden"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="w-4 h-4" />
                  {logoFile ? "Trocar" : "Enviar logo"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">PNG, JPG ou SVG. Máx 2MB.</p>
              </div>
            </div>
          </div>

          {/* Colors */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cor Primária</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="font-mono text-xs uppercase"
                  maxLength={7}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cor Secundária</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-border cursor-pointer bg-transparent"
                />
                <Input
                  value={secondaryColor}
                  onChange={(e) => setSecondaryColor(e.target.value)}
                  className="font-mono text-xs uppercase"
                  maxLength={7}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Review */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="text-center mb-6">
            <Scissors className="w-10 h-10 text-gold mx-auto mb-3" />
            <h2 className="text-2xl font-display font-bold text-foreground">
              Revisão
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Confira os dados antes de criar
            </p>
          </div>

          <Card className="border-border bg-card">
            <CardContent className="p-5 space-y-4">
              {/* Preview header */}
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold overflow-hidden"
                  style={{ backgroundColor: primaryColor, color: secondaryColor }}
                >
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" />
                  ) : (
                    name.charAt(0).toUpperCase()
                  )}
                </div>
                <div>
                  <p className="font-display text-lg font-semibold" style={{ color: primaryColor }}>
                    {name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subdomainSlug}.barbaflow.app
                  </p>
                </div>
              </div>

              {/* Preview buttons */}
              <div className="flex gap-2">
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

              <div className="pt-3 border-t border-border space-y-1 text-sm">
                <p><span className="text-muted-foreground">Nome:</span> {name}</p>
                <p><span className="text-muted-foreground">URL:</span> {subdomainSlug}.barbaflow.app</p>
                <p><span className="text-muted-foreground">Primária:</span> {primaryColor}</p>
                <p><span className="text-muted-foreground">Secundária:</span> {secondaryColor}</p>
                <p><span className="text-muted-foreground">Logo:</span> {logoFile ? logoFile.name : "Nenhum"}</p>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-center">
            Sua barbearia será ativada automaticamente após a criação.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-8">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => s - 1)}
          disabled={step === 0}
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Button>

        {step < STEPS.length - 1 ? (
          <Button
            variant="gold"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
          >
            Próximo
            <ArrowRight className="w-4 h-4" />
          </Button>
        ) : (
          <Button
            variant="gold"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {submitting ? "Criando..." : "Criar Barbearia"}
          </Button>
        )}
      </div>
    </div>
  );
}
