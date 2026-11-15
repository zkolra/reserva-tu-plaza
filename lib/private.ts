import { getSupabase } from "./supabase";

export type Teacher = { id: string; name: string; offers_private: boolean; active: boolean; sort: number };
export type PrivateOption = {
  id: string;
  name: string;
  teacher_ids: string[];
  duration_min: number;
  price_cents: number;
  online: boolean;
  active: boolean;
  sort: number;
};
export type PackPlan = {
  id: string;
  name: string;
  option_id: string | null;
  class_count: number;
  price_cents: number;
  valid_days: number;
  active: boolean;
  sort: number;
};
export type Slot = { starts_at: string; local_date: string; local_time: string };

export type PrivateData = {
  studio: {
    id: string;
    name: string;
    slug: string;
    currency: string;
    timezone: string;
    accent_color: string;
    logo_url: string | null;
    private_requires_confirmation: boolean;
    private_styles: string[];
    cancel_hours: number;
  };
  enabled: boolean;
  rolesEnabled: boolean;
  teachers: Teacher[];
  options: PrivateOption[];
  packs: PackPlan[];
};

/** Todo lo público para la página de clases particulares de una escuela. */
export async function loadPrivate(slug: string): Promise<PrivateData | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: studio } = await sb
    .from("studios")
    .select(
      "id, name, slug, currency, timezone, accent_color, logo_url, private_requires_confirmation, private_styles, cancel_hours",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!studio) return null;

  const [mods, teachers, options, packs] = await Promise.all([
    sb.from("studio_modules").select("module, enabled").eq("studio_id", studio.id),
    sb.from("teachers").select("id, name, offers_private, active, sort").eq("studio_id", studio.id).order("sort").order("name"),
    sb
      .from("private_options")
      .select("id, name, teacher_ids, duration_min, price_cents, online, active, sort")
      .eq("studio_id", studio.id)
      .order("sort")
      .order("price_cents"),
    sb
      .from("private_pack_plans")
      .select("id, name, option_id, class_count, price_cents, valid_days, active, sort")
      .eq("studio_id", studio.id)
      .order("sort"),
  ]);
  const m = Object.fromEntries((mods.data ?? []).map((x) => [x.module, x.enabled]));
  return {
    studio,
    enabled: !!m.private,
    rolesEnabled: !!m.roles,
    teachers: (teachers.data ?? []) as Teacher[],
    options: (options.data ?? []) as PrivateOption[],
    packs: (packs.data ?? []) as PackPlan[],
  };
}

/** ¿Tiene la escuela el módulo de particulares activo? (para el enlace en la cabecera) */
export async function privateEnabled(studioId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb || studioId === "demo") return false;
  const { data } = await sb
    .from("studio_modules")
    .select("enabled")
    .eq("studio_id", studioId)
    .eq("module", "private")
    .maybeSingle();
  return !!data?.enabled;
}

/* ── Fechas en la zona horaria de la escuela ── */

export function formatDayLong(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

export function formatInTz(ts: string, tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: tz, ...opts }).format(new Date(ts));
}

/** Fecha local (AAAA-MM-DD) de la escuela, hoy + n días. */
export function localDate(tz: string, plusDays = 0) {
  const d = new Date(Date.now() + plusDays * 864e5);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA da AAAA-MM-DD
}

/** «2026-11-20» + «17:30» en la zona de la escuela → instante ISO (UTC). */
export function localToIso(date: string, time: string, tz: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const asTz = new Date(new Date(guess).toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess - (asTz.getTime() - asUtc.getTime())).toISOString();
}

export function teacherNames(ids: string[], teachers: Teacher[]) {
  return ids.map((id) => teachers.find((t) => t.id === id)?.name ?? "—").join(" + ");
}
