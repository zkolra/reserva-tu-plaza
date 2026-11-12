import type { SupabaseConfig } from "./useAccount";

/** Se lee en cada petición: en Cloudflare las variables llegan en tiempo de ejecución. */
export function supabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? { url, key } : null;
}
