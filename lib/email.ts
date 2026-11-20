// Correos de la plataforma. Se envían con Resend desde mail.dev22.es:
// remitente = nombre de la escuela, respuesta = email de la escuela.

export const EMAIL_FROM_ADDRESS = "reservas@mail.dev22.es";

const DAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type EmailStudio = {
  name: string;
  accent_color: string | null;
  logo_url: string | null;
  contact_email: string | null;
};

/** Marco común: logo o nombre, contenido, pie con la escuela. */
function layout(studio: EmailStudio, body: string) {
  const accent = studio.accent_color || "#b8235a";
  const head = studio.logo_url
    ? `<img src="${esc(studio.logo_url)}" alt="${esc(studio.name)}" height="48" style="height:48px;max-width:200px;object-fit:contain">`
    : `<div style="font-size:20px;font-weight:700;color:${accent}">${esc(studio.name)}</div>`;
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f6f3ee;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1a17">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:28px">
<tr><td style="padding-bottom:20px">${head}</td></tr>
<tr><td style="font-size:16px;line-height:1.55">${body}</td></tr>
<tr><td style="padding-top:24px;border-top:1px solid #eee;font-size:12px;color:#7a736b">
${esc(studio.name)}${studio.contact_email ? ` · Si tienes dudas, responde a este correo.` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

function button(studio: EmailStudio, href: string, label: string) {
  const accent = studio.accent_color || "#b8235a";
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:12px">${esc(label)}</a></p>`;
}

export type WelcomeData = {
  name: string | null;
  email: string;
  classes: { name: string; weekday: number; start_time: string }[];
  planName: string | null;
  endsOn: string | null; // YYYY-MM-DD
  accountUrl: string;
};

/** La escuela ha apuntado al alumno a mano (pago en efectivo, transferencia…). */
export function welcomeEmail(studio: EmailStudio, d: WelcomeData) {
  const hello = d.name ? `Hola, ${esc(d.name.split(" ")[0])}:` : "¡Hola!";
  const list = d.classes
    .slice()
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time))
    .map((c) => `<li>${esc(c.name)} — ${DAYS[c.weekday - 1]} a las ${c.start_time.slice(0, 5)}</li>`)
    .join("");
  const until = d.endsOn
    ? new Date(d.endsOn + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long" })
    : null;
  const body = `<p style="margin:0 0 12px">${hello}</p>
<p style="margin:0 0 12px"><b>${esc(studio.name)}</b> te ha apuntado a sus clases. ¡Ya tienes tu plaza!</p>
${list ? `<ul style="margin:0 0 12px;padding-left:20px">${list}</ul>` : ""}
${d.planName || until ? `<p style="margin:0 0 12px">${d.planName ? `Abono: ${esc(d.planName)}. ` : ""}${until ? `Válido hasta el ${until}.` : ""}</p>` : ""}
<p style="margin:0">En «Mi cuenta» ves tus clases y tu abono. Entra con este email: <b>${esc(d.email)}</b> — te mandaremos un enlace, sin contraseña.</p>
${button(studio, d.accountUrl, "Entrar en Mi cuenta")}`;
  return {
    subject: `Ya tienes tu plaza en ${studio.name}`,
    html: layout(studio, body),
  };
}

/** La escuela ha cancelado una clase concreta. */
export function cancelledEmail(
  studio: EmailStudio,
  d: { className: string; dateLabel: string; time: string; reason: string | null; scheduleUrl: string },
) {
  const body = `<p style="margin:0 0 12px">¡Hola!</p>
<p style="margin:0 0 12px">La clase de <b>${esc(d.className)}</b> del <b>${esc(d.dateLabel)} a las ${esc(d.time)}</b> queda <b>cancelada</b>.</p>
${d.reason ? `<p style="margin:0 0 12px">Motivo: ${esc(d.reason)}</p>` : ""}
<p style="margin:0">El resto de tus clases siguen como siempre. Sentimos las molestias.</p>
${button(studio, d.scheduleUrl, "Ver mis clases")}`;
  return { subject: `Clase cancelada: ${d.className}, ${d.dateLabel}`, html: layout(studio, body) };
}

/** Varios correos de una vez (hasta 100 por llamada). */
export async function sendEmailBatch(
  emails: { to: string; subject: string; html: string }[],
  fromName: string,
  replyTo?: string | null,
): Promise<{ sent: number; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: 0, reason: "not_configured" };
  let sent = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const chunk = emails.slice(i, i + 100).map((e) => ({
      from: `${fromName.replace(/[<>"]/g, "")} <${EMAIL_FROM_ADDRESS}>`,
      to: [e.to],
      subject: e.subject,
      html: e.html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }));
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { sent, reason: `resend_${res.status} ${detail.slice(0, 200)}` };
    }
    sent += chunk.length;
  }
  return { sent };
}

/** Envía con Resend. Sin RESEND_API_KEY no hace nada (devuelve false). */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  replyTo?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { sent: false, reason: "not_configured" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${opts.fromName.replace(/[<>"]/g, "")} <${EMAIL_FROM_ADDRESS}>`,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false, reason: `resend_${res.status} ${detail.slice(0, 200)}` };
  }
  return { sent: true };
}
