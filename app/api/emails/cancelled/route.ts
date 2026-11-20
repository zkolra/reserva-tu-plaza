import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import { cancelledEmail, sendEmailBatch } from "@/lib/email";

// La escuela cancela una clase → avisamos por email a los apuntados ese día.
// Todo se lee con la sesión de quien llama: solo el personal de la escuela ve la lista.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { series, date } = (await request.json().catch(() => ({}))) as { series?: string; date?: string };
  const cfg = supabaseConfig();
  if (!token || !series || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !cfg)
    return Response.json({ sent: 0, reason: "bad_request" }, { status: 400 });

  const sb = createClient(cfg.url, cfg.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: s } = await sb
    .from("class_series")
    .select("name, start_time, studio_id, studios(name, slug, accent_color, logo_url, contact_email)")
    .eq("id", series)
    .maybeSingle();
  type St = { name: string; slug: string; accent_color: string | null; logo_url: string | null; contact_email: string | null };
  const studio = (Array.isArray(s?.studios) ? s?.studios[0] : s?.studios) as St | null | undefined;
  if (!s || !studio) return Response.json({ sent: 0, reason: "not_found" }, { status: 404 });

  const { data: c } = await sb
    .from("class_cancellations")
    .select("reason")
    .eq("series_id", series)
    .eq("date_from", date)
    .maybeSingle();
  if (!c) return Response.json({ sent: 0, reason: "not_cancelled" }, { status: 404 });

  const { data: roster, error } = await sb.rpc("class_roster_day", { p_studio: s.studio_id, p_date: date });
  if (error) return Response.json({ sent: 0, reason: `db: ${error.message}` }, { status: 403 });
  const emails = [
    ...new Set(
      ((roster ?? []) as { series_id: string; email: string | null }[])
        .filter((r) => r.series_id === series && r.email)
        .map((r) => r.email!.toLowerCase()),
    ),
  ];
  if (emails.length === 0) return Response.json({ sent: 0, reason: "nobody" });

  const [y, m, d] = date.split("-").map(Number);
  const dateLabel = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const origin = new URL(request.url).origin;
  const mail = cancelledEmail(studio, {
    className: s.name as string,
    dateLabel,
    time: (s.start_time as string).slice(0, 5),
    reason: (c.reason as string | null) ?? null,
    scheduleUrl: `${origin}/${studio.slug}/cuenta`,
  });
  const result = await sendEmailBatch(
    emails.map((to) => ({ to, ...mail })),
    studio.name,
    studio.contact_email,
  );
  return Response.json(result);
}
