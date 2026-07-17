/* Data-backed widgets the console generates in response to a query. Each panel
 * reads from the same Supabase views the classic dashboard uses (shared React
 * Query cache keys), so a generated view is live data, not a mock. Rendered by
 * <GeneratedView> from the panel ids on a matched intent. */

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import NetWorthChart from "../NetWorthChart";
import { currentMonthStart, fmtDate, fmtMoney } from "../../lib/format";
import { requireSupabase } from "../../lib/supabase";
import type {
    AccountWithBalance,
    CategorySummaryRow,
    MonthlySummaryRow,
    NetWorthSnapshot,
    PendingTransaction,
    Transaction,
} from "../../lib/types";
import type { PanelId } from "../../lib/console/intents";

type RecentTx = Pick<Transaction, "id" | "kind" | "occurred_at" | "amount" | "currency" | "payee">;

/** Render the ordered panels for a matched intent. */
export default function GeneratedView({ panels }: { panels: PanelId[] }) {
    return (
        <div className="grid gap-5 md:grid-cols-2">
            {panels.map((id, i) => (
                <div key={id} className={PANEL_SPAN[id] ?? ""} style={{ order: i }}>
                    {renderPanel(id)}
                </div>
            ))}
        </div>
    );
}

// Which panels want the full width of the two-column canvas.
const PANEL_SPAN: Partial<Record<PanelId, string>> = {
    networth: "md:col-span-2",
    categories: "md:col-span-2",
    recent: "md:col-span-2",
};

function renderPanel(id: PanelId) {
    switch (id) {
        case "networth":
            return <NetWorthPanel />;
        case "month":
            return <MonthPanel />;
        case "categories":
            return <CategoriesPanel />;
        case "accounts":
            return <AccountsPanel />;
        case "recent":
            return <RecentPanel />;
        case "inbox":
            return <InboxPanel />;
    }
}

/* --- shared query hooks (cache keys match the classic dashboard) ---------- */

function useNetWorth() {
    return useQuery({
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
}

function useMonthly() {
    const month = currentMonthStart();
    return useQuery({
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
}

function useCategories() {
    const month = currentMonthStart();
    return useQuery({
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
}

function useBalances() {
    return useQuery({
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
}

function useRecent() {
    return useQuery({
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
}

function usePending() {
    return useQuery({
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
}

/* --- panels --------------------------------------------------------------- */

function NetWorthPanel() {
    const q = useNetWorth();
    const rows = q.data ?? [];
    const latest = rows.length ? rows[rows.length - 1] : null;
    const first = rows.length ? rows[0] : null;
    const startVal = first ? Number(first.net_worth) : 0;
    const endVal = latest ? Number(latest.net_worth) : 0;
    const pct = startVal !== 0 ? ((endVal - startVal) / Math.abs(startVal)) * 100 : null;
    const up = pct === null ? true : pct >= 0;

    return (
        <Panel title="Net worth" to="/net-worth" cta="Open">
            {latest ? (
                <>
                    <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                        <div>
                            <div className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
                                {fmtMoney(endVal, latest.base_currency)}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">As of {fmtDate(latest.as_of)}</p>
                        </div>
                        {pct !== null && (
                            <div className={`text-2xl font-bold ${up ? "text-emerald-400" : "text-rose-400"}`}>
                                {up ? "+" : ""}
                                {pct.toFixed(1)}%
                            </div>
                        )}
                        <div className="ml-auto flex gap-2">
                            <Mini label="Assets" value={fmtMoney(Number(latest.assets), latest.base_currency)} tone="text-emerald-400" />
                            <Mini label="Liabilities" value={fmtMoney(Number(latest.liabilities), latest.base_currency)} tone="text-rose-400" />
                        </div>
                    </div>
                    <div className="mt-5">
                        {rows.length >= 2 ? (
                            <NetWorthChart
                                points={rows.map((s) => ({ date: s.as_of, value: Number(s.net_worth) }))}
                                currency={latest.base_currency}
                            />
                        ) : (
                            <Muted>The trend line appears once there are snapshots on two or more days.</Muted>
                        )}
                    </div>
                </>
            ) : (
                <Empty loading={q.isLoading}>No snapshots yet — add accounts and accept transactions.</Empty>
            )}
        </Panel>
    );
}

function MonthPanel() {
    const q = useMonthly();
    const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const income = (q.data ?? []).filter((r) => r.kind === "income");
    const expense = (q.data ?? []).filter((r) => r.kind === "expense");
    return (
        <Panel title={`This month · ${monthLabel}`} to="/reports" cta="Reports">
            <div className="grid grid-cols-2 gap-3">
                <MoneyRows label="In" rows={income} tone="text-emerald-400" />
                <MoneyRows label="Out" rows={expense} tone="text-rose-400" />
            </div>
            {q.data && q.data.length === 0 && <Empty loading={false}>No accepted activity yet this month.</Empty>}
            {q.isLoading && <Empty loading>…</Empty>}
        </Panel>
    );
}

function CategoriesPanel() {
    const q = useCategories();
    const rows = (q.data ?? []).slice(0, 6);
    const max = rows.length ? Math.max(...rows.map((r) => Number(r.total_amount))) : 0;
    return (
        <Panel title="Spending by category" to="/reports" cta="Reports">
            {rows.length > 0 ? (
                <div className="flex flex-col gap-3">
                    {rows.map((row) => (
                        <div key={`${row.category_group}-${row.category}-${row.currency}`}>
                            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate text-slate-300">
                                    {row.icon} {row.category}
                                </span>
                                <span className="shrink-0 font-medium text-slate-200">
                                    {fmtMoney(Number(row.total_amount), row.currency)}
                                </span>
                            </div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-slate-950">
                                <div
                                    className="h-full rounded-full bg-coral"
                                    style={{ width: `${max ? (Number(row.total_amount) / max) * 100 : 0}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty loading={q.isLoading}>No accepted spending yet this month.</Empty>
            )}
        </Panel>
    );
}

function AccountsPanel() {
    const q = useBalances();
    const active = (q.data ?? []).filter((a) => !a.is_archived);
    return (
        <Panel title="Accounts" to="/accounts" cta="Manage">
            {active.length > 0 ? (
                <ul className="flex flex-col gap-1">
                    {active.slice(0, 6).map((a) => {
                        const meta = [a.institution, a.metadata?.number_masked].filter(Boolean).join(" · ");
                        return (
                            <li key={a.id} className="flex items-start justify-between gap-3 rounded-xl px-2 py-2 hover:bg-slate-950">
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-slate-200">{a.name}</div>
                                    {meta && <div className="mt-0.5 truncate text-xs text-slate-500">{meta}</div>}
                                </div>
                                <span className="shrink-0 text-sm font-semibold text-slate-200">
                                    {fmtMoney(Number(a.current_balance), a.currency)}
                                </span>
                            </li>
                        );
                    })}
                    {active.length > 6 && <li className="px-2 pt-1 text-xs text-slate-500">+{active.length - 6} more</li>}
                </ul>
            ) : (
                <Empty loading={q.isLoading}>No accounts yet.</Empty>
            )}
        </Panel>
    );
}

function RecentPanel() {
    const q = useRecent();
    const rows = q.data ?? [];
    return (
        <Panel title="Recent activity" to="/transactions" cta="View all">
            {rows.length > 0 ? (
                <ul className="grid gap-0.5 sm:grid-cols-2">
                    {rows.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-950">
                            <span className="min-w-0">
                                <span className="block truncate text-slate-300">{t.payee ?? "(no payee)"}</span>
                                <span className="text-xs text-slate-500">{fmtDate(t.occurred_at)}</span>
                            </span>
                            <span className={`shrink-0 font-medium ${t.kind === "income" ? "text-emerald-400" : "text-slate-200"}`}>
                                {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                                {fmtMoney(Number(t.amount), t.currency)}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : (
                <Empty loading={q.isLoading}>No accepted transactions yet.</Empty>
            )}
        </Panel>
    );
}

function InboxPanel() {
    const q = usePending();
    const count = q.data?.length ?? 0;
    return (
        <div className="sb-card flex flex-col justify-between bg-navy p-6 text-navy-ink">
            <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white/80">Waiting for review</h2>
                <Link to="/inbox" className="text-xs font-medium text-white/60 hover:text-white">
                    Review →
                </Link>
            </div>
            <div className="py-6">
                <div className="text-5xl font-bold text-white">{q.isLoading ? "…" : count}</div>
                <p className="mt-2 text-sm text-white/60">
                    {count === 0 ? "Nothing waiting — you're all caught up." : `item${count === 1 ? "" : "s"} Sage captured, ready for you to confirm`}
                </p>
            </div>
            <Link
                to="/inbox"
                className={`inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                    count > 0 ? "bg-coral text-white hover:bg-coral-600" : "bg-white/10 text-white/70 hover:bg-white/15"
                }`}
            >
                {count > 0 ? "Review inbox →" : "Open inbox →"}
            </Link>
        </div>
    );
}

/* --- small shared bits ---------------------------------------------------- */

function Panel({ title, to, cta, children }: { title: string; to: string; cta: string; children: React.ReactNode }) {
    return (
        <section className="sb-card p-6">
            <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
                <Link to={to} className="text-xs font-medium text-coral hover:text-coral-600">
                    {cta} →
                </Link>
            </div>
            {children}
        </section>
    );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
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

function Muted({ children }: { children: React.ReactNode }) {
    return <p className="text-xs text-slate-500">{children}</p>;
}
