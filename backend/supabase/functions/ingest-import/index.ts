// =============================================================================
// Sagebook · ingest-import Edge Function
// -----------------------------------------------------------------------------
// Deterministic statement imports (CSV/OFX parsed client-side — no LLM).
// Receives normalized transactions, records an ingestion for provenance, and
// pushes rows through the shared rules/dedup/commit pipeline into the review
// inbox. Unlike AI captures, imports may pre-assign the target account.
// =============================================================================

import { commitParsedTransactions, type ParsedTx } from "../_shared/commit.ts";
import { IMPORT_MAX_ROWS, isTransactionKind } from "../_shared/constants.ts";
import { createApp, ownsStoragePath, readJson, requireUser, serve } from "../_shared/http.ts";

interface ImportRequest {
  transactions: ParsedTx[];
  /** Account to file every row under (ownership verified). */
  accountId?: string | null;
  /** Optional archived copy of the statement in the ingest bucket. */
  storagePath?: string | null;
  filename?: string;
  /** Reuse an existing ingestion (chunked/batched imports share one record). */
  ingestionId?: string | null;
  /** Total rows across all batches — for the ingestion summary on batch 1. */
  totalRows?: number;
}

/** How many problems to report before giving up — enough to fix in one pass. */
const MAX_REPORTED_PROBLEMS = 10;

function validateTx(tx: ParsedTx, i: number): string | null {
  if (!tx || typeof tx !== "object") return `row ${i}: not an object`;
  if (Number.isNaN(Date.parse(tx.occurred_at))) return `row ${i}: bad occurred_at`;
  if (typeof tx.amount !== "number" || !(tx.amount > 0)) return `row ${i}: amount must be > 0`;
  if (typeof tx.currency !== "string" || tx.currency.trim().length !== 3) {
    return `row ${i}: currency must be a 3-letter code`;
  }
  if (!isTransactionKind(tx.kind)) return `row ${i}: bad kind '${tx.kind}'`;
  return null;
}

const app = createApp("ingest-import");

app.post("/ingest-import", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;

  const parsed = await readJson<ImportRequest>(c);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (!Array.isArray(body?.transactions) || !body.transactions.length) {
    return c.json({ error: "transactions must be a non-empty array" }, 400);
  }
  if (body.transactions.length > IMPORT_MAX_ROWS) {
    return c.json({ error: `too many rows (max ${IMPORT_MAX_ROWS} per import)` }, 400);
  }

  const problems: string[] = [];
  for (let i = 0; i < body.transactions.length; i++) {
    const problem = validateTx(body.transactions[i], i + 1);
    if (problem) problems.push(problem);
    if (problems.length >= MAX_REPORTED_PROBLEMS) break;
  }
  if (problems.length) {
    return c.json({ error: "invalid rows", problems }, 400);
  }

  // Verify the target account belongs to the caller.
  if (body.accountId) {
    const { data: account } = await auth.admin
      .from("accounts")
      .select("id")
      .eq("id", body.accountId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (!account) {
      return c.json({ error: "account not found" }, 404);
    }
  }

  if (body.storagePath && !ownsStoragePath(auth.userId, body.storagePath)) {
    return c.json({ error: "storagePath must be under your own folder" }, 403);
  }

  // Batched imports share a single ingestion record: batch 1 creates it and
  // returns its id; later batches pass ingestionId to reuse it.
  let ingestionId: string;
  if (body.ingestionId) {
    const { data: existing } = await auth.admin
      .from("media_ingestions")
      .select("id")
      .eq("id", body.ingestionId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (!existing) {
      return c.json({ error: "ingestion not found" }, 404);
    }
    ingestionId = body.ingestionId;
  } else {
    const total = body.totalRows ?? body.transactions.length;
    const { data: ingestion, error: ingErr } = await auth.admin
      .from("media_ingestions")
      .insert({
        user_id:      auth.userId,
        storage_path: body.storagePath ?? null,
        media_kind:   "text",
        mime_type:    "text/csv",
        bytes:        JSON.stringify(body.transactions).length,
        status:       "parsed",
        prompt_hint:  body.filename ?? "statement import",
        parsed_payload: {
          summary: `Imported ${total} rows from ${body.filename ?? "statement"}`,
          confidence: 1,
        },
        model: "deterministic-import",
      })
      .select("id")
      .single();
    if (ingErr || !ingestion) {
      return c.json({ error: "could not create ingestion", detail: ingErr?.message }, 500);
    }
    ingestionId = ingestion.id;
  }

  const result = await commitParsedTransactions(
    auth.admin, auth.userId, ingestionId, body.transactions,
    { accountId: body.accountId ?? null, markApplied: true },
  );

  return c.json({ ingestionId, ...result });
});

serve(app);
