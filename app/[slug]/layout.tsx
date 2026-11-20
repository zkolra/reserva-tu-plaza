import type { Metadata, Viewport } from "next";
import ServiceWorker from "@/components/ServiceWorker";
import { getSupabase } from "@/lib/supabase";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return {
    manifest: `/${slug}/app.webmanifest`,
    appleWebApp: { capable: true, title: "Mi escuela", statusBarStyle: "default" },
    icons: { apple: "/icons/icon-192.png" },
  };
}

export const viewport: Viewport = { themeColor: "#1d1a17" };

export default async function StudioLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  // Modo prueba (migración 0023): aviso a los alumnos con el contacto de la escuela
  let test: { test_mode: boolean; contact_email: string | null } | null = null;
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("studios").select("test_mode, contact_email").eq("slug", slug).maybeSingle();
    if (!error && data?.test_mode) test = data as { test_mode: boolean; contact_email: string | null };
  }
  return (
    <>
      {test && (
        <div role="status" className="bg-few px-4 py-2 text-center text-sm font-semibold text-white">
          Estamos probando el sistema. Si algo no funciona o no se entiende, escríbenos
          {test.contact_email ? (
            <>
              {": "}
              <a href={`mailto:${test.contact_email}`} className="underline">
                {test.contact_email}
              </a>
            </>
          ) : (
            "."
          )}
        </div>
      )}
      {children}
      <ServiceWorker />
    </>
  );
}
