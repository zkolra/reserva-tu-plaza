import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import { formatPrice } from "@/lib/pricing";
import { renewalReminderEmail, sendEmailBatch } from "@/lib/email";
import { sendPush, type PushSub } from "@/lib/push";

// Lo llama Supabase cada mañana (pg_cron + pg_net) con la cabecera x-cron-secret.
// Envía «Tu abono termina el…» a quien termina en los próximos días y no renueva solo.
export async function POST(request: Request) {
  const secret = request.headers.get("x-cron-secret");
  const cfg = supabaseConfig();
  if (!secret || !cfg || secret !== process.env.CRON_SECRET) return Response.json({ error: "forbidden" }, { status: 403 });

  const sb = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc("due_renewal_reminders", { p_secret: secret });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  type Row = {
    membership_id: string;
    email: string;
    name: string | null;
    studio_name: string;
    studio_slug: string;
    accent_color: string | null;
    logo_url: string | null;
    contact_email: string | null;
    ends_on: string;
    price_cents: number | null;
    classes: string | null;
  };
  const rows = (data ?? []) as Row[];
  const origin = new URL(request.url).origin;
  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
    new Date(iso + "T12:00:00Z").toLocaleDateString("es-ES", { ...opts, timeZone: "UTC" });

  // Un envío por escuela (remitente y respuesta de cada escuela)
  const byStudio = new Map<string, Row[]>();
  for (const r of rows) byStudio.set(r.studio_slug, [...(byStudio.get(r.studio_slug) ?? []), r]);

  let sent = 0;
  const done: string[] = [];
  for (const list of byStudio.values()) {
    const st = list[0];
    const studio = { name: st.studio_name, accent_color: st.accent_color, logo_url: st.logo_url, contact_email: st.contact_email };
    const mails = list.map((r) => {
      const next = new Date(r.ends_on + "T12:00:00Z");
      next.setUTCDate(next.getUTCDate() + 1);
      const m = renewalReminderEmail(studio, {
        name: r.name,
        endsLabel: fmt(r.ends_on, { day: "numeric", month: "long" }),
        nextMonth: next.toLocaleDateString("es-ES", { month: "long", timeZone: "UTC" }),
        price: r.price_cents ? formatPrice(r.price_cents, "EUR") : null,
        classes: r.classes,
        accountUrl: `${origin}/${r.studio_slug}/cuenta?email=${encodeURIComponent(r.email)}`,
      });
      return { to: r.email, ...m };
    });
    const res = await sendEmailBatch(mails, st.studio_name, st.contact_email);
    sent += res.sent;
    if (res.sent === mails.length) done.push(...list.map((r) => r.membership_id));
  }
  // Push a quien tenga avisos activados
  let pushed = 0;
  if (rows.length) {
    const { data: subs } = await sb.rpc("push_subs_for_memberships", { p_secret: secret, p_ids: rows.map((r) => r.membership_id) });
    for (const r of rows) {
      const mine = ((subs ?? []) as (PushSub & { membership_id: string })[]).filter((x) => x.membership_id === r.membership_id);
      if (!mine.length) continue;
      const res = await sendPush(
        mine,
        {
          title: `Tu abono termina el ${fmt(r.ends_on, { day: "numeric", month: "long" })}`,
          body: `${r.studio_name}: pulsa para renovarlo.`,
          url: `${origin}/${r.studio_slug}/cuenta`,
        },
        sb,
      );
      pushed += res.sent;
    }
  }
  if (done.length) await sb.rpc("mark_reminded", { p_secret: secret, p_ids: done });
  return Response.json({ due: rows.length, sent, pushed });
}
