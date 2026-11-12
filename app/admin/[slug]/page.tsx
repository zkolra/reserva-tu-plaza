import { Suspense } from "react";
import { supabaseConfig } from "@/lib/config";
import AdminStudio from "./AdminStudio";

export const metadata = { title: "Panel del estudio · Reserva tu plaza" };

export default function AdminStudioPage({ params }: PageProps<"/admin/[slug]">) {
  return (
    <Suspense fallback={<p className="p-10 text-muted">Cargando…</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <AdminStudio cfg={supabaseConfig()} slug={slug} />;
}
