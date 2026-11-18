import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import { sendEmail, welcomeEmail } from "@/lib/email";

// La escuela acaba de apuntar a un alumno a mano → le enviamos la bienvenida.
// Se lee la base de datos con la sesión de quien llama: solo el personal de la escuela ve ese abono.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { membership } = (await request.json().catch(() => ({}))) as { membership?: string };
  const cfg = supabaseConfig();
  if (!token || !membership || !cfg) return Response.json({ sent: false, reason: "bad_request" }, { status: 400 });

  const sb = createClient(cfg.url, cfg.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: who, error: authError } = await sb.auth.getUser(token);
  if (authError || !who.user)
    return Response.json({ sent: false, reason: `auth: ${authError?.message ?? "sin usuario"}` }, { status: 401 });

  const { data: m, error } = await sb
    .from("memberships")
    .select(
      "guest_name, guest_email, user_id, ends_on, plans(name), membership_series(class_series(name, weekday, start_time)), studios(name, slug, accent_color, logo_url, contact_email)",
    )
    .eq("id", membership)
    .maybeSingle();
  if (error || !m)
    return Response.json({ sent: false, reason: error ? `db: ${error.message}` : "membership_not_visible" }, { status: 404 });

  type One<T> = T | T[] | null;
  const one = <T,>(x: One<T>) => (Array.isArray(x) ? x[0] : x) ?? null;
  const studio = one(m.studios as One<{ name: string; slug: string; accent_color: string | null; logo_url: string | null; contact_email: string | null }>);
  if (!studio) return Response.json({ sent: false, reason: "studio_not_visible" }, { status: 404 });

  let email = m.guest_email as string | null;
  if (!email && m.user_id) {
    const { data: p } = await sb.from("profiles").select("email").eq("user_id", m.user_id).maybeSingle();
    email = (p?.email as string | undefined) ?? null;
  }
  if (!email) return Response.json({ sent: false, reason: "no_email" });

  const classes = ((m.membership_series ?? []) as { class_series: One<{ name: string; weekday: number; start_time: string }> }[])
    .map((x) => one(x.class_series))
    .filter((x): x is { name: string; weekday: number; start_time: string } => !!x);

  const origin = new URL(request.url).origin;
  const mail = welcomeEmail(studio, {
    name: m.guest_name as string | null,
    email,
    classes,
    planName: one(m.plans as One<{ name: string }>)?.name ?? null,
    endsOn: m.ends_on as string | null,
    accountUrl: `${origin}/${studio.slug}/cuenta?email=${encodeURIComponent(email)}`,
  });
  const result = await sendEmail({ to: email, ...mail, fromName: studio.name, replyTo: studio.contact_email });
  return Response.json(result);
}
