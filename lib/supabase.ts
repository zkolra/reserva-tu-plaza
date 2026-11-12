import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoData } from "./demo";
import type { Availability, StudioData } from "./types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null;

/** Carga todo lo que necesita el horario público de un estudio. */
export async function loadStudio(slug: string): Promise<StudioData | null> {
  if (!supabase) return slug === "demo" ? demoData : null;

  const { data: studio } = await supabase
    .from("studios")
    .select("id, name, slug, currency, cancel_hours")
    .eq("slug", slug)
    .maybeSingle();

  if (!studio) return slug === "demo" ? demoData : null;

  const [modules, series, plans, availability] = await Promise.all([
    supabase.from("studio_modules").select("module, enabled").eq("studio_id", studio.id),
    supabase
      .from("class_series")
      .select("id, name, level, teachers, weekday, start_time, duration_min, uses_roles, capacity, capacity_leaders, capacity_followers")
      .eq("studio_id", studio.id)
      .eq("active", true),
    supabase
      .from("plans")
      .select("id, kind, name, price_cents, classes_per_week, class_count, sort")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .order("sort"),
    supabase.rpc("series_availability", { p_studio: studio.id }),
  ]);

  return {
    studio,
    modules: Object.fromEntries((modules.data ?? []).map((m) => [m.module, m.enabled])),
    series: series.data ?? [],
    plans: plans.data ?? [],
    availability: Object.fromEntries(
      ((availability.data ?? []) as Availability[]).map((a) => [a.series_id, a]),
    ),
    isDemo: false,
  };
}
