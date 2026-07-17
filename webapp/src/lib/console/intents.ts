/* The console's "financial voice" runs on a small intent layer. A typed or
 * pasted prompt is first classified as a *capture* (an event to record) or a
 * *query* (a question to answer with a dashboard). Queries are matched to a
 * known intent, and each intent renders a set of data-backed panels from the
 * existing Supabase views — no new backend.
 *
 * This is deliberately a keyword matcher, not an LLM: it is the seam where a
 * real query planner slots in later (see docs/FINANCIAL_OS.md §4). The UI, the
 * data access, and the review guarantees do not change when the matcher gets
 * smarter. */

/** The generated widgets a query intent can compose on the canvas. */
export type PanelId = "networth" | "month" | "categories" | "accounts" | "recent" | "inbox";

export interface Intent {
    id: string;
    /** Shown back to the user as "Sage's" reading of their question. */
    title: string;
    /** One-line description of what the generated view contains. */
    caption: string;
    /** Lower-cased keywords/phrases; any hit selects this intent. */
    keywords: string[];
    /** The panels rendered, in order, for this intent. */
    panels: PanelId[];
}

/** Query intents, matched in order — put the more specific ones first. */
export const INTENTS: Intent[] = [
    {
        id: "networth",
        title: "Your net worth",
        caption: "Assets, liabilities, and how your wealth has moved over time.",
        keywords: ["net worth", "networth", "net-worth", "wealth", "worth", "how rich", "how much am i worth"],
        panels: ["networth", "accounts"],
    },
    {
        id: "spending",
        title: "Where your money went",
        caption: "This month's outflow, broken down by category.",
        keywords: [
            "spending",
            "spend",
            "expenses",
            "expense",
            "by category",
            "categories",
            "category",
            "where did",
            "where's my money",
            "outflow",
            "cost",
            "costs",
        ],
        panels: ["categories", "month"],
    },
    {
        id: "accounts",
        title: "Your accounts",
        caption: "Live balances across every account.",
        keywords: ["accounts", "account", "balance", "balances", "bank", "cash", "how much in", "how much do i have"],
        panels: ["accounts"],
    },
    {
        id: "inbox",
        title: "Waiting for your review",
        caption: "Captured items Sage has extracted, ready for you to confirm.",
        keywords: ["review", "inbox", "pending", "to confirm", "confirm", "waiting", "unreviewed", "needs review"],
        panels: ["inbox"],
    },
    {
        id: "recent",
        title: "Recent activity",
        caption: "Your latest accepted transactions.",
        keywords: ["recent", "latest", "last transactions", "activity", "history", "what happened"],
        panels: ["recent"],
    },
    {
        id: "summary",
        title: "This month at a glance",
        caption: "Income and outflow, top categories, and recent activity.",
        keywords: [
            "summary",
            "summarize",
            "summarise",
            "overview",
            "this month",
            "how am i doing",
            "how are things",
            "snapshot",
            "recap",
            "report",
        ],
        panels: ["month", "categories", "recent"],
    },
];

/** The default view when a question is understood as a query but matches no
 * specific intent — a broad "how are things" dashboard. */
export const DEFAULT_INTENT: Intent = INTENTS.find((i) => i.id === "summary")!;

/** Chips shown on the empty canvas to demonstrate what Sage can do. */
export interface Suggestion {
    label: string;
    prompt: string;
}

export const SUGGESTIONS: Suggestion[] = [
    { label: "Summarize this month", prompt: "Summarize this month" },
    { label: "What am I worth?", prompt: "What is my net worth right now?" },
    { label: "Spending by category", prompt: "Show my spending by category" },
    { label: "My account balances", prompt: "What are my account balances?" },
    { label: "What's in review?", prompt: "What's waiting in my review inbox?" },
    { label: "Recent activity", prompt: "Show my recent activity" },
];

// Verbs that read like recording an event rather than asking a question. Kept
// distinct from query verbs so "spent on rent" (capture) and "my spending"
// (query) resolve differently.
const CAPTURE_VERBS = [
    "paid",
    "pay",
    "bought",
    "buy",
    "received",
    "receive",
    "got",
    "sent",
    "send",
    "transferred",
    "transfer",
    "deposited",
    "deposit",
    "withdrew",
    "earned",
    "invoiced",
    "refunded",
    "charged",
    "owe",
    "lent",
    "borrowed",
];

const QUERY_MARKERS = [
    "show",
    "how much",
    "how many",
    "what",
    "what's",
    "whats",
    "which",
    "when",
    "where",
    "list",
    "summar",
    "give me",
    "tell me",
    "net worth",
    "?",
];

export type Classification =
    | { kind: "query"; intent: Intent }
    | { kind: "capture" };

/** Decide whether a prompt is a question (→ generate a dashboard) or an event
 * (→ hand off to capture), and for questions pick the intent. */
export function classifyPrompt(raw: string): Classification {
    const text = raw.trim().toLowerCase();
    if (!text) return { kind: "capture" };

    const looksLikeQuery = QUERY_MARKERS.some((m) => text.includes(m));
    const startsWithCaptureVerb = CAPTURE_VERBS.some(
        (v) => text === v || text.startsWith(v + " "),
    );

    // A clear event ("Paid 2.5m…") with no question framing → capture.
    if (startsWithCaptureVerb && !looksLikeQuery) {
        return { kind: "capture" };
    }

    const intent = matchIntent(text);
    if (intent) return { kind: "query", intent };

    // Question framing but no specific match → the broad summary dashboard.
    if (looksLikeQuery) return { kind: "query", intent: DEFAULT_INTENT };

    // Anything else (a bare note, a pasted line) is treated as something to
    // capture — capture-first is the safe default.
    return { kind: "capture" };
}

/** Best-matching query intent for a (lower-cased) prompt, or null. */
export function matchIntent(text: string): Intent | null {
    for (const intent of INTENTS) {
        if (intent.keywords.some((k) => text.includes(k))) return intent;
    }
    return null;
}
