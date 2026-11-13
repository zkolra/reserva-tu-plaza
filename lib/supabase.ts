import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoData } from "./demo";
import type { Availability, StudioData } from "./types";

let client: SupabaseClient | null = null;

/**
 * El cliente se crea en la primera petición, no al cargar el módulo:
 * en Cloudflare Workers las variables de entorno llegan con la petición.
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

function demo(slug: string, reason: string): StudioData | null {
  if (slug !== "demo") return null;
  console.warn(`[loadStudio] datos de ejemplo: ${reason}`);
  return { ...demoData, demoReason: reason };
}

/** Carga todo lo que necesita el horario público de un estudio. */
export async function loadStudio(slug: string): Promise<StudioData | null> {
  const supabase = getSupabase();
  if (!supabase) return demo(slug, "faltan las variables NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");

  let studio;
  try {
    const res = await supabase
      .from("studios")
      .select("id, name, slug, currency, cancel_hours, renewal_mode, enrollment_fee_cents, enrollment_valid_days, accent_color, logo_url")
      .eq("slug", slug)
      .maybeSingle();
    if (res.error) return demo(slug, `error de Supabase: ${res.error.message}`);
    studio = res.data;
  } catch (e) {
    return demo(slug, `no se pudo conectar con Supabase: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!studio) return demo(slug, `el estudio «${slug}» no está en la base (¿se ejecutó seed.sql?)`);

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

  const firstError = [modules, series, plans, availability].find((r) => r.error)?.error;
  if (firstError) return demo(slug, `error de Supabase: ${firstError.message}`);

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
