"use client";

import { useEffect, useMemo, useState } from "react";
import { getBrowserClient, type SupabaseConfig } from "./useAccount";

/** Sesión actual (enlace por email) para el panel del estudio. */
export function useSession(cfg: SupabaseConfig) {
  const sb = useMemo(() => (cfg ? getBrowserClient(cfg) : null), [cfg]);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
      setEmail(data.session?.user.email ?? null);
      setReady(true);
      if (window.location.hash.includes("access_token")) {
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [sb]);

  return { sb, userId, email, ready: ready || !sb };
}
