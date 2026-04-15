import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Loader2, Trash2, User, Check } from "lucide-react";
import { toast } from "sonner";

export function ProfilePhotoUpload() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("avatar_url, full_name")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.avatar_url) setAvatarUrl(data.avatar_url);
        setFullName(data?.full_name || "");
        setOriginalName(data?.full_name || "");
        setLoading(false);
      });
  }, [user]);

  const handleSaveName = async () => {
    if (!user || fullName.trim() === originalName) return;
    setSavingName(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() })
      .eq("user_id", user.id);
    if (error) {
      toast.error("Erro ao salvar nome.");
    } else {
      setOriginalName(fullName.trim());
      toast.success("Nome atualizado!");
    }
    setSavingName(false);
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

        {/* Name field */}
        <div className="mt-5 pt-5 border-t border-border space-y-2">
          <Label className="text-xs text-muted-foreground">Nome Completo</Label>
          <div className="flex gap-2">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Seu nome completo"
              className="bg-background border-border"
            />
            <Button
              size="sm"
              onClick={handleSaveName}
              disabled={savingName || fullName.trim() === originalName}
              className="flex-shrink-0"
            >
              {savingName ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Salvar
            </Button>
          </div>
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
