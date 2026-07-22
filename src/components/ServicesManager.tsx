import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Edit, Wrench, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Service {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  active: boolean;
  barber_id: string;
}

interface ServicesManagerProps {
  /**
   * Tenant já resolvido. A prop é `string` de propósito: quem renderiza precisa
   * ter provado que existe barbearia antes — nunca há um id "padrão" aqui.
   */
  barbershopId: string;
  /**
   * `true` para admin_barbearia/super_admin. O barbeiro só administra os
   * próprios serviços (é o que a RLS permite); a interface reflete isso em vez
   * de deixar o usuário descobrir pelo erro.
   */
  canManageAll?: boolean;
}

export function ServicesManager({ barbershopId, canManageAll = false }: ServicesManagerProps) {
  const { user } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState("30");
  const [newPrice, setNewPrice] = useState("");
  const [saving, setSaving] = useState(false);

  // Edit state
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [editName, setEditName] = useState("");
  const [editDuration, setEditDuration] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const canEdit = (svc: Service) => canManageAll || svc.barber_id === user?.id;

  const fetchServices = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("services")
      .select("id, name, duration_minutes, price, active, barber_id")
      .eq("barbershop_id", barbershopId)
      .order("name");
    if (error) {
      // Erro do banco não pode virar "lista vazia": são estados diferentes.
      setLoadError(error.message);
      setServices([]);
    } else {
      setServices(data || []);
    }
    setLoading(false);
  }, [barbershopId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const openEdit = (svc: Service) => {
    setEditingService(svc);
    setEditName(svc.name);
    setEditDuration(String(svc.duration_minutes));
    setEditPrice(String(svc.price));
  };

  const handleEdit = async () => {
    if (!editingService || !editName.trim() || !editPrice) return;
    setEditSaving(true);
    const { data, error } = await supabase
      .from("services")
      .update({
        name: editName.trim(),
        duration_minutes: parseInt(editDuration),
        price: parseFloat(editPrice),
      })
      .eq("id", editingService.id)
      // Isolamento explícito: mesmo que o id de outro tenant chegue aqui por
      // engano, a linha não é alcançada. A RLS já barra; isto evita depender
      // apenas dela para manter o escopo da tela.
      .eq("barbershop_id", barbershopId)
      .select("id");
    setEditSaving(false);
    if (error) {
      toast.error("Erro ao atualizar serviço.", { description: error.message });
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Serviço não encontrado nesta barbearia ou sem permissão.");
      return;
    }
    toast.success("Serviço atualizado!");
    setEditingService(null);
    fetchServices();
  };

  const handleAdd = async () => {
    if (!newName.trim() || !newPrice || !user) return;
    setSaving(true);
    const { error } = await supabase.from("services").insert({
      name: newName.trim(),
      duration_minutes: parseInt(newDuration),
      price: parseFloat(newPrice),
      barbershop_id: barbershopId,
      barber_id: user.id,
      active: true,
    });
    setSaving(false);
    if (error) {
      toast.error("Erro ao adicionar serviço.", { description: error.message });
      return;
    }
    toast.success("Serviço adicionado!");
    setNewName("");
    setNewPrice("");
    setShowAdd(false);
    fetchServices();
  };

  const toggleActive = async (svc: Service) => {
    const { data, error } = await supabase
      .from("services")
      .update({ active: !svc.active })
      .eq("id", svc.id)
      .eq("barbershop_id", barbershopId)
      .select("id");
    if (error) {
      toast.error("Erro ao alterar o serviço.", { description: error.message });
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Serviço não encontrado nesta barbearia ou sem permissão.");
      return;
    }
    fetchServices();
    toast.success(svc.active ? "Serviço desativado." : "Serviço ativado!");
  };

  const deleteService = async (id: string) => {
    const { data, error } = await supabase
      .from("services")
      .delete()
      .eq("id", id)
      .eq("barbershop_id", barbershopId)
      .select("id");
    if (error) {
      toast.error("Erro ao excluir serviço.", { description: error.message });
      return;
    }
    if (!data || data.length === 0) {
      toast.error("Serviço não encontrado nesta barbearia ou sem permissão.");
      return;
    }
    toast.success("Serviço excluído!");
    fetchServices();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-foreground">Serviços</h2>
          <p className="text-sm text-muted-foreground">
            {canManageAll
              ? "Gerencie os serviços oferecidos pela barbearia."
              : "Gerencie os serviços que você oferece nesta barbearia."}
          </p>
        </div>
        <Dialog open={showAdd} onOpenChange={setShowAdd}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4" />
              Novo Serviço
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Serviço</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Nome</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Corte masculino"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Duração (min)</Label>
                  <Input
                    type="number"
                    value={newDuration}
                    onChange={(e) => setNewDuration(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Preço (R$)</Label>
                  <Input
                    type="number"
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <Button
                onClick={handleAdd}
                disabled={saving || !newName.trim() || !newPrice}
                className="w-full"
              >
                {saving ? "Salvando..." : "Adicionar"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingService} onOpenChange={(open) => !open && setEditingService(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Serviço</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Nome</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Duração (min)</Label>
                <Input
                  type="number"
                  value={editDuration}
                  onChange={(e) => setEditDuration(e.target.value)}
                />
              </div>
              <div>
                <Label>Preço (R$)</Label>
                <Input
                  type="number"
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={handleEdit}
              disabled={editSaving || !editName.trim() || !editPrice}
              className="w-full"
            >
              {editSaving ? "Salvando..." : "Salvar alterações"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : loadError ? (
        <Card className="bg-card border-destructive/40">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-foreground">Não foi possível carregar os serviços.</p>
            <p className="text-xs text-muted-foreground max-w-md">{loadError}</p>
            <Button size="sm" variant="outline" onClick={fetchServices}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : services.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
            <Wrench className="w-8 h-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhum serviço cadastrado ainda.</p>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="w-4 h-4" />
              Adicionar primeiro serviço
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {services.map((svc) => {
            const editable = canEdit(svc);
            return (
              <Card
                key={svc.id}
                className={`bg-card border-border ${!svc.active ? "opacity-50" : ""}`}
              >
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-foreground truncate">{svc.name}</p>
                      {!svc.active && (
                        <Badge variant="secondary" className="text-[10px]">
                          Inativo
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {svc.duration_minutes} min · R$ {Number(svc.price).toFixed(2)}
                    </p>
                  </div>
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => openEdit(svc)}
                      >
                        <Edit className="w-3.5 h-3.5" />
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-8"
                        onClick={() => toggleActive(svc)}
                      >
                        {svc.active ? "Desativar" : "Ativar"}
                      </Button>
                      {canManageAll && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 h-8"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Excluir serviço</AlertDialogTitle>
                              <AlertDialogDescription>
                                Tem certeza que deseja excluir <strong>{svc.name}</strong>? Esta
                                ação não pode ser desfeita.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancelar</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteService(svc.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                Excluir
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-foreground flex-shrink-0">
                      De outro profissional
                    </span>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
