import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import NetWorthChart from "../components/NetWorthChart";
import { currentMonthStart, fmtDate, fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import type {
    AccountWithBalance,
    CategorySummaryRow,
    MonthlySummaryRow,
    NetWorthSnapshot,
    PendingTransaction,
    Transaction,
} from "../lib/types";

/** A recent accepted transaction — the subset the dashboard needs. */
type RecentTx = Pick<
    Transaction,
    "id" | "kind" | "occurred_at" | "amount" | "currency" | "payee"
>;

export default function Overview() {
    const month = currentMonthStart();
    const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

    // All keys match the detail pages, so the React Query cache is shared.
    const snapshots = useQuery({
        queryKey: ["net-worth"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("net_worth_snapshots")
                .select("*")
                .order("as_of", { ascending: true })
                .limit(365);
            if (error) throw new Error(error.message);
            return (data ?? []) as NetWorthSnapshot[];
        },
    });

    const pending = useQuery({
        queryKey: ["pending-review"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("v_pending_review")
                .select("*")
                .order("occurred_at", { ascending: false });
            if (error) throw new Error(error.message);
            return (data ?? []) as PendingTransaction[];
        },
    });

    const monthly = useQuery({
        queryKey: ["monthly-summary", month],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("v_monthly_summary")
                .select("*")
                .eq("month", month);
            if (error) throw new Error(error.message);
            return (data ?? []) as MonthlySummaryRow[];
        },
    });

    const byCategory = useQuery({
        queryKey: ["category-summary", month],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("v_category_summary")
                .select("*")
                .eq("month", month)
                .order("total_amount", { ascending: false });
            if (error) throw new Error(error.message);
            return (data ?? []) as CategorySummaryRow[];
        },
    });

    const balances = useQuery({
        queryKey: ["account-balances"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("v_account_balances")
                .select("*")
                .order("created_at");
            if (error) throw new Error(error.message);
            return (data ?? []) as AccountWithBalance[];
        },
    });

    const recent = useQuery({
        queryKey: ["recent-transactions"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("transactions")
                .select("id, kind, occurred_at, amount, currency, payee")
                .eq("review_status", "accepted")
                .order("occurred_at", { ascending: false })
                .limit(6);
            if (error) throw new Error(error.message);
            return (data ?? []) as RecentTx[];
        },
    });

    const rows = snapshots.data ?? [];
    const latest = rows.length ? rows[rows.length - 1] : null;
    const pendingCount = pending.data?.length ?? 0;
    const income = (monthly.data ?? []).filter((r) => r.kind === "income");
    const expense = (monthly.data ?? []).filter((r) => r.kind === "expense");
    const topCategories = (byCategory.data ?? []).slice(0, 4);
    const activeAccounts = (balances.data ?? []).filter((a) => !a.is_archived);

    return (
        <div className="mx-auto max-w-5xl">
            <h1 className="mb-1 text-xl font-semibold text-slate-100">Overview</h1>
            <p className="mb-6 text-sm text-slate-400">
                Everything at a glance. Hit <span className="font-medium text-emerald-400">+</span> to
                add anything — a note, a receipt, or a statement.
            </p>

            <div className="grid gap-4 lg:grid-cols-3">
                {/* Net worth + trend */}
                <section className="sb-card p-5 lg:col-span-2">
                    <CardHeader title="Net worth" to="/net-worth" cta="Details" />
                    {latest ? (
                        <>
                            <div className="mb-4 grid gap-3 sm:grid-cols-3">
                                <Stat
                                    label={`As of ${fmtDate(latest.as_of)}`}
                                    value={fmtMoney(Number(latest.net_worth), latest.base_currency)}
                                    tone="text-slate-100"
                                />
                                <Stat
                                    label="Assets"
                                    value={fmtMoney(Number(latest.assets), latest.base_currency)}
                                    tone="text-emerald-400"
                                />
                                <Stat
                                    label="Liabilities"
                                    value={fmtMoney(Number(latest.liabilities), latest.base_currency)}
                                    tone="text-rose-300"
                                />
                            </div>
                            {rows.length >= 2 ? (
                                <NetWorthChart
                                    points={rows.map((s) => ({ date: s.as_of, value: Number(s.net_worth) }))}
                                    currency={latest.base_currency}
                                />
                            ) : (
                                <p className="text-xs text-slate-500">
                                    The trend line appears once there are snapshots on two or more days.
                                </p>
                            )}
                        </>
                    ) : (
                        <Empty loading={snapshots.isLoading}>
                            No snapshots yet. Add accounts and accept transactions, then update net worth.
                        </Empty>
                    )}
                </section>

                {/* Inbox to review */}
                <section className="sb-card flex flex-col p-5">
                    <CardHeader title="Inbox" to="/inbox" cta="Review" />
                    <div className="flex flex-1 flex-col items-start justify-center">
                        <div className="text-4xl font-bold text-slate-100">{pendingCount}</div>
                        <p className="mt-1 text-sm text-slate-400">
                            {pendingCount === 0
                                ? "Nothing waiting — you're all caught up."
                                : `transaction${pendingCount === 1 ? "" : "s"} awaiting review`}
                        </p>
                        {pendingCount > 0 && (
                            <Link
                                to="/inbox"
                                className="mt-4 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500"
                            >
                                Review inbox →
                            </Link>
                        )}
                    </div>
                </section>

                {/* This month in/out */}
                <section className="sb-card p-5">
                    <CardHeader title={`This month · ${monthLabel}`} to="/reports" cta="Reports" />
                    <div className="mb-4 grid grid-cols-2 gap-3">
                        <MoneyRows label="In" rows={income} tone="text-emerald-400" />
                        <MoneyRows label="Out" rows={expense} tone="text-rose-300" />
                    </div>
                    {topCategories.length > 0 ? (
                        <div className="flex flex-col gap-2">
                            {topCategories.map((row) => (
                                <div
                                    key={`${row.category_group}-${row.category}-${row.currency}`}
                                    className="flex items-center justify-between gap-3 text-sm"
                                >
                                    <span className="min-w-0 truncate text-slate-300">
                                        {row.icon} {row.category}
                                    </span>
                                    <span className="shrink-0 font-medium text-slate-200">
                                        {fmtMoney(Number(row.total_amount), row.currency)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <Empty loading={byCategory.isLoading}>No accepted spending yet this month.</Empty>
                    )}
                </section>

                {/* Accounts + recent activity */}
                <section className="sb-card p-5 lg:col-span-2">
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <CardHeader title="Accounts" to="/accounts" cta="Manage" />
                            {activeAccounts.length > 0 ? (
                                <ul className="flex flex-col gap-2">
                                    {activeAccounts.slice(0, 5).map((a) => (
                                        <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                                            <span className="min-w-0 truncate text-slate-300">{a.name}</span>
                                            <span className="shrink-0 font-medium text-slate-200">
                                                {fmtMoney(Number(a.current_balance), a.currency)}
                                            </span>
                                        </li>
                                    ))}
                                    {activeAccounts.length > 5 && (
                                        <li className="text-xs text-slate-500">
                                            +{activeAccounts.length - 5} more
                                        </li>
                                    )}
                                </ul>
                            ) : (
                                <Empty loading={balances.isLoading}>No accounts yet.</Empty>
                            )}
                        </div>
                        <div>
                            <CardHeader title="Recent activity" to="/transactions" cta="All" />
                            {(recent.data ?? []).length > 0 ? (
                                <ul className="flex flex-col gap-2">
                                    {(recent.data ?? []).map((t) => (
                                        <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                                            <span className="min-w-0">
                                                <span className="block truncate text-slate-300">
                                                    {t.payee ?? "(no payee)"}
                                                </span>
                                                <span className="text-xs text-slate-500">
                                                    {fmtDate(t.occurred_at)}
                                                </span>
                                            </span>
                                            <span
                                                className={`shrink-0 font-medium ${
                                                    t.kind === "income" ? "text-emerald-400" : "text-slate-200"
                                                }`}
                                            >
                                                {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                                                {fmtMoney(Number(t.amount), t.currency)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <Empty loading={recent.isLoading}>No accepted transactions yet.</Empty>
                            )}
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

function CardHeader({ title, to, cta }: { title: string; to: string; cta: string }) {
    return (
        <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
            <Link to={to} className="text-xs font-medium text-emerald-400 hover:text-emerald-300">
                {cta} →
            </Link>
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`mt-1 text-lg font-semibold ${tone}`}>{value}</div>
        </div>
    );
}

function MoneyRows({ label, rows, tone }: { label: string; rows: MonthlySummaryRow[]; tone: string }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="text-xs text-slate-500">{label}</div>
            {rows.length === 0 ? (
                <div className="mt-1 text-lg font-semibold text-slate-500">—</div>
            ) : (
                rows.map((r) => (
                    <div key={r.currency} className={`mt-1 text-lg font-semibold ${tone}`}>
                        {fmtMoney(Number(r.total_amount), r.currency)}
                    </div>
                ))
            )}
        </div>
    );
}

function Empty({ loading, children }: { loading: boolean; children: React.ReactNode }) {
    return <p className="text-sm text-slate-500">{loading ? "Loading…" : children}</p>;
}
