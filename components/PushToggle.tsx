"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { VAPID_PUBLIC_KEY } from "@/lib/push-public";

function keyBytes(base64url: string) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/** «Activar avisos»: guarda este dispositivo para recibir notificaciones push. */
export default function PushToggle({ sb, hint }: { sb: SupabaseClient; hint?: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { data: who } = await sb.auth.getUser();
      const { error } = await sb.from("push_subscriptions").upsert(
        { user_id: who.user?.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
        { onConflict: "endpoint" },
      );
      if (error) throw new Error(error.message);
      setState("on");
      // aviso de prueba
      const { data: s } = await sb.auth.getSession();
      const r = await fetch("/api/push/test", { method: "POST", headers: { Authorization: `Bearer ${s.session?.access_token ?? ""}` } })
        .then((x) => x.json() as Promise<{ sent: number; reason?: string }>)
        .catch(() => ({ sent: 0, reason: "network" }));
      setMsg(r.sent > 0 ? "Listo ✓ Te hemos enviado un aviso de prueba." : `Avisos activados, pero el aviso de prueba no salió (${r.reason ?? "error"}).`);
    } catch (e) {
      setMsg(`No se pudieron activar los avisos: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
    setMsg(null);
    setBusy(false);
  }

  if (state === "loading" || state === "unsupported") return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-line bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <b className="block">🔔 Avisos en este móvil</b>
          <span className="text-muted">
            {state === "on"
              ? "Activados: te avisamos de clases canceladas y de tu abono."
              : state === "denied"
                ? "Los bloqueaste. Actívalos en los ajustes del navegador o del móvil para esta web."
                : state === "ios-install"
                  ? "En iPhone, primero instala la app (Compartir → «Añadir a pantalla de inicio») y ábrela desde el icono."
                  : (hint ?? "Clases canceladas, tu abono y recordatorios, al momento.")}
          </span>
        </span>
        {state === "off" && (
          <button type="button" disabled={busy} onClick={enable} className="h-10 rounded-xl bg-ink px-4 font-bold text-white disabled:opacity-40">
            {busy ? "…" : "Activar"}
          </button>
        )}
        {state === "on" && (
          <button type="button" disabled={busy} onClick={disable} className="text-xs text-muted underline">
            Desactivar
          </button>
        )}
      </div>
      {msg && <p className="font-semibold">{msg}</p>}
    </div>
  );
}
