import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadStudio } from "@/lib/supabase";
import { supabaseConfig } from "@/lib/config";
import ClassSelector from "./ClassSelector";
import StudioHeader from "@/components/StudioHeader";
import { privateEnabled } from "@/lib/private";
import { themeVars } from "@/lib/theme";

export default function StudioSchedulePage({ params }: PageProps<"/[slug]">) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-7xl px-6 py-10 text-muted">Cargando horario…</p>}>
      <StudioSchedule params={params} />
    </Suspense>
  );
}

async function StudioSchedule({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadStudio(slug);
  if (!data) notFound();
  const showPrivate = await privateEnabled(data.studio.id);

  return (
    <div style={themeVars(data.studio.accent_color)} className="flex flex-1 flex-col">
      <StudioHeader
        name={data.studio.name}
        logoUrl={data.studio.logo_url}
        slug={data.studio.slug}
        showPrivate={showPrivate}
        current="horario"
      />
      <ClassSelector data={data} supabaseConfig={supabaseConfig()} />
    </div>
  );
}
