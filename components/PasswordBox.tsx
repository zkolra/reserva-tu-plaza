"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

/** Crear o cambiar la contraseña de la cuenta (después de entrar con el enlace del email). */
export default function PasswordBox({
  sb,
  email,
  title = "Tu contraseña",
  text = "Para entrar con email y contraseña, sin esperar el enlace. Tu navegador puede guardarla.",
}: {
  sb: SupabaseClient;
  email?: string | null;
  title?: string;
  text?: string;
}) {
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  // La contraseña no se puede leer (se guarda cifrada); solo sabemos si ya existe
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    sb.auth.getUser().then(({ data }) => setHasPassword(!!data.user?.user_metadata?.has_password));
  }, [sb]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password, data: { has_password: true } });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setPassword("");
      setHasPassword(true);
      setEditing(false);
      setMsg("Contraseña guardada ✓ La próxima vez entra con tu email y esta contraseña.");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-3xl bg-white p-5">
      <div>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{text}</p>
        {hasPassword === false && !msg && (
          <p className="mt-2 text-sm">
            <b>Todavía no tienes contraseña</b> (o la creaste antes de esta versión: guárdala otra vez y quedará marcada).
          </p>
        )}
      </div>
      {hasPassword && !editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-semibold text-ok-text">Ya tienes contraseña ✓</span>
          <button type="button" onClick={() => setEditing(true)} className="text-sm font-bold underline">
            Cambiarla
          </button>
          <span className="w-full text-xs text-muted">
            Por seguridad la contraseña se guarda cifrada: nadie puede verla, ni tú, ni la escuela. Si tu navegador la guardó, la ves en
            su gestor de contraseñas (Chrome: Ajustes → Contraseñas). Si la olvidas, entra con el enlace por email y pon otra.
          </span>
        </div>
      ) : (
        <>
          {/* El navegador asocia la contraseña a este email al guardarla */}
          <input type="email" name="email" autoComplete="username" value={email ?? ""} readOnly hidden />
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-muted">{hasPassword ? "Nueva contraseña (mín. 8)" : "Contraseña (mín. 8)"}</span>
              <span className="relative">
                <input
                  type={show ? "text" : "password"}
                  name="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-64 rounded-xl border border-line bg-white pl-3 pr-11 text-sm outline-none focus:border-ink"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label={show ? "Ocultar contraseña" : "Ver contraseña"}
                  aria-pressed={show}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted hover:text-ink"
                >
                  {show ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7a13 13 0 01-3.2 4.3M6.1 6.1A13 13 0 002 12c1 2.5 5 7 10 7a9.7 9.7 0 004.1-.9" /></svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
                  )}
                </button>
              </span>
            </label>
            <button type="submit" disabled={busy} className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-40">
              {busy ? "Guardando…" : "Guardar contraseña"}
            </button>
            {editing && (
              <button type="button" onClick={() => setEditing(false)} className="h-11 px-2 text-sm font-bold underline">
                Cancelar
              </button>
            )}
          </div>
        </>
      )}
      {msg && <p className="text-sm font-semibold text-ok-text">{msg}</p>}
      {error && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-text">{error}</p>}
    </form>
  );
}
