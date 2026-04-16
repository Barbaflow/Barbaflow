import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const baseUrl = "https://barbaflow-pro.lovable.app";
        const now = new Date().toISOString().split("T")[0];

        const staticRoutes = [
          { loc: "/", priority: "1.0", changefreq: "weekly" },
          { loc: "/sobre", priority: "0.8", changefreq: "monthly" },
          { loc: "/login", priority: "0.6", changefreq: "monthly" },
          { loc: "/agendar", priority: "0.8", changefreq: "weekly" },
          { loc: "/contato", priority: "0.8", changefreq: "monthly" },
          { loc: "/upgrade", priority: "0.7", changefreq: "monthly" },
        ];

        const urls = staticRoutes
          .map(
            (r) =>
              `  <url>
    <loc>${baseUrl}${r.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
          )
          .join("\n");

        const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

        return new Response(sitemap, {
          status: 200,
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
          },
        });
      },
    },
  },
});
