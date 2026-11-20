"use client";

import { useEffect } from "react";

/** Registra el service worker: hace la web instalable como app y recibirá los avisos push. */
export default function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
