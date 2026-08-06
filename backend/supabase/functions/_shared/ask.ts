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
//
// The same split governs how the answer looks. Step 3 returns *blocks* — prose,
// stat tiles, a table — and a table block holds no rows, only the id of a query
// from step 2. The model chooses the presentation; the app owns the data. So
// "list every waterfront payment" comes back as an actual table without ever
// giving the model a chance to retype a figure it had already been handed.
//
// Both model steps also see the conversation so far, because "and what about
// last year?" is only answerable in the light of what came before. The history
// changes what gets *asked for*, never what the figures are: step 2 still runs
// against the ledger every time, so an earlier turn can influence which query
// is planned but can never leak a stale number into a new answer.
// =============================================================================

import type { SupabaseClient } from "./deps.ts";
import { generateJson, safeParse } from "./extract.ts";

/** Queries one question may run. Enough for a comparison, not a crawl. */
const MAX_QUERIES = 5;
/** Rows any single query may read. Aggregation happens over these. */
const MAX_ROWS = 5000;
/** Transactions a "list" query may hand back to the client. */
const MAX_LIST = 100;
/**
 * Rows of a list the *model* sees. It never transcribes a list — it points at
 * one with a table block — so it needs only enough to describe the shape. The
 * client gets all `MAX_LIST` of them regardless.
 */
const MODEL_LIST_SAMPLE = 8;
/**
 * Turns of the conversation the model is shown. Enough to carry a thread of
 * follow-ups; short enough that an afternoon's session doesn't crowd out the
 * question actually being asked.
 */
const MAX_HISTORY_TURNS = 12;
/** Characters of any single earlier turn kept in the transcript. */
const MAX_HISTORY_CHARS = 600;

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
- Whenever the question asks to see, list, show or find transactions, emit a "list" query. Its rows are rendered as a real table, so a list is never wasted. Leave "limit" unset to return everything that matches, up to ${MAX_LIST}; set it only when the user asked for a specific number ("my last 5…").
- A list pairs well with a total: emit both when the question is "show me X" and a sum is the obvious next thing to know.
- Set "kind" whenever the question implies direction. Spending is kind=expense. Income and earnings are kind=income. Transfers move money between the user's own accounts and are neither.
- Dates are inclusive ISO (YYYY-MM-DD). Resolve relative periods ("last month", "Q2", "this year") against today's date, given below.
- Use category and account names exactly as listed in the context. If none fits, leave them out and use textContains instead.
- To compare two periods, emit one query per period with distinct ids.
- Prefer few, precise queries over many broad ones.
- A conversation so far may be given. Resolve anything the question leans on it for — "that transaction", "the same period", "and last year?" — into explicit filters here. Never reuse an earlier answer's figures; re-query for them.`;

/* --- Step 2: execution ----------------------------------------------------- */

interface TxRow {
    id: string;
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

function accountNames(ctx: LedgerContext): Map<string, string> {
    return new Map(ctx.accounts.map((a) => [a.id, a.name]));
}

/** Lowercase and collapse punctuation so "USD account" and "usd-account" align. */
function normaliseName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolve account filters permissively:
 * 1) exact normalised name
 * 2) contains match either way ("usd account" vs "wise usd")
 */
function resolveAccountIds(ctx: LedgerContext, requested: string[]): string[] {
    const wanted = requested.map((name) => ({
        normalised: normaliseName(name),
    }));

    const exact = new Set(
        ctx.accounts
            .filter((a) => wanted.some((w) => w.normalised && normaliseName(a.name) === w.normalised))
            .map((a) => a.id),
    );
    if (exact.size > 0) return [...exact];

    const fuzzy = new Set(
        ctx.accounts
            .filter((a) => {
                const name = normaliseName(a.name);
                return wanted.some((w) => {
                    if (!w.normalised) return false;
                    return name.includes(w.normalised) || w.normalised.includes(name);
                });
            })
            .map((a) => a.id),
    );
    return [...fuzzy];
}

/**
 * Build a safer and more tolerant text search clause for PostgREST.
 * Includes a compact wildcard variant so NEXTGEN can match NEXT-GEN / NEXT GEN.
 */
function textSearchClause(text: string): string {
    const cleaned = text.replace(/[(),]/g, " ").trim();
    if (!cleaned) return "";

    const terms = [...new Set(cleaned.split(/\s+/).filter(Boolean))];
    const clauses: string[] = [];

    for (const term of terms) {
        for (const field of ["summary", "payee", "memo"]) {
            clauses.push(`${field}.ilike.%${term}%`);
        }
    }

    const compact = cleaned.replace(/[^a-z0-9]/gi, "");
    if (compact.length >= 4 && compact.length <= 24) {
        const stitched = compact.split("").join("%");
        for (const field of ["summary", "payee", "memo"]) {
            clauses.push(`${field}.ilike.%${stitched}%`);
        }
    }

    return clauses.join(",");
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
            "id, amount, currency, kind, occurred_at, summary, payee, memo, account_id, categories(name)",
        )
        .eq("user_id", userId)
        .eq("review_status", "accepted");

    if (query.kind) q = q.eq("kind", query.kind);
    if (query.from) q = q.gte("occurred_at", query.from);
    // The `to` date covers the whole day, not midnight on it.
    if (query.to) q = q.lte("occurred_at", `${query.to}T23:59:59`);

    if (query.accounts?.length) {
        const ids = resolveAccountIds(ctx, query.accounts);
        // An account filter that matched nothing must return nothing, rather
        // than silently widening to every account.
        if (ids.length === 0) {
            return { id: query.id, purpose: query.purpose, select: query.select, matched: 0, data: {} };
        }
        q = q.in("account_id", ids);
    }

    if (query.textContains) {
        const clause = textSearchClause(query.textContains);
        if (clause) q = q.or(clause);
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
        const named = accountNames(ctx);
        return {
            ...base,
            data: rows.slice(0, Math.min(query.limit ?? MAX_LIST, MAX_LIST)).map((r) => ({
                id: r.id,
                date: r.occurred_at.slice(0, 10),
                description: r.summary ?? r.payee ?? "",
                account: (r.account_id && named.get(r.account_id)) || null,
                category: r.categories?.name ?? null,
                kind: r.kind,
                amount: Number(r.amount),
                currency: r.currency,
            })),
        };
    }

    if (query.select === "breakdown") {
        const groups = new Map<string, TxRow[]>();
        const accountName = accountNames(ctx);
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

/* Blocks are how the answer chooses its own shape. The one rule that makes
   them safe: a block never carries data. A table block names a query by id and
   the client renders that query's rows — the ones it already has, unaltered.
   The model decides what the answer looks like; it never gets to decide what a
   figure is. That is why "list all my waterfront payments" can come back as an
   actual table without reopening the door to a mistyped total.

   The shape is flat rather than a discriminated union: `type` selects which of
   the optional fields matter. Gemini's responseSchema and OpenAI's strict
   json_schema both handle a flat object reliably; neither handles oneOf well. */
const BLOCK_TYPES = ["prose", "stats", "table"] as const;

const ANSWER_SCHEMA = {
    type: "object",
    properties: {
        answer: { type: "string" },
        blocks: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    type: { type: "string", enum: BLOCK_TYPES },
                    /** prose: markdown-lite paragraph. */
                    text: { type: "string" },
                    /** table/stats: optional heading above the block. */
                    title: { type: "string" },
                    /** table: which query's rows to render. Never the rows themselves. */
                    queryId: { type: "string" },
                    /** stats: the tiles. */
                    items: {
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
                },
                required: ["type"],
            },
        },
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

Compose the reply as "blocks", in the order they should appear. Block types:
- {"type":"prose","text":"…"} — a short paragraph. Markdown is allowed for emphasis and bullets, but NEVER for tables.
- {"type":"stats","items":[{"label","value","hint"}]} — up to three headline figures as tiles.
- {"type":"table","queryId":"…","title":"…"} — renders the rows of that query. It carries NO data: name the query id and the app draws its rows itself.

Rules:
- If the user asked to see, list, or show transactions, you MUST emit a table block for the "list" query that answered them. Do not summarise a list into prose or tiles, and never retype rows into the text — you would only introduce errors into figures the app already holds.
- A list result may be shown to you as a sample of the full set. That is not a limit on what the user sees: the table block renders every row that was fetched. Never describe the sample as though it were all of them.
- Use only the numbers given. Never estimate, extrapolate, or invent a figure. If the data does not answer the question, say so plainly and say what would.
- Keep currencies separate. Never add one currency to another.
- Format money with its currency, and lead with the number that answers the question.
- Prose is one or two sentences when a table or stats block follows, up to four when it stands alone. Plain language, no preamble, no restating the question.
- If a result is marked truncated, say the figure is a floor rather than a total.
- Also set "answer" to the plain-text gist in one or two sentences, for places that show a single line.
- "followups" holds at most three short questions the user might ask next.
- A conversation so far may be given. Answer as its continuation: don't reintroduce what you both already know, and read references like "that one" or "the same period" against it. The query results below are the only figures you may state — an earlier turn's numbers are history, not evidence for this one.`;

export type SageBlock =
    | { type: "prose"; text: string }
    | { type: "stats"; title?: string; items: Array<{ label: string; value: string; hint?: string }> }
    | { type: "table"; title?: string; queryId: string };

export interface SageAnswer {
    answer: string;
    /** The composed reply. `answer`/`highlights` remain the single-line fallback. */
    blocks?: SageBlock[];
    highlights?: Array<{ label: string; value: string; hint?: string }>;
    followups?: string[];
    /** Echoed back so the UI can render tables and show its work. */
    queries: QueryResult[];
    model: string;
}

/** Selects whose result is a set of rows, and so can back a table block. */
const TABULAR = new Set(["list", "breakdown", "balances"]);

/**
 * What the model sees of the results. Long lists are cut to a sample: the model
 * only ever points at a list, so the other ninety rows buy nothing but tokens
 * and the temptation to transcribe them. The client still receives every row.
 */
function promptView(results: QueryResult[]): unknown {
    return results.map((r) => {
        if (r.select !== "list" || !Array.isArray(r.data) || r.data.length <= MODEL_LIST_SAMPLE) {
            return r;
        }
        return {
            ...r,
            data: r.data.slice(0, MODEL_LIST_SAMPLE),
            note:
                `sample only — ${r.data.length} rows were fetched. Render them with ` +
                `{"type":"table","queryId":"${r.id}"} rather than listing any of them yourself.`,
        };
    });
}

/** Rows a table block would actually draw, so an empty one can be dropped. */
function rowCount(result: QueryResult): number {
    return Array.isArray(result.data) ? result.data.length : 0;
}

/**
 * Keep the blocks that mean something: prose with text, stats with tiles, and
 * tables that name a query which really ran and really has rows. A hallucinated
 * query id is the one way this shape can go wrong, and it fails closed here.
 *
 * The safety net at the end matters as much as the filtering: if a list query
 * came back and no block shows it, the user asked to see rows and would
 * otherwise get prose about them. Append the table.
 */
function normaliseBlocks(
    blocks: SageBlock[] | undefined,
    results: QueryResult[],
): SageBlock[] | undefined {
    if (!blocks?.length) return undefined;
    const byId = new Map(results.map((r) => [r.id, r]));

    const kept: SageBlock[] = [];
    for (const block of blocks) {
        if (block.type === "prose") {
            if (block.text?.trim()) kept.push({ type: "prose", text: block.text.trim() });
        } else if (block.type === "stats") {
            const items = (block.items ?? []).filter((i) => i?.label && i?.value).slice(0, 3);
            if (items.length) kept.push({ ...block, items });
        } else if (block.type === "table") {
            const result = byId.get(block.queryId);
            if (result && TABULAR.has(result.select) && rowCount(result) > 0) kept.push(block);
        }
    }

    const shown = new Set(kept.flatMap((b) => (b.type === "table" ? [b.queryId] : [])));
    for (const r of results) {
        if (r.select === "list" && rowCount(r) > 0 && !shown.has(r.id)) {
            kept.push({ type: "table", queryId: r.id, title: r.purpose });
        }
    }

    return kept.length ? kept : undefined;
}

/* --- The conversation so far ----------------------------------------------- */

/** One earlier turn, as the caller stored it. */
export interface HistoryTurn {
    role: "user" | "sage";
    /** The question as typed, or Sage's own one-line gist of its reply. */
    content: string;
}

/**
 * The thread as plain dialogue. Only the gist of each turn survives: what an
 * earlier answer is *for* here is resolving a reference ("that plot", "the same
 * months"), and the full block payload — tables, tiles, every row a query
 * returned — buys nothing towards that at considerable cost. The figures for
 * this question come from this question's own queries.
 */
function transcript(history: HistoryTurn[]): string | null {
    const turns = history.slice(-MAX_HISTORY_TURNS).filter((t) => t.content.trim());
    if (!turns.length) return null;
    const lines = turns.map((t) => {
        const text = t.content.trim();
        const clipped =
            text.length > MAX_HISTORY_CHARS ? `${text.slice(0, MAX_HISTORY_CHARS)}…` : text;
        return `${t.role === "user" ? "User" : "Sage"}: ${clipped}`;
    });
    return `Conversation so far:\n${lines.join("\n")}`;
}

/**
 * Plan → execute → answer. Throws only if the model is unreachable; a query
 * that fails is reported to the model as an error so the answer can account
 * for it rather than the whole request collapsing.
 *
 * `history` is the thread this question continues, oldest first, excluding the
 * question itself. `viewing` is the screen the question was asked from, which
 * is the difference between "why is this uncategorised?" being answerable and
 * being a shrug.
 */
export async function askLedger(
    admin: SupabaseClient,
    userId: string,
    question: string,
    history: HistoryTurn[] = [],
    viewing?: string,
): Promise<SageAnswer> {
    const ctx = await loadContext(admin, userId);

    const contextBlock = [
        `Today is ${ctx.today}.`,
        ctx.earliest ? `The ledger starts on ${ctx.earliest.slice(0, 10)}.` : "The ledger is empty.",
        ctx.accounts.length
            ? `Accounts: ${ctx.accounts.map((a) => `${a.name} (${a.currency})`).join(", ")}.`
            : "No accounts yet.",
        ctx.categories.length ? `Categories: ${ctx.categories.join(", ")}.` : "No categories yet.",
        viewing ? `The user is looking at the ${viewing} screen as they ask.` : null,
    ]
        .filter(Boolean)
        .join("\n");

    const dialogue = transcript(history);

    const planned = await generateJson({
        system: PLAN_SYSTEM,
        user: [contextBlock, dialogue, `Question: ${question}`]
            .filter(Boolean)
            .join("\n\n"),
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
            dialogue,
            `Question: ${question}`,
            `Query results:\n${JSON.stringify(promptView(results), null, 1)}`,
        ]
            .filter(Boolean)
            .join("\n\n"),
        schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "sage_answer",
    });

    const parsed = safeParse<Omit<SageAnswer, "queries" | "model">>(answered.raw);

    return {
        answer:
            parsed?.answer ??
            "I couldn't put that together from your ledger. Try narrowing it to a period or a category.",
        blocks: normaliseBlocks(parsed?.blocks, results),
        highlights: parsed?.highlights,
        followups: parsed?.followups,
        queries: results,
        model: answered.model,
    };
}
