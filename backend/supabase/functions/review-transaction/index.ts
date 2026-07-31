// =============================================================================
// Sagebook · review-transaction Edge Function
// -----------------------------------------------------------------------------
// The inbox's write endpoint: accept, reject or edit a pending row, merge a
// duplicate pair into one, or unlink a pair the dedup pass got wrong. A bulk
// route handles accept/reject over a selection.
// =============================================================================

import {
  BULK_REVIEW_ACTIONS,
  PATCHABLE_FIELDS,
  REVIEW_ACTIONS,
  type ReviewAction,
} from "../_shared/constants.ts";
import type { Context } from "../_shared/deps.ts";
import { type AuthedRequest, createApp, readJson, requireUser, serve } from "../_shared/http.ts";

interface ReviewRequest {
  transactionId: string;
  action: ReviewAction;
  patch?: Record<string, unknown>;
}

interface BulkRequest {
  transactionIds: string[];
  action: (typeof BULK_REVIEW_ACTIONS)[number];
}

/** A capture's stored media, carried along when two rows are merged. */
interface MediaAttachment {
  ingestion_id: string;
  storage_path: string;
  media_kind: string;
  mime_type: string;
}

/**
 * The row shape both sides of a merge need. Declared rather than inferred:
 * PostgREST's generated types can't see through an embedded relation here, so
 * the read is cast to this and the fields are named once.
 */
interface ReviewableRow {
  id: string;
  user_id: string;
  review_status: string;
  duplicate_group_id: string | null;
  original_ai_data: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ingestion_id: string | null;
  media_ingestions: {
    storage_path: string | null;
    media_kind: string;
    mime_type: string;
  } | null;
}

/** Columns the merge path needs from both sides of the pair. */
const MERGE_COLUMNS =
  "id, user_id, review_status, duplicate_group_id, original_ai_data, metadata, ingestion_id, " +
  "media_ingestions(storage_path, media_kind, mime_type)";

/** Keep only the fields a reviewer is allowed to change. */
function allowedPatch(patch: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (PATCHABLE_FIELDS.has(key)) out[key] = value;
  }
  return out;
}

const app = createApp("review-transaction");

app.post("/review-transaction", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;

  const parsed = await readJson<ReviewRequest>(c);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (!body?.transactionId || !body?.action) {
    return c.json({ error: "transactionId and action required" }, 400);
  }
  if (!REVIEW_ACTIONS.includes(body.action)) {
    return c.json({ error: `action must be ${REVIEW_ACTIONS.join(" | ")}` }, 400);
  }

  const { data, error: fetchErr } = await auth.admin
    .from("transactions")
    .select(MERGE_COLUMNS)
    .eq("id", body.transactionId)
    .eq("user_id", auth.userId)
    .single();

  if (fetchErr || !data) {
    return c.json({ error: "transaction not found" }, 404);
  }
  const existing = data as unknown as ReviewableRow;

  if (body.action === "unlink") return unlink(c, auth, body.transactionId, existing);
  if (body.action === "merge") return merge(c, auth, body, existing);

  // --- Standard accept / reject / edit ---
  const { data: updated, error: updateErr } = await auth.admin
    .from("transactions")
    .update({
      review_status: body.action === "reject" ? "rejected" : "accepted",
      reviewed_at: new Date().toISOString(),
      ...(body.action === "edit" ? allowedPatch(body.patch) : {}),
    })
    .eq("id", body.transactionId)
    .select("*")
    .single();

  if (updateErr) {
    return c.json({ error: "update failed", detail: updateErr.message }, 500);
  }
  return c.json({ transaction: updated });
});

app.post("/review-transaction/bulk", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;

  const parsed = await readJson<BulkRequest>(c);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (!Array.isArray(body?.transactionIds) || !body.transactionIds.length) {
    return c.json({ error: "transactionIds must be a non-empty array" }, 400);
  }
  if (!BULK_REVIEW_ACTIONS.includes(body.action)) {
    return c.json({ error: `action must be ${BULK_REVIEW_ACTIONS.join(" | ")}` }, 400);
  }

  const { data: updated, error } = await auth.admin
    .from("transactions")
    .update({
      review_status: body.action === "reject" ? "rejected" : "accepted",
      reviewed_at: new Date().toISOString(),
    })
    .in("id", body.transactionIds)
    .eq("user_id", auth.userId)
    .select("id, review_status");

  if (error) {
    return c.json({ error: "bulk update failed", detail: error.message }, 500);
  }
  return c.json({ updated: updated?.length ?? 0, transactions: updated });
});

/* -------------------------------------------------------------------------- */
/*  Actions                                                                    */
/* -------------------------------------------------------------------------- */

/** Break a row out of its duplicate group, dissolving the group if only one
 *  sibling would remain — a group of one is not a duplicate. */
async function unlink(
  c: Context,
  auth: AuthedRequest,
  transactionId: string,
  existing: ReviewableRow,
): Promise<Response> {
  const { data: updated, error } = await auth.admin
    .from("transactions")
    .update({ duplicate_group_id: null })
    .eq("id", transactionId)
    .select("*")
    .single();

  if (error) {
    return c.json({ error: "unlink failed", detail: error.message }, 500);
  }

  if (existing.duplicate_group_id) {
    const { data: siblings } = await auth.admin
      .from("transactions")
      .select("id")
      .eq("duplicate_group_id", existing.duplicate_group_id)
      .neq("id", transactionId);

    if (siblings?.length === 1) {
      await auth.admin
        .from("transactions")
        .update({ duplicate_group_id: null })
        .eq("id", siblings[0].id);
    }
  }

  return c.json({ transaction: updated });
}

/**
 * Fold a duplicate into its primary: the primary keeps its own fields, absorbs
 * whatever the secondary uniquely had (line items, references, receipt media),
 * is accepted, and the secondary is rejected.
 */
async function merge(
  c: Context,
  auth: AuthedRequest,
  body: ReviewRequest,
  existing: ReviewableRow,
): Promise<Response> {
  const secondaryId = body.patch?.secondary_id as string | undefined;
  if (!secondaryId) {
    return c.json({ error: "merge requires patch.secondary_id" }, 400);
  }

  const { data, error: secErr } = await auth.admin
    .from("transactions")
    .select(MERGE_COLUMNS)
    .eq("id", secondaryId)
    .eq("user_id", auth.userId)
    .single();

  if (secErr || !data) {
    return c.json({ error: "secondary transaction not found" }, 404);
  }
  const secondary = data as unknown as ReviewableRow;

  const primaryAi = existing.original_ai_data ?? {};
  const secondaryAi = secondary.original_ai_data ?? {};
  const primaryMeta = existing.metadata ?? {};
  const secondaryMeta = secondary.metadata ?? {};

  // Line items: keep whichever side actually has them.
  const mergedLineItems = (primaryAi.line_items as unknown[] | undefined)?.length
    ? primaryAi.line_items
    : secondaryAi.line_items ?? null;

  // References: the union of both sides, deduplicated.
  const refs = new Set<string>();
  for (const src of [primaryMeta, secondaryMeta]) {
    const single = src.reference as string | undefined;
    if (single) refs.add(single);
    for (const value of (src.references as string[] | undefined) ?? []) refs.add(value);
  }

  // Media: both receipts stay reachable after the merge.
  const attachments = [...((primaryMeta.media_attachments ?? []) as MediaAttachment[])];
  const secMedia = secondary.media_ingestions;
  if (
    secMedia?.storage_path &&
    secondary.ingestion_id &&
    !attachments.some((a) => a.ingestion_id === secondary.ingestion_id)
  ) {
    attachments.push({
      ingestion_id: secondary.ingestion_id,
      storage_path: secMedia.storage_path,
      media_kind: secMedia.media_kind,
      mime_type: secMedia.mime_type,
    });
  }

  const mergedMeta: Record<string, unknown> = {
    ...primaryMeta,
    ...secondaryMeta,
    references: refs.size > 0 ? [...refs] : undefined,
    media_attachments: attachments.length > 0 ? attachments : undefined,
  };
  // Superseded by the merged `references` array above.
  delete mergedMeta.reference;

  const now = new Date().toISOString();

  const { data: updated, error: mergeErr } = await auth.admin
    .from("transactions")
    .update({
      review_status: "accepted",
      reviewed_at: now,
      // Primary's own extraction wins field-by-field; the secondary only fills gaps.
      original_ai_data: { ...secondaryAi, ...primaryAi, line_items: mergedLineItems },
      metadata: mergedMeta,
      ...allowedPatch(body.patch),
    })
    .eq("id", body.transactionId)
    .select("*")
    .single();

  if (mergeErr) {
    return c.json({ error: "merge primary update failed", detail: mergeErr.message }, 500);
  }

  await auth.admin
    .from("transactions")
    .update({ review_status: "rejected", reviewed_at: now })
    .eq("id", secondaryId);

  return c.json({ transaction: updated });
}

serve(app);
