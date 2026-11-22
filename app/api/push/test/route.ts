import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";
import { sendPush, type PushSub } from "@/lib/push";

// Aviso de prueba a los dispositivos de quien llama
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const cfg = supabaseConfig();
  if (!token || !cfg) return Response.json({ sent: 0, reason: "bad_request" }, { status: 400 });
  const sb = createClient(cfg.url, cfg.key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who } = await sb.auth.getUser(token);
  if (!who.user) return Response.json({ sent: 0, reason: "auth" }, { status: 401 });
  const { data } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", who.user.id);
  const r = await sendPush((data ?? []) as PushSub[], {
    title: "¡Avisos activados! 🎉",
    body: "Así te avisaremos si se cancela una clase o tu abono está por terminar.",
    url: new URL(request.url).origin,
  }, sb);
  return Response.json(r);
}
