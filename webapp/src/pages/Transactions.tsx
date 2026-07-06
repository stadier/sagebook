import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fmtDate, fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import type { Transaction } from "../lib/types";

interface TxRow extends Transaction {
    categories: { name: string; icon: string | null; color: string | null } | null;
}

export default function Transactions() {
    const [search, setSearch] = useState("");

    const txs = useQuery({
        queryKey: ["transactions"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("transactions")
                .select("*, categories(name, icon, color)")
                .eq("review_status", "accepted")
                .order("occurred_at", { ascending: false })
                .limit(300);
            if (error) throw new Error(error.message);
            return (data ?? []) as TxRow[];
        },
    });

    const term = search.trim().toLowerCase();
    const rows = (txs.data ?? []).filter(
        (t) =>
            !term ||
            (t.payee ?? "").toLowerCase().includes(term) ||
            (t.memo ?? "").toLowerCase().includes(term) ||
            (t.categories?.name ?? "").toLowerCase().includes(term),
    );

    return (
        <div className="mx-auto max-w-4xl">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Transactions</h1>
                    <p className="text-sm text-slate-400">Accepted ledger entries.</p>
                </div>
                <input
                    className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    placeholder="Search payee, memo, category…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {txs.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {txs.isError && (
                <p className="text-sm text-rose-400">{(txs.error as Error).message}</p>
            )}

            {txs.isSuccess && rows.length === 0 && (
                <p className="text-sm text-slate-500">
                    {term ? "No matches." : "No accepted transactions yet — review your inbox."}
                </p>
            )}

            {rows.length > 0 && (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                            <th className="py-2 pr-4 font-medium">Date</th>
                            <th className="py-2 pr-4 font-medium">Payee</th>
                            <th className="py-2 pr-4 font-medium">Category</th>
                            <th className="py-2 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                        {rows.map((t) => (
                            <tr key={t.id}>
                                <td className="whitespace-nowrap py-2 pr-4 text-slate-400">
                                    {fmtDate(t.occurred_at)}
                                </td>
                                <td className="py-2 pr-4">
                                    <div className="text-slate-200">{t.payee ?? "—"}</div>
                                    {t.memo && <div className="text-xs text-slate-500">{t.memo}</div>}
                                </td>
                                <td className="py-2 pr-4">
                                    {t.categories ? (
                                        <span
                                            className="rounded px-2 py-0.5 text-xs"
                                            style={{
                                                backgroundColor: `${t.categories.color ?? "#64748b"}26`,
                                                color: t.categories.color ?? "#94a3b8",
                                            }}
                                        >
                                            {t.categories.icon} {t.categories.name}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-600">uncategorized</span>
                                    )}
                                </td>
                                <td
                                    className={`whitespace-nowrap py-2 text-right font-medium ${
                                        t.kind === "income" ? "text-emerald-400" : "text-slate-200"
                                    }`}
                                >
                                    {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                                    {fmtMoney(t.amount, t.currency)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}
