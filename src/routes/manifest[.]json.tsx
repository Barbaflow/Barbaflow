import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";

const getManifest = createServerFn({ method: "GET" }).handler(async () => {
  const url = getRequestUrl();
  const hostname = url.hostname;

  let name = "BarbaFlow Cliente";
  let shortName = "BarbaFlow";
  let themeColor = "#C8A96E";
  let backgroundColor = "#0F172A";

  // Try to resolve tenant from subdomain
  const parts = hostname.split(".");
  if (
    parts.length >= 3 &&
    !["www", "app", "api", "admin"].includes(parts[0]) &&
    !parts[0].includes("preview--")
  ) {
    const subdomain = parts[0];
    const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      // Vitrine pública (view), não a tabela larga: este SSR usa a chave
      // publicável, ou seja, roda como visitante anônimo.
      const { data } = await (supabase as any)
        .from("barbearias_publicas")
        .select("name, primary_color, secondary_color")
        .eq("subdomain", subdomain)
        .eq("status", "approved")
        .maybeSingle();

      if (data) {
        name = data.name;
        shortName = data.name.length > 12 ? data.name.slice(0, 12) : data.name;
        themeColor = data.primary_color || themeColor;
        backgroundColor = data.secondary_color || backgroundColor;
      }
    }
  }

  return json(
    {
      name,
      short_name: shortName,
      description: `Agende seu horário na ${name}`,
      start_url: "/dashboard",
      display: "standalone" as const,
      background_color: backgroundColor,
      theme_color: themeColor,
      orientation: "portrait" as const,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } }
  );
});

export const Route = createFileRoute("/manifest.json")({
  loader: () => getManifest(),
});
