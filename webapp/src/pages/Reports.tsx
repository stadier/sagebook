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
            <h1 className="mb-1 text-xl font-semibold">Reports</h1>
            <p className="mb-6 text-sm text-slate-400">{monthLabel} · accepted transactions only.</p>

            <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <SummaryCard title="Income" rows={income} tone="text-emerald-400" />
                <SummaryCard title="Expenses" rows={expense} tone="text-rose-300" />
            </div>

            <h2 className="mb-3 text-sm font-semibold text-slate-200">By category</h2>
            {byCategory.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {(byCategory.data ?? []).length === 0 && !byCategory.isLoading && (
                <p className="text-sm text-slate-500">No accepted transactions this month yet.</p>
            )}
            <div className="flex flex-col gap-2">
                {(byCategory.data ?? []).map((row) => (
                    <div
                        key={`${row.category_group}-${row.category}-${row.currency}`}
                        className="rounded-lg border border-slate-800 bg-slate-900/60 p-3"
                    >
                        <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="text-slate-200">
                                {row.icon} {row.category}
                                <span className="ml-2 text-xs text-slate-500">{row.category_group}</span>
                            </span>
                            <span className="font-medium">
                                {fmtMoney(Number(row.total_amount), row.currency)}
                                <span className="ml-2 text-xs text-slate-500">×{row.tx_count}</span>
                            </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-slate-800">
                            <div
                                className="h-full rounded"
                                style={{
                                    width: `${(Number(row.total_amount) / maxAmount) * 100}%`,
                                    backgroundColor: row.color ?? "#64748b",
                                }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function SummaryCard({
    title,
    rows,
    tone,
}: {
    title: string;
    rows: MonthlySummaryRow[];
    tone: string;
}) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-2 text-sm text-slate-400">{title}</h2>
            {rows.length === 0 ? (
                <p className="text-lg font-semibold text-slate-600">—</p>
            ) : (
                rows.map((r) => (
                    <p key={r.currency} className={`text-lg font-semibold ${tone}`}>
                        {fmtMoney(Number(r.total_amount), r.currency)}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                            {r.tx_count} tx
                        </span>
                    </p>
                ))
            )}
        </div>
    );
}
