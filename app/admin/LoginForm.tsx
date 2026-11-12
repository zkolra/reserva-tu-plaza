"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";

export default function LoginForm({ sb }: { sb: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href.split("#")[0], shouldCreateUser: true },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="mx-auto w-full max-w-md px-6 py-20">
      <h1 className="font-display text-3xl font-bold">Panel del estudio</h1>
      {sent ? (
        <p className="mt-6 rounded-xl bg-white p-4 leading-relaxed">
          Te hemos enviado un enlace a <b>{email}</b>. Ábrelo en este dispositivo para entrar.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label htmlFor="admin-email" className="text-sm font-bold">
            Tu email
          </label>
          <input
            id="admin-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-ink"
          />
          <button type="submit" disabled={busy} className="h-13 rounded-2xl bg-accent font-bold text-white disabled:opacity-40">
            {busy ? "Enviando…" : "Enviarme el enlace"}
          </button>
          {error && <p className="text-sm font-semibold text-accent">{error}</p>}
        </form>
      )}
    </main>
  );
}
