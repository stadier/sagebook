import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import NetWorthChart from "../components/NetWorthChart";
import { fmtDate, fmtMoney } from "../lib/format";
import { logEvent } from "../lib/logger";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type { NetWorthSnapshot } from "../lib/types";

export default function NetWorth() {
    const qc = useQueryClient();

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

    // One click: sync today's FX rates, fill missing base_amounts, snapshot.
    const update = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            await invokeFn("sync-fx-rates", {});
            const base = await sb.rpc("refresh_my_base_amounts");
            if (base.error) throw new Error(base.error.message);
            const snap = await sb.rpc("refresh_my_net_worth");
            if (snap.error) throw new Error(snap.error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["net-worth"] }),
        onError: (error) => {
            logEvent("error", "networth", `Net worth update failed: ${(error as Error).message}`);
        },
    });

    const rows = snapshots.data ?? [];
    const latest = rows.length ? rows[rows.length - 1] : null;

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Net worth</h1>
                    <p className="text-sm text-slate-400">
                        Account balances converted to your base currency, snapshotted daily.
                    </p>
                </div>
                <button
                    className="self-start rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    disabled={update.isPending}
                    onClick={() => update.mutate()}
                >
                    {update.isPending ? "Updating…" : "Update now"}
                </button>
            </div>

            {update.isError && (
                <p className="mb-4 text-sm text-rose-400">{(update.error as Error).message}</p>
            )}
            {snapshots.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {snapshots.isError && (
                <p className="text-sm text-rose-400">{(snapshots.error as Error).message}</p>
            )}

            {snapshots.isSuccess && !latest && (
                <p className="text-sm text-slate-500">
                    No snapshots yet. Create accounts, accept some transactions, then hit
                    "Update now".
                </p>
            )}

            {latest && (
                <>
                    <div className="mb-6 grid gap-4 sm:grid-cols-3">
                        <StatTile
                            label={`Net worth · ${fmtDate(latest.as_of)}`}
                            value={fmtMoney(Number(latest.net_worth), latest.base_currency)}
                            tone="text-slate-100"
                        />
                        <StatTile
                            label="Assets"
                            value={fmtMoney(Number(latest.assets), latest.base_currency)}
                            tone="text-emerald-400"
                        />
                        <StatTile
                            label="Liabilities"
                            value={fmtMoney(Number(latest.liabilities), latest.base_currency)}
                            tone="text-rose-300"
                        />
                    </div>

                    {rows.length >= 2 ? (
                        <div className="mb-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <h2 className="mb-2 text-sm font-medium text-slate-200">
                                Net worth over time
                            </h2>
                            <NetWorthChart
                                points={rows.map((s) => ({
                                    date: s.as_of,
                                    value: Number(s.net_worth),
                                }))}
                                currency={latest.base_currency}
                            />
                        </div>
                    ) : (
                        <p className="mb-6 text-xs text-slate-500">
                            The trend line appears once there are snapshots on two or more days.
                        </p>
                    )}

                    <h2 className="mb-2 text-sm font-medium text-slate-200">
                        Breakdown · {fmtDate(latest.as_of)}
                    </h2>
                    <div className="-mx-1 overflow-x-auto px-1">
                    <table className="w-full min-w-[28rem] text-sm">
                        <thead>
                            <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                                <th className="py-2 pr-4 font-medium">Account</th>
                                <th className="py-2 pr-4 font-medium">Balance</th>
                                <th className="py-2 text-right font-medium">
                                    In {latest.base_currency}
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60">
                            {(latest.breakdown ?? []).map((b) => (
                                <tr key={b.account_id}>
                                    <td className="py-2 pr-4">
                                        <div className="text-slate-200">{b.name}</div>
                                        <div className="text-xs text-slate-500">{b.type.replace("_", " ")}</div>
                                    </td>
                                    <td className="py-2 pr-4 text-slate-300">
                                        {fmtMoney(Number(b.balance), b.currency)}
                                    </td>
                                    <td className="py-2 text-right text-slate-200">
                                        {b.rate_missing ? (
                                            <span className="text-xs text-amber-400" title="No FX rate for this currency yet — excluded from totals. Try 'Update now'.">
                                                ⚠ no rate
                                            </span>
                                        ) : (
                                            fmtMoney(Number(b.base_amount ?? 0), latest.base_currency)
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    </div>
                </>
            )}
        </div>
    );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs text-slate-500">{label}</div>
            <div className={`mt-1 text-lg font-semibold ${tone}`}>{value}</div>
        </div>
    );
}
