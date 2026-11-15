import { Suspense } from "react";
import { notFound } from "next/navigation";
import StudioHeader from "@/components/StudioHeader";
import { supabaseConfig } from "@/lib/config";
import { privateEnabled } from "@/lib/private";
import { getSupabase } from "@/lib/supabase";
import { themeVars } from "@/lib/theme";
import StudentAccount, { type AccountStudio } from "./StudentAccount";

export const metadata = { title: "Mi cuenta" };

export default function AccountPage({ params }: PageProps<"/[slug]/cuenta">) {
  return (
    <Suspense fallback={<p className="mx-auto max-w-4xl px-6 py-10 text-muted">Cargando…</p>}>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = getSupabase();
  if (!sb) notFound();
  const { data: studio } = await sb
    .from("studios")
    .select("id, name, slug, currency, timezone, cancel_hours, renewal_mode, accent_color, logo_url")
    .eq("slug", slug)
    .maybeSingle();
  if (!studio) notFound();
  const showPrivate = await privateEnabled(studio.id);

  return (
    <div style={themeVars(studio.accent_color)} className="flex flex-1 flex-col">
      <StudioHeader name={studio.name} logoUrl={studio.logo_url} slug={studio.slug} showPrivate={showPrivate} current="cuenta" />
      <StudentAccount studio={studio as AccountStudio} cfg={supabaseConfig()} />
    </div>
  );
}
