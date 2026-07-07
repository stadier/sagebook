// =============================================================================
// Sagebook · ingest-import Edge Function
// -----------------------------------------------------------------------------
// Deterministic statement imports (CSV/OFX parsed client-side — no LLM).
// Receives normalized transactions, records an ingestion for provenance, and
// pushes rows through the shared rules/dedup/commit pipeline into the review
// inbox. Unlike AI captures, imports may pre-assign the target account.
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { commitParsedTransactions, type ParsedTx } from "../_shared/commit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_ROWS = 1000;
const KINDS = new Set(["income", "expense", "transfer", "adjustment"]);

interface ImportRequest {
  transactions: ParsedTx[];
  /** Account to file every row under (ownership verified). */
  accountId?: string | null;
  /** Optional archived copy of the statement in the ingest bucket. */
  storagePath?: string | null;
  filename?: string;
}

function validateTx(tx: ParsedTx, i: number): string | null {
  if (!tx || typeof tx !== "object") return `row ${i}: not an object`;
  if (Number.isNaN(Date.parse(tx.occurred_at))) return `row ${i}: bad occurred_at`;
  if (typeof tx.amount !== "number" || !(tx.amount > 0)) return `row ${i}: amount must be > 0`;
  if (typeof tx.currency !== "string" || tx.currency.trim().length !== 3) {
    return `row ${i}: currency must be a 3-letter code`;
  }
  if (!KINDS.has(tx.kind)) return `row ${i}: bad kind '${tx.kind}'`;
  return null;
}

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "x-client-info", "apikey"],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

app.post("/ingest-import", async (c) => {
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

  let body: ImportRequest;
  try {
    body = await c.req.json<ImportRequest>();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }

  if (!Array.isArray(body?.transactions) || !body.transactions.length) {
    return c.json({ error: "transactions must be a non-empty array" }, 400);
  }
  if (body.transactions.length > MAX_ROWS) {
    return c.json({ error: `too many rows (max ${MAX_ROWS} per import)` }, 400);
  }

  const problems: string[] = [];
  for (let i = 0; i < body.transactions.length; i++) {
    const problem = validateTx(body.transactions[i], i + 1);
    if (problem) problems.push(problem);
    if (problems.length >= 10) break;
  }
  if (problems.length) {
    return c.json({ error: "invalid rows", problems }, 400);
  }

  // Verify the target account belongs to the caller.
  if (body.accountId) {
    const { data: account } = await admin
      .from("accounts")
      .select("id")
      .eq("id", body.accountId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!account) {
      return c.json({ error: "account not found" }, 404);
    }
  }

  if (body.storagePath && !body.storagePath.startsWith(`${userId}/`)) {
    return c.json({ error: "storagePath must be under your own folder" }, 403);
  }

  const { data: ingestion, error: ingErr } = await admin
    .from("media_ingestions")
    .insert({
      user_id:      userId,
      storage_path: body.storagePath ?? null,
      media_kind:   "text",
      mime_type:    "text/csv",
      bytes:        JSON.stringify(body.transactions).length,
      status:       "parsed",
      prompt_hint:  body.filename ?? "statement import",
      parsed_payload: {
        summary: `Imported ${body.transactions.length} rows from ${body.filename ?? "statement"}`,
        transactions: body.transactions,
        confidence: 1,
      },
      model: "deterministic-import",
    })
    .select("id")
    .single();

  if (ingErr || !ingestion) {
    return c.json({ error: "could not create ingestion", detail: ingErr?.message }, 500);
  }

  const result = await commitParsedTransactions(
    admin, userId, ingestion.id, body.transactions,
    { accountId: body.accountId ?? null, markApplied: true },
  );

  return c.json({ ingestionId: ingestion.id, ...result });
});

Deno.serve((req) => app.fetch(req));
