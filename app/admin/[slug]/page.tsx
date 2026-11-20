import { Suspense } from "react";
import { supabaseConfig } from "@/lib/config";
import type { Metadata } from "next";
import ServiceWorker from "@/components/ServiceWorker";
import AdminStudio from "./AdminStudio";

export async function generateMetadata({ params }: PageProps<"/admin/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Panel del estudio · Reserva tu plaza",
    manifest: `/admin/${slug}/app.webmanifest`,
    appleWebApp: { capable: true, title: "Panel", statusBarStyle: "default" },
    icons: { apple: "/icons/icon-192.png" },
  };
}

export default function AdminStudioPage({ params }: PageProps<"/admin/[slug]">) {
  return (
    <Suspense fallback={<p className="p-10 text-muted">Cargando…</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return (
    <>
      <AdminStudio cfg={supabaseConfig()} slug={slug} />
      <ServiceWorker />
    </>
  );
}
