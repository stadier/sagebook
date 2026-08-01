// =============================================================================
// Sagebook · Answering questions about the ledger
// -----------------------------------------------------------------------------
// "How much did I spend on groceries in Q2?" cannot be answered by keyword
// matching, and it cannot be answered by handing the model a sample of rows
// either — a total computed from twenty of thirty-eight transactions is wrong
// in a way nobody can see. So the model does not get the data. It gets to ask
// for it.
//
// Three steps:
//
//   1. PLAN    The model sees the question plus the shape of the user's world
//              (their accounts, their categories, today's date) and returns a
//              list of structured queries it wants run.
//   2. EXECUTE We run them. Every query is a value in a fixed DSL — never SQL
//              the model wrote — and every one is filtered to the caller's own
//              user_id, so a bad plan can return nothing it shouldn't.
//   3. ANSWER  The model sees the real figures and writes the reply.
//
// The DSL is the security boundary. A model that emits `{"select":"total",
// "kind":"expense"}` can only ever produce a sum of that user's expenses; there
// is no phrasing of a question that turns it into a different table.
// =============================================================================

import type { SupabaseClient } from "./deps.ts";
import { generateJson, safeParse } from "./extract.ts";

/** Queries one question may run. Enough for a comparison, not a crawl. */
const MAX_QUERIES = 5;
/** Rows any single query may read. Aggregation happens over these. */
const MAX_ROWS = 5000;
/** Transactions a "list" query may hand back to the model. */
const MAX_LIST = 25;

/* --- The query DSL --------------------------------------------------------- */

export interface LedgerQuery {
    /** Referenced by the answer step, so it can say which figure is which. */
    id: string;
    /** What this query is for, in the model's own words. */
    purpose?: string;
    select: "total" | "count" | "breakdown" | "list" | "balances";
    kind?: "income" | "expense" | "transfer" | "adjustment";
    /** Inclusive ISO dates. */
    from?: string;
    to?: string;
    /** Category names, matched case-insensitively against the taxonomy. */
    categories?: string[];
    /** Account names, matched the same way. */
    accounts?: string[];
    /** Substring match across summary, payee and memo. */
    textContains?: string;
    groupBy?: "category" | "month" | "account" | "kind";
    limit?: number;
}

export interface QueryResult {
    id: string;
    purpose?: string;
    select: string;
    /** Rows the filters matched, before any grouping or limit. */
    matched: number;
    /** Per-currency totals, or per-group figures when `groupBy` is set. */
    data: unknown;
    /** Set when the row cap was hit, so the answer can hedge honestly. */
    truncated?: boolean;
}

/* --- Step 1: the plan ------------------------------------------------------ */

const PLAN_SCHEMA = {
    type: "object",
    properties: {
        queries: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    purpose: { type: "string" },
                    select: {
                        type: "string",
                        enum: ["total", "count", "breakdown", "list", "balances"],
                    },
                    kind: {
                        type: "string",
                        enum: ["income", "expense", "transfer", "adjustment"],
                    },
                    from: { type: "string" },
                    to: { type: "string" },
                    categories: { type: "array", items: { type: "string" } },
                    accounts: { type: "array", items: { type: "string" } },
                    textContains: { type: "string" },
                    groupBy: {
                        type: "string",
                        enum: ["category", "month", "account", "kind"],
                    },
                    limit: { type: "number" },
                },
                required: ["id", "select"],
            },
        },
    },
    required: ["queries"],
} as const;

const PLAN_SYSTEM = `You plan data queries for a personal finance ledger. You never answer the question at this stage — you only decide what to look up.

Return one to ${MAX_QUERIES} queries. Guidance:
- "total" sums amounts; "count" counts rows; "breakdown" needs groupBy; "list" returns individual transactions; "balances" returns current account balances and ignores every other filter.
- Set "kind" whenever the question implies direction. Spending is kind=expense. Income and earnings are kind=income. Transfers move money between the user's own accounts and are neither.
- Dates are inclusive ISO (YYYY-MM-DD). Resolve relative periods ("last month", "Q2", "this year") against today's date, given below.
- Use category and account names exactly as listed in the context. If none fits, leave them out and use textContains instead.
- To compare two periods, emit one query per period with distinct ids.
- Prefer few, precise queries over many broad ones.`;

/* --- Step 2: execution ----------------------------------------------------- */

interface TxRow {
    amount: number;
    currency: string;
    kind: string;
    occurred_at: string;
    summary: string | null;
    payee: string | null;
    memo: string | null;
    account_id: string | null;
    categories: { name: string } | null;
}

/** Names of the user's accounts and categories, for prompt context and matching. */
export interface LedgerContext {
    today: string;
    accounts: Array<{ id: string; name: string; currency: string }>;
    categories: string[];
    currencies: string[];
    earliest: string | null;
}

export async function loadContext(
    admin: SupabaseClient,
    userId: string,
): Promise<LedgerContext> {
    const [accounts, categories, oldest] = await Promise.all([
        admin.from("accounts").select("id, name, currency").eq("user_id", userId),
        admin.from("categories").select("name").eq("user_id", userId),
        admin
            .from("transactions")
            .select("occurred_at")
            .eq("user_id", userId)
            .eq("review_status", "accepted")
            .order("occurred_at", { ascending: true })
            .limit(1),
    ]);

    const accountRows = (accounts.data ?? []) as Array<{
        id: string;
        name: string;
        currency: string;
    }>;
    return {
        today: new Date().toISOString().slice(0, 10),
        accounts: accountRows,
        categories: [...new Set(((categories.data ?? []) as Array<{ name: string }>).map((c) => c.name))],
        currencies: [...new Set(accountRows.map((a) => a.currency))],
        earliest: (oldest.data as Array<{ occurred_at: string }> | null)?.[0]?.occurred_at ?? null,
    };
}

/** Sum by currency — adding ₦ to $ would be a fabricated number. */
function totalsByCurrency(rows: TxRow[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) out[r.currency] = (out[r.currency] ?? 0) + Number(r.amount);
    return out;
}

function monthOf(iso: string): string {
    return iso.slice(0, 7);
}

async function runQuery(
    admin: SupabaseClient,
    userId: string,
    ctx: LedgerContext,
    query: LedgerQuery,
): Promise<QueryResult> {
    if (query.select === "balances") {
        const { data, error } = await admin
            .from("v_account_balances")
            .select("name, type, currency, current_balance, is_archived")
            .eq("user_id", userId);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        return {
            id: query.id,
            purpose: query.purpose,
            select: query.select,
            matched: rows.length,
            data: rows.filter((r) => !r.is_archived),
        };
    }

    let q = admin
        .from("transactions")
        .select(
            "amount, currency, kind, occurred_at, summary, payee, memo, account_id, categories(name)",
        )
        .eq("user_id", userId)
        .eq("review_status", "accepted");

    if (query.kind) q = q.eq("kind", query.kind);
    if (query.from) q = q.gte("occurred_at", query.from);
    // The `to` date covers the whole day, not midnight on it.
    if (query.to) q = q.lte("occurred_at", `${query.to}T23:59:59`);

    if (query.accounts?.length) {
        const wanted = new Set(query.accounts.map((a) => a.toLowerCase()));
        const ids = ctx.accounts.filter((a) => wanted.has(a.name.toLowerCase())).map((a) => a.id);
        // An account filter that matched nothing must return nothing, rather
        // than silently widening to every account.
        if (ids.length === 0) {
            return { id: query.id, purpose: query.purpose, select: query.select, matched: 0, data: {} };
        }
        q = q.in("account_id", ids);
    }

    if (query.textContains) {
        const safe = query.textContains.replace(/[,()]/g, " ");
        q = q.or(`summary.ilike.%${safe}%,payee.ilike.%${safe}%,memo.ilike.%${safe}%`);
    }

    const { data, error } = await q
        .order("occurred_at", { ascending: false })
        .limit(MAX_ROWS);
    if (error) throw new Error(error.message);

    let rows = (data ?? []) as unknown as TxRow[];
    const truncated = rows.length === MAX_ROWS;

    // Category names are filtered here rather than in the query: PostgREST
    // cannot filter an embedded resource without dropping rows that have no
    // category at all, which would quietly change what "uncategorised" means.
    if (query.categories?.length) {
        const wanted = new Set(query.categories.map((c) => c.toLowerCase()));
        rows = rows.filter((r) => r.categories && wanted.has(r.categories.name.toLowerCase()));
    }

    const base = { id: query.id, purpose: query.purpose, select: query.select, matched: rows.length, truncated };

    if (query.select === "count") return { ...base, data: { count: rows.length } };

    if (query.select === "list") {
        return {
            ...base,
            data: rows.slice(0, Math.min(query.limit ?? 10, MAX_LIST)).map((r) => ({
                date: r.occurred_at.slice(0, 10),
                description: r.summary ?? r.payee ?? "",
                category: r.categories?.name ?? null,
                kind: r.kind,
                amount: Number(r.amount),
                currency: r.currency,
            })),
        };
    }

    if (query.select === "breakdown") {
        const groups = new Map<string, TxRow[]>();
        const accountName = new Map(ctx.accounts.map((a) => [a.id, a.name]));
        for (const r of rows) {
            const key =
                query.groupBy === "month"
                    ? monthOf(r.occurred_at)
                    : query.groupBy === "account"
                      ? (r.account_id && accountName.get(r.account_id)) || "— unassigned —"
                      : query.groupBy === "kind"
                        ? r.kind
                        : (r.categories?.name ?? "— uncategorised —");
            const bucket = groups.get(key);
            if (bucket) bucket.push(r);
            else groups.set(key, [r]);
        }
        const breakdown = [...groups.entries()]
            .map(([group, groupRows]) => ({
                group,
                count: groupRows.length,
                totals: totalsByCurrency(groupRows),
            }))
            .sort((a, b) => {
                const sum = (t: Record<string, number>) => Object.values(t).reduce((s, v) => s + v, 0);
                return sum(b.totals) - sum(a.totals);
            });
        return { ...base, data: breakdown.slice(0, query.limit ?? 20) };
    }

    return { ...base, data: { totals: totalsByCurrency(rows), count: rows.length } };
}

/* --- Step 3: the answer ---------------------------------------------------- */

const ANSWER_SCHEMA = {
    type: "object",
    properties: {
        answer: { type: "string" },
        highlights: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    label: { type: "string" },
                    value: { type: "string" },
                    hint: { type: "string" },
                },
                required: ["label", "value"],
            },
        },
        followups: { type: "array", items: { type: "string" } },
    },
    required: ["answer"],
} as const;

const ANSWER_SYSTEM = `You are Sage, the voice of a personal finance app. You are answering from real figures that were just queried out of the user's own ledger.

Rules:
- Use only the numbers given. Never estimate, extrapolate, or invent a figure. If the data does not answer the question, say so plainly and say what would.
- Keep currencies separate. Never add one currency to another.
- Format money with its currency, and lead with the number that answers the question.
- Two to four sentences. Plain language, no preamble, no restating the question.
- If a result is marked truncated, say the figure is a floor rather than a total.
- "highlights" holds at most three figures worth showing as tiles. "followups" holds at most three short questions the user might ask next.`;

export interface SageAnswer {
    answer: string;
    highlights?: Array<{ label: string; value: string; hint?: string }>;
    followups?: string[];
    /** Echoed back so the UI can show its work. */
    queries: QueryResult[];
    model: string;
}

/**
 * Plan → execute → answer. Throws only if the model is unreachable; a query
 * that fails is reported to the model as an error so the answer can account
 * for it rather than the whole request collapsing.
 */
export async function askLedger(
    admin: SupabaseClient,
    userId: string,
    question: string,
): Promise<SageAnswer> {
    const ctx = await loadContext(admin, userId);

    const contextBlock = [
        `Today is ${ctx.today}.`,
        ctx.earliest ? `The ledger starts on ${ctx.earliest.slice(0, 10)}.` : "The ledger is empty.",
        ctx.accounts.length
            ? `Accounts: ${ctx.accounts.map((a) => `${a.name} (${a.currency})`).join(", ")}.`
            : "No accounts yet.",
        ctx.categories.length ? `Categories: ${ctx.categories.join(", ")}.` : "No categories yet.",
    ].join("\n");

    const planned = await generateJson({
        system: PLAN_SYSTEM,
        user: `${contextBlock}\n\nQuestion: ${question}`,
        schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "ledger_query_plan",
    });

    const plan = safeParse<{ queries: LedgerQuery[] }>(planned.raw);
    const queries = (plan?.queries ?? []).slice(0, MAX_QUERIES);

    const results: QueryResult[] = [];
    for (const query of queries) {
        try {
            results.push(await runQuery(admin, userId, ctx, query));
        } catch (err) {
            results.push({
                id: query.id,
                purpose: query.purpose,
                select: query.select,
                matched: 0,
                data: { error: err instanceof Error ? err.message : String(err) },
            });
        }
    }

    const answered = await generateJson({
        system: ANSWER_SYSTEM,
        user: [
            contextBlock,
            `\nQuestion: ${question}`,
            `\nQuery results:\n${JSON.stringify(results, null, 1)}`,
        ].join("\n"),
        schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "sage_answer",
    });

    const parsed = safeParse<Omit<SageAnswer, "queries" | "model">>(answered.raw);

    return {
        answer:
            parsed?.answer ??
            "I couldn't put that together from your ledger. Try narrowing it to a period or a category.",
        highlights: parsed?.highlights,
        followups: parsed?.followups,
        queries: results,
        model: answered.model,
    };
}
