import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Loader2, Trash2, User, Check, Phone } from "lucide-react";
import { toast } from "sonner";
import { displayBRPhone, isValidBRPhone, maskBRPhone, toStorageBRPhone, digitsOnly } from "@/lib/phone";

export function ProfilePhotoUpload() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [originalPhone, setOriginalPhone] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("avatar_url, full_name, phone")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.avatar_url) setAvatarUrl(data.avatar_url);
        setFullName(data?.full_name || "");
        setOriginalName(data?.full_name || "");
        setPhone((data as any)?.phone || "");
        setOriginalPhone((data as any)?.phone || "");
        setLoading(false);
      });
  }, [user]);

  const profileChanged = fullName.trim() !== originalName || phone.trim() !== originalPhone;

  const handleSaveProfile = async () => {
    if (!user || !profileChanged) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), phone: phone.trim() || null } as any)
      .eq("user_id", user.id);
    if (error) {
      toast.error("Erro ao salvar perfil.");
    } else {
      setOriginalName(fullName.trim());
      setOriginalPhone(phone.trim());
      toast.success("Perfil atualizado!");
    }
    setSavingProfile(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Selecione um arquivo de imagem.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("A imagem deve ter no máximo 5MB.");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop() || "jpg";
    const filePath = `${user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      toast.error("Erro ao enviar foto.");
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
    const publicUrl = urlData.publicUrl + "?t=" + Date.now();

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("user_id", user.id);

    if (updateError) {
      toast.error("Erro ao salvar foto no perfil.");
    } else {
      setAvatarUrl(publicUrl);
      toast.success("Foto atualizada!");
    }
    setUploading(false);
  };

  const handleRemove = async () => {
    if (!user) return;
    setUploading(true);

    // List and remove files in user folder
    const { data: files } = await supabase.storage
      .from("avatars")
      .list(user.id);

    if (files && files.length > 0) {
      await supabase.storage
        .from("avatars")
        .remove(files.map((f) => `${user.id}/${f.name}`));
    }

    await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("user_id", user.id);

    setAvatarUrl(null);
    toast.success("Foto removida.");
    setUploading(false);
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="p-6 flex items-center gap-4">
          <div className="h-20 w-20 rounded-full bg-muted animate-pulse" />
          <div className="space-y-2">
            <div className="h-4 w-32 bg-muted rounded animate-pulse" />
            <div className="h-3 w-48 bg-muted rounded animate-pulse" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-6">
        <div className="flex items-center gap-5">
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Foto de perfil"
                className="h-20 w-20 rounded-full object-cover border-2 border-primary/30"
              />
            ) : (
              <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center border-2 border-dashed border-primary/30">
                <User className="w-8 h-8 text-primary/50" />
              </div>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Info */}
          <div className="space-y-2 min-w-0">
            <h3 className="font-display font-semibold text-foreground">Foto de Perfil</h3>
            <p className="text-xs text-muted-foreground">
              JPG, PNG ou WebP. Máximo 5MB.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {avatarUrl ? "Trocar Foto" : "Enviar Foto"}
              </Button>
              {avatarUrl && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleRemove}
                  disabled={uploading}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remover
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Profile fields */}
        <div className="mt-5 pt-5 border-t border-border space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Nome Completo</Label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Seu nome completo"
              className="bg-background border-border"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Telefone / WhatsApp</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(11) 99999-9999"
                className="bg-background border-border pl-9"
              />
            </div>
          </div>
          <Button
            size="sm"
            onClick={handleSaveProfile}
            disabled={savingProfile || !profileChanged}
          >
            {savingProfile ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Salvar Perfil
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </CardContent>
    </Card>
  );
}
