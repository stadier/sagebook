// =============================================================================
// Sagebook · Edge function environment
// -----------------------------------------------------------------------------
// Reads and validates the secrets the functions need. Supabase injects
// SUPABASE_SERVICE_ROLE_KEY, but self-hosted and local setups often set
// SUPABASE_SERVICE_KEY instead; that fallback used to be repeated verbatim in
// every function. Resolve it once here.
// =============================================================================

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

/** Secret for the inbound email webhook. Empty means "reject everything". */
export const INGEST_WEBHOOK_SECRET = Deno.env.get("INGEST_WEBHOOK_SECRET") ?? "";

/**
 * Warn once at cold start if the Supabase credentials are missing. Called by
 * `createApp`, so a misconfigured deployment says so in the logs on boot
 * rather than only when the first request fails.
 */
export function warnIfMisconfigured(fnName: string): void {
  const missing = [
    !SUPABASE_URL && "SUPABASE_URL",
    !SUPABASE_ANON_KEY && "SUPABASE_ANON_KEY",
    !SUPABASE_SERVICE_KEY && "SUPABASE_SERVICE_KEY",
  ].filter(Boolean);

  if (missing.length) {
    console.warn(`[${fnName}] missing env: ${missing.join(", ")}; runtime calls will fail.`);
  }
}
