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

import type { SupabaseClient } from "../_shared/deps.ts";
import { createApp, errorMessage, readJson, requireUser, serve } from "../_shared/http.ts";
import {
    SUMMARY_BATCH,
    type SummarizableTx,
    summarizeBatch,
} from "../_shared/summarize.ts";

/** Rows per request. The client loops until the backlog is empty, so this is a
 *  latency budget per call, not a ceiling on how much can be summarized. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT     = 300;

/** Error messages returned to the caller before the list is truncated. */
const MAX_REPORTED_ERRORS = 5;

interface SummarizeRequest {
    /** Summarize these specific rows (used by "regenerate"). */
    ids?: string[];
    /** Otherwise: how many un-summarized rows to drain this call. */
    limit?: number;
    /** Redo rows that already have a summary. Never touches hand-edited ones. */
    force?: boolean;
}

const app = createApp("summarize-transactions");

app.post("/summarize-transactions", async (c) => {
    const auth = await requireUser(c);
    if (!auth.ok) return auth.response;
    const { userId, admin } = auth;

    // An empty body means "drain the default number of rows".
    const parsed = await readJson<SummarizeRequest>(c, {});
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

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

    // Category names read better in the prompt than raw ids. The owning account
    // is deliberately not resolved — see promptLine() in _shared/summarize.ts.
    const { data: cats } = await admin
        .from("categories").select("id, name").eq("user_id", userId);
    const catName = new Map((cats ?? []).map((x: { id: string; name: string }) => [x.id, x.name]));

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
            errors.push(errorMessage(err));
            console.error("[summarize-transactions] batch failed", errorMessage(err));
        }
    }

    return c.json({
        summarized,
        failed,
        remaining: await backlog(admin, userId),
        model,
        errors: errors.slice(0, MAX_REPORTED_ERRORS),
    });
});

/** How many rows still have no summary. */
async function backlog(admin: SupabaseClient, userId: string): Promise<number> {
    const { count } = await admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .neq("review_status", "rejected")
        .is("summary", null);
    return count ?? 0;
}

serve(app);
