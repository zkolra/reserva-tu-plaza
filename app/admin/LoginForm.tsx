"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";

/** Entrar al panel: con contraseña (el navegador puede guardarla) o con enlace por email. */
export default function LoginForm({ sb }: { sb: SupabaseClient }) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (mode === "password") {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "Email o contraseña incorrectos. Si todavía no tienes contraseña, entra con el enlace por email y créala en Ajustes."
            : error.message,
        );
      }
      return;
    }
    const { error } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href.split("#")[0], shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(
        error.message.includes("rate limit")
          ? "Se han enviado demasiados emails en poco tiempo. Prueba de nuevo en una hora o entra con contraseña."
          : error.message,
      );
    } else setSent(true);
  }

  return (
    <main className="mx-auto w-full max-w-md px-6 py-20">
      <h1 className="font-display text-3xl font-bold">Panel del estudio</h1>

      <div className="mt-6 inline-flex gap-1 rounded-2xl bg-white p-1" role="group" aria-label="Cómo entrar">
        {(
          [
            ["password", "Con contraseña"],
            ["link", "Enlace por email"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setError(null);
              setSent(false);
            }}
            className={`h-10 rounded-xl px-4 text-sm font-bold ${mode === value ? "bg-ink text-white" : "text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {sent ? (
        <p className="mt-6 rounded-xl bg-white p-4 leading-relaxed">
          Te hemos enviado un enlace a <b>{email}</b>. Ábrelo en este dispositivo para entrar.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-3">
          <label htmlFor="admin-email" className="text-sm font-bold">
            Email
          </label>
          <input
            id="admin-email"
            name="email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-ink"
          />
          {mode === "password" && (
            <>
              <label htmlFor="admin-password" className="text-sm font-bold">
                Contraseña
              </label>
              <input
                id="admin-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 rounded-xl border border-line bg-white px-3 text-base outline-none focus:border-ink"
              />
            </>
          )}
          <button type="submit" disabled={busy} className="h-13 rounded-2xl bg-accent font-bold text-on-accent disabled:opacity-40">
            {busy ? "Un momento…" : mode === "password" ? "Entrar" : "Enviarme el enlace"}
          </button>
          {error && <p className="text-sm font-semibold text-accent-text">{error}</p>}
        </form>
      )}
    </main>
  );
}
