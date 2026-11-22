import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Clave pública VAPID (la privada está en Cloudflare: VAPID_PRIVATE_KEY). */
export { VAPID_PUBLIC_KEY } from "@/lib/push-public";
import { VAPID_PUBLIC_KEY } from "@/lib/push-public";

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushNote = { title: string; body: string; url?: string; icon?: string };

/** Envía un aviso a varios dispositivos. Devuelve cuántos lo recibieron. */
export async function sendPush(subs: PushSub[], note: PushNote, sb?: SupabaseClient): Promise<{ sent: number; reason?: string }> {
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!privateKey) return { sent: 0, reason: "not_configured" };
  const vapid = { subject: "mailto:reservas@mail.dev22.es", publicKey: VAPID_PUBLIC_KEY, privateKey };
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        const payload = await buildPushPayload(
          { data: note, options: { ttl: 60 * 60 * 24, urgency: "normal" } },
          { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
          vapid,
        );
        const res = await fetch(s.endpoint, payload);
        if (res.ok) sent++;
        else if ((res.status === 404 || res.status === 410) && sb) await sb.rpc("forget_push_sub", { p_endpoint: s.endpoint });
      } catch {
        // un dispositivo que falla no para a los demás
      }
    }),
  );
  return { sent };
}
