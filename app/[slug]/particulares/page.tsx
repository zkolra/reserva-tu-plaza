import { Suspense } from "react";
import { notFound } from "next/navigation";
import StudioHeader from "@/components/StudioHeader";
import { supabaseConfig } from "@/lib/config";
import { loadPrivate } from "@/lib/private";
import { themeVars } from "@/lib/theme";
import PrivateBooking from "./PrivateBooking";

export default function PrivatePage({ params }: PageProps<"/[slug]/particulares">) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-5xl px-6 py-10 text-muted">Cargando…</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadPrivate(slug);
  if (!data || !data.enabled) notFound();

  return (
    <div style={themeVars(data.studio.accent_color)} className="flex flex-1 flex-col">
      <StudioHeader name={data.studio.name} logoUrl={data.studio.logo_url} slug={data.studio.slug} showPrivate current="particulares" />
      <PrivateBooking data={data} cfg={supabaseConfig()} />
    </div>
  );
}
