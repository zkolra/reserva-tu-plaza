import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadStudio } from "@/lib/supabase";
import ClassSelector from "./ClassSelector";

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
    <>
      <header className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent font-display text-sm font-bold">
            {data.studio.name.slice(0, 1)}
          </div>
          <div className="font-bold">{data.studio.name}</div>
        </div>
      </header>
      <ClassSelector data={data} />
    </>
  );
}
