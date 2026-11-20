import { getSupabase } from "@/lib/supabase";

/** Manifest de la app (PWA) de una escuela: nombre, color e icono propios. */
export async function studioManifest(slug: string, kind: "student" | "admin") {
  const sb = getSupabase();
  const { data: s } = sb
    ? await sb.from("studios").select("name, accent_color, logo_url").eq("slug", slug).maybeSingle()
    : { data: null };
  const name = s?.name ?? "Reserva tu plaza";
  const icons: { src: string; sizes: string; type: string; purpose?: string }[] = [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
  ];
  if (s?.logo_url) icons.unshift({ src: s.logo_url, sizes: "any", type: s.logo_url.endsWith(".svg") ? "image/svg+xml" : "image/png" });
  const manifest = {
    id: kind === "admin" ? `/admin/${slug}` : `/${slug}/cuenta`,
    name: kind === "admin" ? `${name} · Panel` : name,
    short_name: kind === "admin" ? "Panel" : name.slice(0, 12),
    start_url: kind === "admin" ? `/admin/${slug}` : `/${slug}/cuenta`,
    scope: kind === "admin" ? `/admin/${slug}` : `/${slug}`,
    display: "standalone",
    background_color: "#f6f3ee",
    theme_color: s?.accent_color || "#1d1a17",
    lang: "es",
    icons,
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" },
  });
}
