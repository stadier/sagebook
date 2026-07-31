// =============================================================================
// Sagebook · commit-transactions Edge Function
// -----------------------------------------------------------------------------
// Re-commits a previously parsed ingestion into the review inbox. The actual
// rules/dedup/insert pipeline lives in ../_shared/commit.ts.
// =============================================================================

import { commitParsedTransactions, type ParsedTx } from "../_shared/commit.ts";
import { createApp, readJson, requireUser, serve } from "../_shared/http.ts";

interface CommitRequest {
  ingestionId: string;
}

const app = createApp("commit-transactions");

app.post("/commit-transactions", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;

  const parsed = await readJson<CommitRequest>(c);
  if (!parsed.ok) return parsed.response;

  const { ingestionId } = parsed.body;
  if (!ingestionId) {
    return c.json({ error: "ingestionId required" }, 400);
  }

  // Ownership is enforced by the user_id filter — admin bypasses RLS.
  const { data: ingestion, error } = await auth.admin
    .from("media_ingestions")
    .select("id, user_id, parsed_payload, status")
    .eq("id", ingestionId)
    .eq("user_id", auth.userId)
    .single();

  if (error || !ingestion) {
    return c.json({ error: "ingestion not found" }, 404);
  }

  const parsedTxs: ParsedTx[] = ingestion.parsed_payload?.transactions ?? [];
  if (!parsedTxs.length) {
    return c.json({ error: "no parsed transactions in this ingestion" }, 400);
  }

  const result = await commitParsedTransactions(
    auth.admin,
    auth.userId,
    ingestion.id,
    parsedTxs,
    { markApplied: true },
  );

  return c.json({ ingestionId: ingestion.id, ...result });
});

serve(app);
