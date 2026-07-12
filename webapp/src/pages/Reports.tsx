import { useQuery } from "@tanstack/react-query";
import { currentMonthStart, fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import type { CategorySummaryRow, MonthlySummaryRow } from "../lib/types";

export default function Reports() {
    const month = currentMonthStart();
    const monthLabel = new Date().toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
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

    if (monthly.isError || byCategory.isError) {
        const err = (monthly.error ?? byCategory.error) as Error;
        return <p className="text-sm text-rose-400">{err.message}</p>;
    }

    const income = (monthly.data ?? []).filter((r) => r.kind === "income");
    const expense = (monthly.data ?? []).filter((r) => r.kind === "expense");
    const maxAmount = Math.max(1, ...(byCategory.data ?? []).map((r) => Number(r.total_amount)));

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold text-slate-100">Reports</h1>
            <p className="mb-6 text-sm text-slate-400">{monthLabel} · accepted transactions only.</p>

            <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <StatCard title="Income" rows={income} variant="income" />
                <StatCard title="Expenses" rows={expense} variant="expense" />
            </div>

            <div className="sb-card p-4 sm:p-5">
                <h2 className="mb-4 text-sm font-semibold text-slate-200">By category</h2>
                {byCategory.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
                {(byCategory.data ?? []).length === 0 && !byCategory.isLoading && (
                    <p className="text-sm text-slate-500">No accepted transactions this month yet.</p>
                )}
                <div className="flex flex-col gap-4">
                    {(byCategory.data ?? []).map((row) => (
                        <div key={`${row.category_group}-${row.category}-${row.currency}`}>
                            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate text-slate-200">
                                    {row.icon} {row.category}
                                    <span className="ml-2 text-xs text-slate-500">
                                        {row.category_group}
                                    </span>
                                </span>
                                <span className="shrink-0 font-medium text-slate-100">
                                    {fmtMoney(Number(row.total_amount), row.currency)}
                                    <span className="ml-2 text-xs font-normal text-slate-500">
                                        ×{row.tx_count}
                                    </span>
                                </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        width: `${(Number(row.total_amount) / maxAmount) * 100}%`,
                                        backgroundColor: row.color ?? "#8a8574",
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function StatCard({
    title,
    rows,
    variant,
}: {
    title: string;
    rows: MonthlySummaryRow[];
    variant: "income" | "expense";
}) {
    const isIncome = variant === "income";
    const tone = isIncome ? "bg-sage text-sage-ink" : "bg-gold text-gold-ink";

    return (
        <div className={`sb-stat ${tone}`}>
            <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-medium opacity-80">{title}</span>
                <span className="sb-pill bg-black/10">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                            d={isIncome ? "M7 17 17 7M9 7h8v8" : "M7 7l10 10M9 17h8V9"}
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                    {isIncome ? "in" : "out"}
                </span>
            </div>
            {rows.length === 0 ? (
                <p className="text-2xl font-bold opacity-40">—</p>
            ) : (
                rows.map((r) => (
                    <p key={r.currency} className="text-2xl font-bold leading-tight">
                        {fmtMoney(Number(r.total_amount), r.currency)}
                        <span className="ml-2 align-middle text-xs font-medium opacity-60">
                            {r.tx_count} tx
                        </span>
                    </p>
                ))
            )}
        </div>
    );
}
