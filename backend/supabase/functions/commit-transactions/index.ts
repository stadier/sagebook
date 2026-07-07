// =============================================================================
// Sagebook · commit-transactions Edge Function
// -----------------------------------------------------------------------------
// Re-commits a previously parsed ingestion into the review inbox. The actual
// rules/dedup/insert pipeline lives in ../_shared/commit.ts.
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { commitParsedTransactions, type ParsedTx } from "../_shared/commit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "x-client-info", "apikey"],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

app.post("/commit-transactions", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return c.json({ error: "missing bearer token" }, 401);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return c.json({ error: "invalid session" }, 401);
  }
  const userId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: { ingestionId: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }

  if (!body?.ingestionId) {
    return c.json({ error: "ingestionId required" }, 400);
  }

  // Fetch ingestion (ownership verified by user_id filter)
  const { data: ingestion, error: ingErr } = await admin
    .from("media_ingestions")
    .select("id, user_id, parsed_payload, status")
    .eq("id", body.ingestionId)
    .eq("user_id", userId)
    .single();

  if (ingErr || !ingestion) {
    return c.json({ error: "ingestion not found" }, 404);
  }

  const parsedTxs: ParsedTx[] = ingestion.parsed_payload?.transactions ?? [];
  if (!parsedTxs.length) {
    return c.json({ error: "no parsed transactions in this ingestion" }, 400);
  }

  const result = await commitParsedTransactions(admin, userId, ingestion.id, parsedTxs, {
    markApplied: true,
  });

  return c.json({ ingestionId: ingestion.id, ...result });
});

Deno.serve(app.fetch);
