/* The app's read layer. Every screen that needs ledger data goes through a hook
   here rather than writing its own `useQuery` against Supabase.

   Two reasons this is worth the indirection:
   - Cache identity. The dashboard, the console and the detail pages read the
     same rows; sharing one key means one fetch and one consistent view. When a
     mutation invalidates `QK.accountBalances`, every surface updates together.
   - Query shape. The column list, ordering and row cap for a view live in one
     place, so widening a select can't leave a second copy behind.

   Mutations stay with the screen that owns them — this file is reads only. */

import { useQuery } from "@tanstack/react-query";
import { RECENT_TRANSACTION_LIMIT, SNAPSHOT_LIMIT } from "./constants";
import { currentMonthStart } from "./format";
import { requireSupabase } from "./supabase";
import { fetchAccounts, fetchTaxonomy } from "./taxonomy";
import type {
    AccountWithBalance,
    Budget,
    BudgetProgress,
    CategorySummaryRow,
    MonthlySummaryRow,
    NetWorthSnapshot,
    PendingTransaction,
    Rule,
    ScheduledTransaction,
    Transaction,
} from "./types";

/* --- Query keys ------------------------------------------------------------
   The single registry. Mutations invalidate through these so a renamed key is a
   compile error rather than a stale panel. */

export const QK = {
    accounts: ["accounts"] as const,
    accountBalances: ["account-balances"] as const,
    taxonomy: ["taxonomy"] as const,
    pendingReview: ["pending-review"] as const,
    netWorth: ["net-worth"] as const,
    recentTransactions: ["recent-transactions"] as const,
    rules: ["rules"] as const,
    budgets: ["budgets"] as const,
    scheduled: ["scheduled"] as const,
    monthlySummary: (month: string) => ["monthly-summary", month] as const,
    monthlySummaryAll: ["monthly-summary-all"] as const,
    categorySummary: (month: string) => ["category-summary", month] as const,
    budgetProgress: (budgetId: string | undefined) => ["budget-progress", budgetId] as const,
};

/** The dashboard's slice of a transaction — no payload columns. */
export type RecentTransaction = Pick<
    Transaction,
    "id" | "kind" | "occurred_at" | "amount" | "currency" | "payee"
>;

const RECENT_COLUMNS = "id, kind, occurred_at, amount, currency, payee";

/** Unwrap a PostgREST result, turning its error into a thrown Error. */
async function rows<T>(
    build: (sb: ReturnType<typeof requireSupabase>) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
    const { data, error } = await build(requireSupabase());
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
}

/* --- Accounts + taxonomy ---------------------------------------------------- */

/** Accounts as stored, without derived balances. Cheap; use for pickers. */
export function useAccounts() {
    return useQuery({ queryKey: QK.accounts, queryFn: fetchAccounts });
}

/** Accounts with their derived current balance, for anything showing money. */
export function useAccountBalances() {
    return useQuery({
        queryKey: QK.accountBalances,
        queryFn: () =>
            rows<AccountWithBalance>((sb) =>
                sb.from("v_account_balances").select("*").order("created_at"),
            ),
    });
}

/** Category groups with their categories, parents before children. */
export function useTaxonomy() {
    return useQuery({ queryKey: QK.taxonomy, queryFn: fetchTaxonomy });
}

/* --- Inbox ------------------------------------------------------------------ */

/** Captures awaiting review — also drives the sidebar's count badge. */
export function usePendingReview() {
    return useQuery({
        queryKey: QK.pendingReview,
        queryFn: () =>
            rows<PendingTransaction>((sb) =>
                sb.from("v_pending_review").select("*").order("occurred_at", { ascending: false }),
            ),
    });
}

/* --- Net worth --------------------------------------------------------------- */

/** Daily snapshots, oldest first so a chart can plot them directly. */
export function useNetWorthSnapshots() {
    return useQuery({
        queryKey: QK.netWorth,
        queryFn: () =>
            rows<NetWorthSnapshot>((sb) =>
                sb
                    .from("net_worth_snapshots")
                    .select("*")
                    .order("as_of", { ascending: true })
                    .limit(SNAPSHOT_LIMIT),
            ),
    });
}

/* --- Summaries ---------------------------------------------------------------
   `month` defaults to the current one; Reports passes nothing and gets today's,
   which keeps the cache key shared with the dashboard. */

export function useMonthlySummary(month: string = currentMonthStart()) {
    return useQuery({
        queryKey: QK.monthlySummary(month),
        queryFn: () =>
            rows<MonthlySummaryRow>((sb) =>
                sb.from("v_monthly_summary").select("*").eq("month", month),
            ),
    });
}

/** Every month on record, oldest first — the income-vs-expenses columns. */
export function useMonthlySummaryHistory() {
    return useQuery({
        queryKey: QK.monthlySummaryAll,
        queryFn: () =>
            rows<MonthlySummaryRow>((sb) =>
                sb.from("v_monthly_summary").select("*").order("month", { ascending: true }),
            ),
    });
}

/** One month's spend by category, largest first. */
export function useCategorySummary(month: string = currentMonthStart()) {
    return useQuery({
        queryKey: QK.categorySummary(month),
        queryFn: () =>
            rows<CategorySummaryRow>((sb) =>
                sb
                    .from("v_category_summary")
                    .select("*")
                    .eq("month", month)
                    .order("total_amount", { ascending: false }),
            ),
    });
}

/* --- Ledger ------------------------------------------------------------------ */

/** The newest accepted entries, for "recent activity" strips. */
export function useRecentTransactions(limit: number = RECENT_TRANSACTION_LIMIT) {
    return useQuery({
        queryKey: [...QK.recentTransactions, limit],
        queryFn: () =>
            rows<RecentTransaction>((sb) =>
                sb
                    .from("transactions")
                    .select(RECENT_COLUMNS)
                    .eq("review_status", "accepted")
                    .order("occurred_at", { ascending: false })
                    .limit(limit),
            ),
    });
}

/* --- Rules -------------------------------------------------------------------- */

/** Extraction rules, highest priority first — first match wins. */
export function useRules() {
    return useQuery({
        queryKey: QK.rules,
        queryFn: () =>
            rows<Rule>((sb) =>
                sb.from("rules").select("*").order("priority", { ascending: false }),
            ),
    });
}

/* --- Scheduled ----------------------------------------------------------------- */

/** Scheduled money, soonest due first. Pass `activeOnly` for the dashboard. */
export function useScheduled(options: { activeOnly?: boolean; limit?: number } = {}) {
    const { activeOnly = false, limit } = options;
    return useQuery({
        queryKey: [...QK.scheduled, { activeOnly, limit: limit ?? null }],
        queryFn: () =>
            rows<ScheduledTransaction>((sb) => {
                let q = sb.from("scheduled_transactions").select("*");
                if (activeOnly) q = q.eq("active", true);
                q = q.order("next_due", { ascending: true });
                return limit ? q.limit(limit) : q;
            }),
    });
}

/* --- Budgets -------------------------------------------------------------------- */

/** All budgets, newest period first. */
export function useBudgets() {
    return useQuery({
        queryKey: QK.budgets,
        queryFn: () =>
            rows<Budget>((sb) =>
                sb.from("budgets").select("*").order("starts_on", { ascending: false }),
            ),
    });
}

/** Planned-vs-actual lines for one budget. Idle until an id is known. */
export function useBudgetProgress(budgetId: string | undefined, enabled = true) {
    return useQuery({
        queryKey: QK.budgetProgress(budgetId),
        enabled: enabled && !!budgetId,
        queryFn: () =>
            rows<BudgetProgress>((sb) =>
                sb.from("v_budget_progress").select("*").eq("budget_id", budgetId!).order("sort_order"),
            ),
    });
}

/** The budget whose period covers today, else the most recent real one. */
export function currentBudget(budgets: Budget[] | undefined): Budget | undefined {
    if (!budgets?.length) return undefined;
    const today = new Date().toISOString().slice(0, 10);
    return (
        budgets.find((b) => !b.is_template && b.starts_on <= today && b.ends_on >= today) ??
        budgets.find((b) => !b.is_template) ??
        budgets[0]
    );
}
