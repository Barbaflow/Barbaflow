import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface TenantTheme {
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  name: string;
}

function hexToOklch(hex: string): string {
  // Convert hex to RGB
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  // Linear RGB
  const lr = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  const lg = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  const lb = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

  // To OKLab via LMS
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

interface TenantThemeProviderProps {
  barbershopId?: string;
  children: React.ReactNode;
}

export function TenantThemeProvider({ barbershopId, children }: TenantThemeProviderProps) {
  const [theme, setTheme] = useState<TenantTheme | null>(null);

  useEffect(() => {
    if (!barbershopId) return;

    supabase
      .from("barbershops")
      .select("primary_color, secondary_color, logo_url, name")
      .eq("id", barbershopId)
      .single()
      .then(({ data, error }) => {
        if (data && !error) {
          setTheme({
            primaryColor: data.primary_color,
            secondaryColor: data.secondary_color,
            logoUrl: data.logo_url,
            name: data.name,
          });
        }
        // If barbershopId is invalid (e.g. "demo"), silently use default theme
      });
  }, [barbershopId]);

  useEffect(() => {
    if (!theme) return;
    const vars = generateThemeVars(theme.primaryColor, theme.secondaryColor);
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    return () => {
      Object.keys(vars).forEach((key) => {
        root.style.removeProperty(key);
      });
    };
  }, [theme]);

  return <>{children}</>;
}

export function useTenantTheme() {
  // Hook to access tenant theme in components if needed
  return null;
}
