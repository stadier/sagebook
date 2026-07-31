import NetWorthChart from "../components/NetWorthChart";
import {
    Card,
    CardHeader,
    Empty,
    LegendDot,
    Meter,
    PageHeader,
    QueryError,
    StatCard,
} from "../components/ui";
import { DEFAULT_CURRENCY } from "../lib/constants";
import { fmtMoney } from "../lib/format";
import {
    useCategorySummary,
    useMonthlySummary,
    useMonthlySummaryHistory,
    useNetWorthSnapshots,
} from "../lib/queries";
import { CHART_COLORS, colorFor } from "../lib/theme";
import type { MonthlySummaryRow } from "../lib/types";

/** Months of history in the income-vs-expenses columns. */
const HISTORY_MONTHS = 6;
/** Slices before the donut and its legend stop being readable. */
const DONUT_SLICES = 6;

export default function Reports() {
    const monthLabel = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const monthly = useMonthlySummary();
    const trailing = useMonthlySummaryHistory();
    const byCategory = useCategorySummary();
    const snapshots = useNetWorthSnapshots();

    if (monthly.isError || byCategory.isError) {
        return <QueryError error={monthly.error ?? byCategory.error} />;
    }

    const income = sum((monthly.data ?? []).filter((r) => r.kind === "income"));
    const expense = sum((monthly.data ?? []).filter((r) => r.kind === "expense"));
    const currency = (monthly.data ?? [])[0]?.currency ?? DEFAULT_CURRENCY;
    const netSaved = income - expense;

    const rows = (byCategory.data ?? []).filter((r) => Number(r.total_amount) > 0);
    const categoryTotal = rows.reduce((s, r) => s + Number(r.total_amount), 0);
    const maxAmount = Math.max(1, ...rows.map((r) => Number(r.total_amount)));

    const columns = monthColumns(trailing.data ?? []);
    const snapshotRows = snapshots.data ?? [];

    return (
        <>
            <PageHeader title="Reports" subtitle={`${monthLabel} · accepted transactions only`} />

            <div className="grid gap-3.5 sm:grid-cols-3">
                <StatCard label="Income" value={fmtMoney(income, currency)} tone="positive" />
                <StatCard label="Expenses" value={fmtMoney(expense, currency)} tone="negative" />
                <StatCard
                    label="Net saved"
                    value={`${netSaved >= 0 ? "+" : "−"}${fmtMoney(Math.abs(netSaved), currency)}`}
                    tone="dark"
                    hint={income > 0 ? `${Math.round((netSaved / income) * 100)}% of income kept` : undefined}
                />
            </div>

            <Card feature>
                <CardHeader title="Net worth trend" to="/net-worth" cta="Details" />
                {snapshotRows.length >= 2 ? (
                    <NetWorthChart
                        points={snapshotRows.map((s) => ({ date: s.as_of, value: Number(s.net_worth) }))}
                        currency={snapshotRows[snapshotRows.length - 1].base_currency}
                    />
                ) : (
                    <Empty loading={snapshots.isLoading}>
                        The trend appears once there are snapshots on two or more days.
                    </Empty>
                )}
            </Card>

            <div className="grid gap-[18px] lg:grid-cols-2">
                <Card feature>
                    <CardHeader title="Income vs expenses" />
                    {columns.length > 0 ? (
                        <>
                            <div className="flex h-[140px] items-end gap-3 sm:gap-4">
                                {columns.map((c) => {
                                    const peak = Math.max(
                                        1,
                                        ...columns.flatMap((x) => [x.income, x.expense]),
                                    );
                                    return (
                                        <div
                                            key={c.month}
                                            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
                                        >
                                            <div className="flex h-[112px] w-full items-end justify-center gap-1">
                                                <span
                                                    className="w-1/2 max-w-[22px] rounded-[4px]"
                                                    style={{
                                                        height: `${(c.income / peak) * 100}%`,
                                                        background: CHART_COLORS.positive,
                                                    }}
                                                />
                                                <span
                                                    className="w-1/2 max-w-[22px] rounded-[4px]"
                                                    style={{
                                                        height: `${(c.expense / peak) * 100}%`,
                                                        background: CHART_COLORS.negative,
                                                    }}
                                                />
                                            </div>
                                            <span className="truncate text-[0.6875rem] font-semibold text-slate-500">
                                                {c.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="mt-4 flex gap-5 text-[0.78125rem] text-slate-400">
                                <span className="flex items-center gap-2">
                                    <LegendDot color={CHART_COLORS.positive} />
                                    In
                                </span>
                                <span className="flex items-center gap-2">
                                    <LegendDot color={CHART_COLORS.negative} />
                                    Out
                                </span>
                            </div>
                        </>
                    ) : (
                        <Empty loading={trailing.isLoading}>Not enough months to compare yet.</Empty>
                    )}
                </Card>

                <Card feature>
                    <CardHeader title="Spending by category" />
                    {rows.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-6">
                            <Donut
                                slices={rows.slice(0, DONUT_SLICES).map((r, i) =>({
                                    value: Number(r.total_amount),
                                    color: colorFor(r.color, i),
                                }))}
                                total={categoryTotal}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-2.5 text-[0.78125rem]">
                                {rows.slice(0, DONUT_SLICES).map((r, i) =>(
                                    <span
                                        key={`${r.category_group}-${r.category}-${r.currency}`}
                                        className="flex items-center gap-2 text-slate-300"
                                    >
                                        <LegendDot color={colorFor(r.color, i)} />
                                        <span className="min-w-0 truncate">{r.category}</span>
                                        <span className="ml-auto shrink-0 font-bold text-slate-200 tnum">
                                            {Math.round((Number(r.total_amount) / categoryTotal) * 100)}%
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <Empty loading={byCategory.isLoading}>
                            No accepted transactions this month yet.
                        </Empty>
                    )}
                </Card>
            </div>

            <Card feature>
                <CardHeader title="Every category" />
                {rows.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {rows.map((row, i) => (
                            <div key={`${row.category_group}-${row.category}-${row.currency}`}>
                                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                                    <span className="min-w-0 truncate text-slate-200">
                                        {row.icon} {row.category}
                                        <span className="ml-2 text-xs text-slate-500">
                                            {row.category_group}
                                        </span>
                                    </span>
                                    <span className="shrink-0 font-bold text-slate-100 tnum">
                                        {fmtMoney(Number(row.total_amount), row.currency)}
                                        <span className="ml-2 text-xs font-medium text-slate-500">
                                            ×{row.tx_count}
                                        </span>
                                    </span>
                                </div>
                                <Meter
                                    pct={(Number(row.total_amount) / maxAmount) * 100}
                                    color={colorFor(row.color, i)}
                                    height={7}
                                />
                            </div>
                        ))}
                    </div>
                ) : (
                    <Empty loading={byCategory.isLoading}>No accepted transactions this month yet.</Empty>
                )}
            </Card>
        </>
    );
}

/* -------------------------------------------------------------------------- */

/** SVG donut built from stroke-dasharray arcs, as in the design. */
function Donut({
    slices,
    total,
}: {
    slices: Array<{ value: number; color: string }>;
    total: number;
}) {
    const R = 46;
    const C = 2 * Math.PI * R;
    let offset = 0;

    return (
        <svg width="120" height="120" viewBox="0 0 120 120" className="shrink-0" aria-hidden>
            <circle cx="60" cy="60" r={R} fill="none" stroke={CHART_COLORS.track} strokeWidth="20" />
            {slices.map((s, i) => {
                const len = total > 0 ? (s.value / total) * C : 0;
                const dash = `${len} ${C - len}`;
                const el = (
                    <circle
                        key={i}
                        cx="60"
                        cy="60"
                        r={R}
                        fill="none"
                        stroke={s.color}
                        strokeWidth="20"
                        strokeDasharray={dash}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 60 60)"
                    />
                );
                offset += len;
                return el;
            })}
        </svg>
    );
}

function sum(rows: MonthlySummaryRow[]): number {
    return rows.reduce((s, r) => s + Number(r.total_amount), 0);
}

/** Collapse the monthly summary into the trailing {income, expense} pairs. */
function monthColumns(
    rows: MonthlySummaryRow[],
): Array<{ month: string; label: string; income: number; expense: number }> {
    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const r of rows) {
        const entry = byMonth.get(r.month) ?? { income: 0, expense: 0 };
        if (r.kind === "income") entry.income += Number(r.total_amount);
        if (r.kind === "expense") entry.expense += Number(r.total_amount);
        byMonth.set(r.month, entry);
    }
    return [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-HISTORY_MONTHS)
        .map(([month, v]) => ({
            month,
            label: new Date(`${month}T00:00:00`).toLocaleDateString(undefined, { month: "short" }),
            ...v,
        }));
}
