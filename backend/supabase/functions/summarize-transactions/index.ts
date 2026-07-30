// =============================================================================
// Sagebook · summarize-transactions Edge Function
// -----------------------------------------------------------------------------
// Fills in the plain-language `summary` on transactions that do not have one.
//
// Deliberately shaped as "drain the backlog" rather than "summarize what I just
// imported": every write path (AI capture, statement import, manual entry)
// leaves summary null, and this one endpoint catches up whatever is outstanding.
// That makes it idempotent and safely re-runnable — a failed or partial run just
// leaves rows for the next call.
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
    SUMMARY_BATCH,
    type SummarizableTx,
    summarizeBatch,
} from "../_shared/summarize.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")         ?? "";
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")    ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")
                          ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** Rows per request. The client loops until the backlog is empty, so this is a
 *  latency budget per call, not a ceiling on how much can be summarized. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT     = 300;

interface SummarizeRequest {
    /** Summarize these specific rows (used by "regenerate"). */
    ids?: string[];
    /** Otherwise: how many un-summarized rows to drain this call. */
    limit?: number;
    /** Redo rows that already have a summary. Never touches hand-edited ones. */
    force?: boolean;
}

const app = new Hono();

app.use("*", cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "x-client-info", "apikey"],
    allowMethods: ["POST", "OPTIONS"],
}));

app.post("/summarize-transactions", async (c) => {
    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return c.json({ error: "missing bearer token" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
        return c.json({ error: "invalid session" }, 401);
    }
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: SummarizeRequest = {};
    try {
        body = await c.req.json<SummarizeRequest>();
    } catch {
        // An empty body means "drain the default number of rows".
    }

    const limit = Math.min(Math.max(Number(body.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Always scope by user_id: the service-role client bypasses RLS.
    let query = admin
        .from("transactions")
        .select("id, kind, amount, currency, occurred_at, payee, memo, metadata, category_id, account_id, summary_model")
        .eq("user_id", userId)
        .neq("review_status", "rejected");

    if (body.ids?.length) {
        query = query.in("id", body.ids.slice(0, MAX_LIMIT));
    } else if (!body.force) {
        query = query.is("summary", null);
    }

    const { data: rows, error: rowsErr } = await query
        .order("occurred_at", { ascending: false })
        .limit(limit);

    if (rowsErr) {
        return c.json({ error: "could not load transactions", detail: rowsErr.message }, 500);
    }

    // A summary the user wrote themselves is theirs; regeneration never
    // overwrites it, even when explicitly forced or named by id.
    const targets = (rows ?? []).filter((r) => r.summary_model !== "user");
    if (!targets.length) {
        return c.json({ summarized: 0, failed: 0, remaining: await backlog(admin, userId), model: null });
    }

    // Resolve the human-readable names the prompt reads better with.
    const [{ data: cats }, { data: accounts }] = await Promise.all([
        admin.from("categories").select("id, name").eq("user_id", userId),
        admin.from("accounts").select("id, name").eq("user_id", userId),
    ]);
    const catName  = new Map((cats ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));
    const acctName = new Map((accounts ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));

    const batches: SummarizableTx[][] = [];
    for (let i = 0; i < targets.length; i += SUMMARY_BATCH) {
        batches.push(targets.slice(i, i + SUMMARY_BATCH).map((r) => ({
            id:          r.id,
            kind:        r.kind,
            amount:      Number(r.amount),
            currency:    r.currency,
            occurred_at: r.occurred_at,
            payee:       r.payee,
            memo:        r.memo,
            reference:   (r.metadata as { reference?: string } | null)?.reference ?? null,
            category:    r.category_id ? catName.get(r.category_id) ?? null : null,
            account:     r.account_id  ? acctName.get(r.account_id) ?? null : null,
        })));
    }

    let summarized = 0;
    let failed = 0;
    let model: string | null = null;
    const errors: string[] = [];

    // Batches run in sequence: a partial run still commits what it finished, and
    // the provider is not hit with a burst of parallel calls.
    for (const batch of batches) {
        try {
            const { results, model: usedModel } = await summarizeBatch(batch);
            model = usedModel || model;
            const stamp = new Date().toISOString();
            for (const r of results) {
                const { error } = await admin
                    .from("transactions")
                    .update({ summary: r.summary, summary_model: usedModel, summary_at: stamp })
                    .eq("id", r.id)
                    .eq("user_id", userId);
                if (error) {
                    failed++;
                    errors.push(error.message);
                } else {
                    summarized++;
                }
            }
            failed += batch.length - results.length;
        } catch (err) {
            failed += batch.length;
            const message = err instanceof Error ? err.message : String(err);
            errors.push(message);
            console.error("[summarize-transactions] batch failed", message);
        }
    }

    return c.json({
        summarized,
        failed,
        remaining: await backlog(admin, userId),
        model,
        errors: errors.slice(0, 5),
    });
});

app.get("/summarize-transactions/health", (c) => c.json({ ok: true }));

/** How many rows still have no summary. */
async function backlog(
    admin: ReturnType<typeof createClient>,
    userId: string,
): Promise<number> {
    const { count } = await admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("review_status", "rejected")
        .is("summary", null);
    return count ?? 0;
}

Deno.serve((req) => app.fetch(req));
