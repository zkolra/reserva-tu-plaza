"use client";

import { useEffect, useState } from "react";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** «Instalar la app»: en Android/Chrome abre el diálogo; en iPhone explica cómo añadirla. */
export default function InstallApp({ label = "Instala la app en tu móvil", hint }: { label?: string; hint?: string }) {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as PromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || (!prompt && !ios)) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed border-line bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>
          <b className="block">📱 {label}</b>
          <span className="text-muted">{hint ?? "Ábrela como una app, sin buscar la web cada vez."}</span>
        </span>
        <button
          type="button"
          onClick={async () => {
            if (prompt) {
              await prompt.prompt();
              setPrompt(null);
            } else setShowIos(!showIos);
          }}
          className="h-10 rounded-xl bg-ink px-4 font-bold text-white"
        >
          Instalar
        </button>
      </div>
      {showIos && (
        <ol className="list-decimal pl-5 text-muted">
          <li>
            Abre esta página en <b>Safari</b>.
          </li>
          <li>
            Pulsa el botón <b>Compartir</b> (el cuadrado con la flecha ↑).
          </li>
          <li>
            Elige <b>«Añadir a pantalla de inicio»</b>.
          </li>
        </ol>
      )}
    </div>
  );
}
