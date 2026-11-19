"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";

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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setBusy(true);
    const { error } = await sb.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else {
      setPassword("");
      setMsg("Contraseña guardada ✓ La próxima vez entra con tu email y esta contraseña.");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-3xl bg-white p-5">
      <div>
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <p className="mt-1 text-sm text-muted">{text}</p>
      </div>
      {/* El navegador asocia la contraseña a este email al guardarla */}
      <input type="email" name="email" autoComplete="username" value={email ?? ""} readOnly hidden />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-bold text-muted">Nueva contraseña (mín. 8)</span>
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-64 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-ink"
          />
        </label>
        <button type="submit" disabled={busy} className="h-11 rounded-xl bg-ink px-4 text-sm font-bold text-white disabled:opacity-40">
          {busy ? "Guardando…" : "Guardar contraseña"}
        </button>
      </div>
      {msg && <p className="text-sm font-semibold text-ok-text">{msg}</p>}
      {error && <p className="rounded-xl bg-accent-soft px-4 py-3 text-sm font-semibold text-accent-text">{error}</p>}
    </form>
  );
}
