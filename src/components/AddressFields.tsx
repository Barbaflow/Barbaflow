import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BR_STATES, fetchViaCep, isValidCep, maskCep } from "@/lib/cep";

export interface AddressValue {
  cep: string;
  state: string;
  city: string;
  neighborhood: string;
  street: string;
  number: string;
  complement: string;
}

export const EMPTY_ADDRESS: AddressValue = {
  cep: "",
  state: "",
  city: "",
  neighborhood: "",
  street: "",
  number: "",
  complement: "",
};

interface AddressFieldsProps {
  value: AddressValue;
  onChange: (next: AddressValue) => void;
  /** Se true, mostra asteriscos visuais nos campos obrigatórios. Default: true. */
  required?: boolean;
  /** Prefixo para os IDs dos inputs, evita colisão quando há múltiplos forms. */
  idPrefix?: string;
  disabled?: boolean;
}

/**
 * Campos de endereço brasileiro com auto-preenchimento via ViaCEP.
 * Validação leve: CEP, estado (UF), cidade, bairro e rua são obrigatórios.
 * Número e complemento são opcionais.
 */
export function AddressFields({
  value,
  onChange,
  required = true,
  idPrefix = "addr",
  disabled,
}: AddressFieldsProps) {
  const [loadingCep, setLoadingCep] = useState(false);

  const update = (patch: Partial<AddressValue>) => onChange({ ...value, ...patch });

  const lookupCep = async () => {
    if (!isValidCep(value.cep)) {
      toast.error("Digite um CEP com 8 dígitos.");
      return;
    }
    setLoadingCep(true);
    try {
      const res = await fetchViaCep(value.cep);
      update({
        cep: res.cep,
        state: res.state,
        city: res.city,
        // só sobrescreve bairro/rua se vierem preenchidos
        neighborhood: res.neighborhood || value.neighborhood,
        street: res.street || value.street,
      });
      toast.success("Endereço preenchido pelo CEP.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao consultar CEP.");
    } finally {
      setLoadingCep(false);
    }
  };

  const star = required ? <span className="text-destructive">*</span> : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4 text-primary" />
        <span>Endereço da barbearia</span>
      </div>

      {/* CEP + busca */}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-cep`}>CEP {star}</Label>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-cep`}
            value={value.cep}
            onChange={(e) => update({ cep: maskCep(e.target.value) })}
            onBlur={() => {
              if (isValidCep(value.cep) && !value.street) lookupCep();
            }}
            placeholder="00000-000"
            inputMode="numeric"
            maxLength={9}
            disabled={disabled || loadingCep}
          />
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={lookupCep}
            disabled={disabled || loadingCep || !isValidCep(value.cep)}
            aria-label="Buscar endereço pelo CEP"
          >
            {loadingCep ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            Buscar
          </Button>
        </div>
      </div>

      {/* Estado + Cidade */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2 col-span-1">
          <Label htmlFor={`${idPrefix}-state`}>Estado {star}</Label>
          <Select
            value={value.state}
            onValueChange={(v) => update({ state: v })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-state`}>
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {BR_STATES.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 col-span-2">
          <Label htmlFor={`${idPrefix}-city`}>Cidade {star}</Label>
          <Input
            id={`${idPrefix}-city`}
            value={value.city}
            onChange={(e) => update({ city: e.target.value.slice(0, 80) })}
            placeholder="Ex: São Paulo"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Bairro */}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-neighborhood`}>Bairro {star}</Label>
        <Input
          id={`${idPrefix}-neighborhood`}
          value={value.neighborhood}
          onChange={(e) => update({ neighborhood: e.target.value.slice(0, 80) })}
          placeholder="Ex: Vila Mariana"
          disabled={disabled}
        />
      </div>

      {/* Rua + Número */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2 col-span-2">
          <Label htmlFor={`${idPrefix}-street`}>Rua {star}</Label>
          <Input
            id={`${idPrefix}-street`}
            value={value.street}
            onChange={(e) => update({ street: e.target.value.slice(0, 120) })}
            placeholder="Ex: Av. Paulista"
            disabled={disabled}
          />
        </div>
        <div className="space-y-2 col-span-1">
          <Label htmlFor={`${idPrefix}-number`}>Número</Label>
          <Input
            id={`${idPrefix}-number`}
            value={value.number}
            onChange={(e) => update({ number: e.target.value.slice(0, 12) })}
            placeholder="123"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Complemento */}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-complement`}>Complemento</Label>
        <Input
          id={`${idPrefix}-complement`}
          value={value.complement}
          onChange={(e) => update({ complement: e.target.value.slice(0, 80) })}
          placeholder="Sala, andar, ponto de referência…"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

/** Validação: campos obrigatórios preenchidos. */
export function isAddressComplete(a: AddressValue): boolean {
  return (
    isValidCep(a.cep) &&
    a.state.trim().length === 2 &&
    a.city.trim().length > 0 &&
    a.neighborhood.trim().length > 0 &&
    a.street.trim().length > 0
  );
}

/** Normaliza para gravação no banco (trim). */
export function addressForDb(a: AddressValue) {
  return {
    cep: a.cep.trim() || null,
    state: a.state.trim().toUpperCase() || null,
    city: a.city.trim() || null,
    neighborhood: a.neighborhood.trim() || null,
    street: a.street.trim() || null,
    number: a.number.trim() || null,
    complement: a.complement.trim() || null,
  };
}
