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

  if (!["accept", "reject", "edit"].includes(body.action)) {
    return c.json({ error: "action must be accept | reject | edit" }, 400);
  }

  // Verify ownership
  const { data: existing, error: fetchErr } = await admin
    .from("transactions")
    .select("id, user_id, review_status")
    .eq("id", body.transactionId)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !existing) {
    return c.json({ error: "transaction not found" }, 404);
  }

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
