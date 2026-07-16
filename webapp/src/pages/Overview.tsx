import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Icon, NAV } from "../components/nav";
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
    const first = rows.length ? rows[0] : null;
    const pendingCount = pending.data?.length ?? 0;
    const income = (monthly.data ?? []).filter((r) => r.kind === "income");
    const expense = (monthly.data ?? []).filter((r) => r.kind === "expense");
    const topCategories = (byCategory.data ?? []).slice(0, 4);
    const activeAccounts = (balances.data ?? []).filter((a) => !a.is_archived);

    // Percentage change across the loaded snapshot window — Twisty's "+20%".
    const startVal = first ? Number(first.net_worth) : 0;
    const endVal = latest ? Number(latest.net_worth) : 0;
    const pctChange = startVal !== 0 ? ((endVal - startVal) / Math.abs(startVal)) * 100 : null;
    const up = pctChange === null ? true : pctChange >= 0;

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-100">Overview</h1>
                    <p className="mt-1 text-sm text-slate-400">
                        Everything at a glance. Hit{" "}
                        <span className="font-semibold text-coral">+</span> to add anything — a note,
                        a receipt, or a statement.
                    </p>
                </div>
            </div>

            {/* Quick actions — jump to the tools that aren't pinned in the top bar */}
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                {QUICK_ACTIONS.map((item) => (
                    <Link
                        key={item.to}
                        to={item.to}
                        className="group flex items-center gap-2.5 rounded-2xl border border-slate-800 bg-slate-900 px-3.5 py-3 shadow-card transition-colors hover:border-coral/40 hover:bg-slate-950"
                    >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-slate-500 transition-colors group-hover:bg-coral-soft group-hover:text-coral">
                            <Icon name={item.icon} />
                        </span>
                        <span className="truncate text-sm font-medium text-slate-200">{item.label}</span>
                    </Link>
                ))}
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
                {/* Hero — net worth tracker (Twisty "Income Tracker") --------- */}
                <section className="sb-card p-6 sm:p-7 lg:col-span-2">
                    <div className="mb-5 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-coral-soft text-coral">
                                <WalletIcon />
                            </span>
                            <div>
                                <h2 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                                    Net worth
                                </h2>
                                <p className="mt-1 max-w-md text-sm text-slate-400">
                                    Track how your wealth moves over time across every account.
                                </p>
                            </div>
                        </div>
                        <Link
                            to="/net-worth"
                            className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-slate-300 shadow-sm hover:text-slate-100"
                        >
                            Details →
                        </Link>
                    </div>

                    {latest ? (
                        <>
                            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
                                <div>
                                    <div className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
                                        {fmtMoney(endVal, latest.base_currency)}
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                        As of {fmtDate(latest.as_of)}
                                    </p>
                                </div>
                                {pctChange !== null && (
                                    <div>
                                        <div
                                            className={`flex items-center gap-1 text-2xl font-bold sm:text-3xl ${
                                                up ? "text-emerald-400" : "text-rose-400"
                                            }`}
                                        >
                                            {up ? "+" : ""}
                                            {pctChange.toFixed(1)}%
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">
                                            since {fmtDate(first!.as_of)}
                                        </p>
                                    </div>
                                )}
                                <div className="ml-auto flex gap-2">
                                    <MiniStat
                                        label="Assets"
                                        value={fmtMoney(Number(latest.assets), latest.base_currency)}
                                        tone="text-emerald-400"
                                    />
                                    <MiniStat
                                        label="Liabilities"
                                        value={fmtMoney(Number(latest.liabilities), latest.base_currency)}
                                        tone="text-rose-400"
                                    />
                                </div>
                            </div>
                            <div className="mt-5">
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
                            </div>
                        </>
                    ) : (
                        <Empty loading={snapshots.isLoading}>
                            No snapshots yet. Add accounts and accept transactions, then update net worth.
                        </Empty>
                    )}
                </section>

                {/* Inbox to review — accent tile ----------------------------- */}
                <section className="sb-card flex flex-col justify-between bg-navy p-6 text-navy-ink">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-sm font-semibold text-white/80">Inbox</h2>
                        <Link to="/inbox" className="text-xs font-medium text-white/60 hover:text-white">
                            Review →
                        </Link>
                    </div>
                    <div className="py-6">
                        <div className="text-5xl font-bold text-white">{pendingCount}</div>
                        <p className="mt-2 text-sm text-white/60">
                            {pendingCount === 0
                                ? "Nothing waiting — you're all caught up."
                                : `transaction${pendingCount === 1 ? "" : "s"} awaiting review`}
                        </p>
                    </div>
                    <Link
                        to="/inbox"
                        className={`inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                            pendingCount > 0
                                ? "bg-coral text-white hover:bg-coral-600"
                                : "bg-white/10 text-white/70 hover:bg-white/15"
                        }`}
                    >
                        {pendingCount > 0 ? "Review inbox →" : "Open inbox →"}
                    </Link>
                </section>

                {/* This month in/out ----------------------------------------- */}
                <section className="sb-card p-6">
                    <CardHeader title={`This month · ${monthLabel}`} to="/reports" cta="Reports" />
                    <div className="mb-4 grid grid-cols-2 gap-3">
                        <MoneyRows label="In" rows={income} tone="text-emerald-400" />
                        <MoneyRows label="Out" rows={expense} tone="text-rose-400" />
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

                {/* Accounts -------------------------------------------------- */}
                <section className="sb-card p-6">
                    <CardHeader title="Accounts" to="/accounts" cta="Manage" />
                    {activeAccounts.length > 0 ? (
                        <ul className="flex flex-col gap-1.5">
                            {activeAccounts.slice(0, 5).map((a, i) => (
                                <li
                                    key={a.id}
                                    className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-950"
                                >
                                    <span
                                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
                                        style={ACCOUNT_TINTS[i % ACCOUNT_TINTS.length]}
                                    >
                                        {a.name.slice(0, 1).toUpperCase()}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-slate-300">{a.name}</span>
                                    <span className="shrink-0 font-medium text-slate-200">
                                        {fmtMoney(Number(a.current_balance), a.currency)}
                                    </span>
                                </li>
                            ))}
                            {activeAccounts.length > 5 && (
                                <li className="px-2 text-xs text-slate-500">
                                    +{activeAccounts.length - 5} more
                                </li>
                            )}
                        </ul>
                    ) : (
                        <Empty loading={balances.isLoading}>No accounts yet.</Empty>
                    )}
                </section>

                {/* Recent activity ------------------------------------------- */}
                <section className="sb-card p-6 lg:col-span-2">
                    <CardHeader title="Recent activity" to="/transactions" cta="View all" />
                    {(recent.data ?? []).length > 0 ? (
                        <ul className="grid gap-1.5 sm:grid-cols-2">
                            {(recent.data ?? []).map((t) => (
                                <li
                                    key={t.id}
                                    className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-950"
                                >
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
                </section>
            </div>
        </div>
    );
}

/** Secondary destinations surfaced as dashboard shortcuts — everything except
 * the pages pinned/recent in the top bar (Overview, Inbox, Transactions) and
 * Settings (reachable from the account menu). */
const QUICK_ACTIONS = NAV.filter(
    (n) => !["/", "/inbox", "/transactions", "/settings"].includes(n.to),
);

/** Soft tinted avatar swatches for the account list (cycled). */
const ACCOUNT_TINTS: React.CSSProperties[] = [
    { backgroundColor: "var(--color-coral-soft)", color: "var(--color-coral-ink)" },
    { backgroundColor: "var(--color-sage)", color: "var(--color-sage-ink)" },
    { backgroundColor: "var(--color-violet)", color: "var(--color-violet-ink)" },
    { backgroundColor: "var(--color-gold)", color: "var(--color-gold-ink)" },
];

function CardHeader({ title, to, cta }: { title: string; to: string; cta: string }) {
    return (
        <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
            <Link to={to} className="text-xs font-medium text-coral hover:text-coral-600">
                {cta} →
            </Link>
        </div>
    );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
            <div className="text-[0.7rem] text-slate-500">{label}</div>
            <div className={`mt-0.5 text-sm font-semibold ${tone}`}>{value}</div>
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

function WalletIcon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
                d="M3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinejoin="round"
            />
            <path d="M16 12h3M3 9h13a3 3 0 0 1 3 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}
