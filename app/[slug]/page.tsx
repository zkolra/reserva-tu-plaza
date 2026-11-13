import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadStudio } from "@/lib/supabase";
import { supabaseConfig } from "@/lib/config";
import ClassSelector from "./ClassSelector";
import StudioLogo from "@/components/StudioLogo";
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

  return (
    <div style={themeVars(data.studio.accent_color)} className="flex flex-1 flex-col">
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <StudioLogo name={data.studio.name} logoUrl={data.studio.logo_url} />
          <div className="font-bold">{data.studio.name}</div>
        </div>
      </header>
      <ClassSelector data={data} supabaseConfig={supabaseConfig()} />
    </div>
  );
}
