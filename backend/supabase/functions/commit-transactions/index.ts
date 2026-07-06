import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ---------------------------------------------------------------------------
// Rule matching helper
// ---------------------------------------------------------------------------
interface Rule {
  id: string;
  match_field: "payee" | "memo" | "kind";
  match_op: "contains" | "equals" | "starts_with" | "regex";
  match_value: string;
  set_category_name: string | null;
  set_tags: string[];
  set_memo: string | null;
}

interface ParsedTx {
  occurred_at: string;
  amount: number;
  currency: string;
  kind: string;
  payee?: string;
  memo?: string;
  category?: string;
  tags?: string[];
}

function matchesRule(rule: Rule, tx: ParsedTx): boolean {
  const raw =
    rule.match_field === "payee" ? (tx.payee ?? "") :
    rule.match_field === "memo"  ? (tx.memo  ?? "") :
    rule.match_field === "kind"  ? (tx.kind  ?? "") : "";

  const val = raw.toLowerCase();
  const pat = rule.match_value.toLowerCase();

  switch (rule.match_op) {
    case "contains":    return val.includes(pat);
    case "equals":      return val === pat;
    case "starts_with": return val.startsWith(pat);
    case "regex": {
      try { return new RegExp(rule.match_value, "i").test(raw); }
      catch { return false; }
    }
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Core commit logic (exported so process-media can reuse it inline)
// ---------------------------------------------------------------------------
export async function commitIngestion(
  admin: SupabaseClient,
  userId: string,
  ingestionId: string,
  parsedTransactions: ParsedTx[],
): Promise<{ committed: number; duplicates: number; rulesApplied: number; transactions: unknown[] }> {
  // Load user rules (highest priority first)
  const { data: rules } = await admin
    .from("rules")
    .select("id, match_field, match_op, match_value, set_category_name, set_tags, set_memo")
    .eq("user_id", userId)
    .eq("active", true)
    .order("priority", { ascending: false });

  // Build category name → id map
  const { data: cats } = await admin
    .from("categories")
    .select("id, name")
    .eq("user_id", userId);

  const catMap = new Map<string, string>();
  for (const c of cats ?? []) {
    catMap.set(c.name.toLowerCase(), c.id);
  }

  const committed: unknown[] = [];
  let duplicates = 0;
  let rulesApplied = 0;

  for (const parsed of parsedTransactions) {
    // --- apply rules ---
    let categoryId: string | null = null;
    let finalTags = [...(parsed.tags ?? [])];
    let finalMemo = parsed.memo ?? null;
    let ruleHit = false;

    for (const rule of (rules ?? []) as Rule[]) {
      if (matchesRule(rule, parsed)) {
        if (rule.set_category_name) {
          const cid = catMap.get(rule.set_category_name.toLowerCase());
          if (cid) categoryId = cid;
        }
        if (rule.set_tags?.length) {
          finalTags = [...new Set([...finalTags, ...rule.set_tags])];
        }
        if (rule.set_memo) finalMemo = rule.set_memo;
        ruleHit = true;
        rulesApplied++;
        break; // first match wins
      }
    }

    // Fall back to AI-suggested category when no rule matched
    if (!categoryId && parsed.category) {
      const key = parsed.category.toLowerCase();
      // Tolerate "Group: Parent > Child" style paths from the model.
      const cid = catMap.get(key)
        ?? catMap.get(key.split(">").pop()!.trim())
        ?? catMap.get(key.split(":").pop()!.trim());
      if (cid) categoryId = cid;
    }

    // --- duplicate detection ---
    let duplicateGroupId: string | null = null;
    const { data: dupId } = await admin.rpc("find_duplicate", {
      p_user_id:     userId,
      p_payee:       parsed.payee ?? null,
      p_amount:      parsed.amount,
      p_occurred_at: parsed.occurred_at,
    });

    if (dupId) {
      duplicates++;
      const { data: existingTx } = await admin
        .from("transactions")
        .select("duplicate_group_id")
        .eq("id", dupId)
        .single();

      duplicateGroupId = existingTx?.duplicate_group_id ?? crypto.randomUUID();

      if (!existingTx?.duplicate_group_id) {
        await admin
          .from("transactions")
          .update({ duplicate_group_id: duplicateGroupId })
          .eq("id", dupId);
      }
    }

    // --- insert ---
    const { data: tx, error: txErr } = await admin
      .from("transactions")
      .insert({
        user_id:            userId,
        account_id:         null,   // assigned during review
        category_id:        categoryId,
        kind:               parsed.kind ?? "expense",
        occurred_at:        parsed.occurred_at,
        amount:             parsed.amount,
        currency:           parsed.currency ?? "USD",
        payee:              parsed.payee ?? null,
        memo:               finalMemo,
        tags:               finalTags,
        original_ai_data:   parsed,
        review_status:      "pending_review",
        ingestion_id:       ingestionId,
        duplicate_group_id: duplicateGroupId,
      })
      .select("id, review_status, duplicate_group_id, payee, amount, currency, occurred_at")
      .single();

    if (txErr) {
      console.error("insert tx error", txErr.message, "for parsed", JSON.stringify(parsed));
    } else if (tx) {
      committed.push(tx);
    }
  }

  // Mark ingestion applied
  await admin
    .from("media_ingestions")
    .update({ status: "applied" })
    .eq("id", ingestionId);

  return { committed: committed.length, duplicates, rulesApplied, transactions: committed };
}

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------
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

  const result = await commitIngestion(admin, userId, ingestion.id, parsedTxs);

  return c.json({ ingestionId: ingestion.id, ...result });
});

Deno.serve(app.fetch);
