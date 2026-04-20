import { useEffect, useState } from "react";
import { useBarbershop } from "@/hooks/use-barbershop";
import { supabase } from "@/integrations/supabase/client";

function hexToOklch(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const lr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bk = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.sqrt(a * a + bk * bk);
  let h = Math.atan2(bk, a) * (180 / Math.PI);
  if (h < 0) h += 360;

  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`;
}

function generateThemeVars(primary: string, secondary: string): Record<string, string> {
  return {
    "--gold": hexToOklch(primary),
    "--gold-foreground": hexToOklch(secondary),
    "--primary": hexToOklch(primary),
    "--primary-foreground": hexToOklch(secondary),
    "--accent": hexToOklch(primary),
    "--accent-foreground": hexToOklch(secondary),
    "--ring": hexToOklch(primary),
    "--background": hexToOklch(secondary),
  };
}

/**
 * Applies branding CSS variables to :root from explicit primary/secondary colors.
 * Use this when the barbershop is loaded outside the BarbershopProvider context
 * (e.g. on path-based public pages like /agendar/$slug).
 */
export function TenantThemeColors({
  primary,
  secondary,
}: {
  primary?: string | null;
  secondary?: string | null;
}) {
  useEffect(() => {
    if (!primary || !secondary) return;
    const vars = generateThemeVars(primary, secondary);
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    return () => {
      Object.keys(vars).forEach((key) => {
        root.style.removeProperty(key);
      });
    };
  }, [primary, secondary]);

  return null;
}

/**
 * Reads branding from BarbershopContext and applies CSS variables to :root.
 * Must be rendered inside <BarbershopProvider>.
 */
export function TenantThemeApplier() {
  const { barbershop } = useBarbershop();
  const [canApply, setCanApply] = useState(false);

  useEffect(() => {
    if (!barbershop?.plan_id) {
      setCanApply(false);
      return;
    }
    supabase
      .from("plans")
      .select("name")
      .eq("id", barbershop.plan_id)
      .maybeSingle()
      .then(({ data }) => {
        setCanApply(data?.name === "pro" || data?.name === "enterprise");
      });
  }, [barbershop?.plan_id]);

  if (!canApply) return null;

  return (
    <TenantThemeColors
      primary={barbershop?.primary_color}
      secondary={barbershop?.secondary_color}
    />
  );
}
