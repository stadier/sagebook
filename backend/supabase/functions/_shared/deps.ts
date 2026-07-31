// =============================================================================
// Sagebook · Edge function dependencies
// -----------------------------------------------------------------------------
// Every third-party import for the functions goes through this file. Deno pins
// versions in the URL, so without a single re-export point a dependency bump
// means editing the same URL in eight places — and a missed one silently ships
// two copies of Hono into the same deployment.
//
// Add a dependency here first, then import it from "../_shared/deps.ts".
// =============================================================================

export { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
export type { Context } from "https://deno.land/x/hono@v4.3.11/mod.ts";
export { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";

export { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
export type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
