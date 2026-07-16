import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Fields that a reviewer is allowed to patch
const PATCHABLE_FIELDS = new Set([
  "amount",
  "currency",
  "occurred_at",
  "payee",
  "memo",
  "category_id",
  "account_id",
  "tags",
  "kind",
]);

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "x-client-info", "apikey"],
    allowMethods: ["POST", "OPTIONS"],
  }),
);

app.post("/review-transaction", async (c) => {
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

  let body: { transactionId: string; action: string; patch?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }

  if (!body?.transactionId || !body?.action) {
    return c.json({ error: "transactionId and action required" }, 400);
  }

  if (!["accept", "reject", "edit", "merge", "unlink"].includes(body.action)) {
    return c.json({ error: "action must be accept | reject | edit | merge | unlink" }, 400);
  }

  // Verify ownership
  const { data: existing, error: fetchErr } = await admin
    .from("transactions")
    .select("id, user_id, review_status, duplicate_group_id, original_ai_data, metadata, ingestion_id, media_ingestions(storage_path, media_kind, mime_type)")
    .eq("id", body.transactionId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !existing) {
    return c.json({ error: "transaction not found" }, 404);
  }

  // --- Unlink: clear duplicate_group_id ---
  if (body.action === "unlink") {
    const { data: updated, error: unlinkErr } = await admin
      .from("transactions")
      .update({ duplicate_group_id: null })
      .eq("id", body.transactionId)
      .select("*")
      .single();

    if (unlinkErr) {
      return c.json({ error: "unlink failed", detail: unlinkErr.message }, 500);
    }

    // If no other transaction shares this group, clear the orphan's group too
    if (existing.duplicate_group_id) {
      const { data: siblings } = await admin
        .from("transactions")
        .select("id")
        .eq("duplicate_group_id", existing.duplicate_group_id)
        .neq("id", body.transactionId);

      if (siblings?.length === 1) {
        await admin
          .from("transactions")
          .update({ duplicate_group_id: null })
          .eq("id", siblings[0].id);
      }
    }

    return c.json({ transaction: updated });
  }

  // --- Merge: absorb secondary into primary, reject secondary ---
  if (body.action === "merge") {
    const secondaryId = body.patch?.secondary_id as string | undefined;
    if (!secondaryId) {
      return c.json({ error: "merge requires patch.secondary_id" }, 400);
    }

    const { data: secondary, error: secErr } = await admin
      .from("transactions")
      .select("id, user_id, original_ai_data, metadata, payee, memo, ingestion_id, media_ingestions(storage_path, media_kind, mime_type)")
      .eq("id", secondaryId)
      .eq("user_id", userId)
      .single();

    if (secErr || !secondary) {
      return c.json({ error: "secondary transaction not found" }, 404);
    }

    const primaryAi = (existing.original_ai_data ?? {}) as Record<string, unknown>;
    const secondaryAi = (secondary.original_ai_data ?? {}) as Record<string, unknown>;
    const primaryMeta = (existing.metadata ?? {}) as Record<string, unknown>;
    const secondaryMeta = (secondary.metadata ?? {}) as Record<string, unknown>;

    // Merge line items: keep whichever side has them
    const mergedLineItems =
      (primaryAi.line_items as unknown[] | undefined)?.length
        ? primaryAi.line_items
        : secondaryAi.line_items ?? null;

    // Merge references: collect all unique references
    const refs = new Set<string>();
    for (const src of [primaryMeta, secondaryMeta]) {
      const r = src.reference as string | undefined;
      if (r) refs.add(r);
      const rs = src.references as string[] | undefined;
      if (rs) for (const v of rs) refs.add(v);
    }
    const mergedRefs = [...refs];

    // Collect media attachments from both sides so both receipt images stay accessible
    interface MediaAttachment { ingestion_id: string; storage_path: string; media_kind: string; mime_type: string }
    const existingAttachments = (primaryMeta.media_attachments ?? []) as MediaAttachment[];
    const allAttachments = [...existingAttachments];

    const secMedia = (secondary as Record<string, unknown>).media_ingestions as
      { storage_path: string | null; media_kind: string; mime_type: string } | null;
    if (secMedia?.storage_path && secondary.ingestion_id) {
      const already = allAttachments.some((a) => a.ingestion_id === secondary.ingestion_id);
      if (!already) {
        allAttachments.push({
          ingestion_id: secondary.ingestion_id,
          storage_path: secMedia.storage_path,
          media_kind: secMedia.media_kind,
          mime_type: secMedia.mime_type,
        });
      }
    }

    const mergedMeta = {
      ...primaryMeta,
      ...secondaryMeta,
      references: mergedRefs.length > 0 ? mergedRefs : undefined,
      media_attachments: allAttachments.length > 0 ? allAttachments : undefined,
    };
    delete mergedMeta.reference;

    const mergedAi = {
      ...secondaryAi,
      ...primaryAi,
      line_items: mergedLineItems,
    };

    // Apply user-chosen field overrides from patch
    const fieldPatch: Record<string, unknown> = {};
    if (body.patch) {
      for (const [key, val] of Object.entries(body.patch)) {
        if (key !== "secondary_id" && PATCHABLE_FIELDS.has(key)) {
          fieldPatch[key] = val;
        }
      }
    }

    const now = new Date().toISOString();

    const { data: updated, error: mergeErr } = await admin
      .from("transactions")
      .update({
        review_status: "accepted",
        reviewed_at: now,
        original_ai_data: mergedAi,
        metadata: mergedMeta,
        ...fieldPatch,
      })
      .eq("id", body.transactionId)
      .select("*")
      .single();

    if (mergeErr) {
      return c.json({ error: "merge primary update failed", detail: mergeErr.message }, 500);
    }

    await admin
      .from("transactions")
      .update({ review_status: "rejected", reviewed_at: now })
      .eq("id", secondaryId);

    return c.json({ transaction: updated });
  }

  // --- Standard accept / reject / edit ---
  const updatePayload: Record<string, unknown> = {
    review_status: body.action === "reject" ? "rejected" : "accepted",
    reviewed_at: new Date().toISOString(),
  };

  if (body.action === "edit" && body.patch) {
    for (const [key, val] of Object.entries(body.patch)) {
      if (PATCHABLE_FIELDS.has(key)) {
        updatePayload[key] = val;
      }
    }
  }

  const { data: updated, error: updateErr } = await admin
    .from("transactions")
    .update(updatePayload)
    .eq("id", body.transactionId)
    .select("*")
    .single();

  if (updateErr) {
    return c.json({ error: "update failed", detail: updateErr.message }, 500);
  }

  return c.json({ transaction: updated });
});

// Bulk accept/reject endpoint
app.post("/review-transaction/bulk", async (c) => {
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

  let body: { transactionIds: string[]; action: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "body must be JSON" }, 400);
  }

  if (!Array.isArray(body?.transactionIds) || !body.transactionIds.length) {
    return c.json({ error: "transactionIds must be a non-empty array" }, 400);
  }

  if (!["accept", "reject"].includes(body.action)) {
    return c.json({ error: "action must be accept | reject" }, 400);
  }

  const { data: updated, error } = await admin
    .from("transactions")
    .update({
      review_status: body.action === "reject" ? "rejected" : "accepted",
      reviewed_at: new Date().toISOString(),
    })
    .in("id", body.transactionIds)
    .eq("user_id", userId)
    .select("id, review_status");

  if (error) {
    return c.json({ error: "bulk update failed", detail: error.message }, 500);
  }

  return c.json({ updated: updated?.length ?? 0, transactions: updated });
});

Deno.serve(app.fetch);
