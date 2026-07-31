import { useMutation, useQueryClient } from "@tanstack/react-query";
import NetWorthChart from "../components/NetWorthChart";
import { Card, CardHeader, Empty, PageHeader, QueryError, StatCard } from "../components/ui";
import { accountTypeLabel } from "../lib/constants";
import { fmtDate, fmtMoney } from "../lib/format";
import { logEvent } from "../lib/logger";
import { QK, useNetWorthSnapshots } from "../lib/queries";
import { invokeFn, requireSupabase } from "../lib/supabase";

export default function NetWorth() {
    const qc = useQueryClient();
    const snapshots = useNetWorthSnapshots();

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
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.netWorth }),
        onError: (error) => {
            logEvent("error", "networth", `Net worth update failed: ${(error as Error).message}`);
        },
    });

    const rows = snapshots.data ?? [];
    const latest = rows.length ? rows[rows.length - 1] : null;

    return (
        <>
            <PageHeader
                title="Net worth"
                subtitle="Account balances converted to your base currency, snapshotted daily."
            >
                <button
                    className="sb-btn sb-btn-primary"
                    disabled={update.isPending}
                    onClick={() => update.mutate()}
                >
                    {update.isPending ? "Updating…" : "Update now"}
                </button>
            </PageHeader>

            <QueryError error={update.error} />
            <QueryError error={snapshots.error} />
            {snapshots.isLoading && <p className="text-sm text-slate-400">Loading…</p>}

            {snapshots.isSuccess && !latest && (
                <p className="text-sm text-slate-500">
                    No snapshots yet. Create accounts, accept some transactions, then hit
                    "Update now".
                </p>
            )}

            {latest && (
                <>
                    <div className="grid gap-3.5 sm:grid-cols-3">
                        <StatCard
                            label={`Net worth · ${fmtDate(latest.as_of)}`}
                            value={fmtMoney(Number(latest.net_worth), latest.base_currency)}
                            tone="dark"
                        />
                        <StatCard
                            label="Assets"
                            value={fmtMoney(Number(latest.assets), latest.base_currency)}
                            tone="positive"
                        />
                        <StatCard
                            label="Liabilities"
                            value={fmtMoney(Number(latest.liabilities), latest.base_currency)}
                            tone="negative"
                        />
                    </div>

                    <Card feature>
                        <CardHeader title="Net worth over time" />
                        {rows.length >= 2 ? (
                            <NetWorthChart
                                points={rows.map((s) => ({
                                    date: s.as_of,
                                    value: Number(s.net_worth),
                                }))}
                                currency={latest.base_currency}
                            />
                        ) : (
                            <Empty>
                                The trend line appears once there are snapshots on two or more days.
                            </Empty>
                        )}
                    </Card>

                    <Card padded={false}>
                        <div className="border-b border-slate-800 px-5 py-4">
                            <h2 className="text-[0.8125rem] font-bold text-slate-200">
                                Breakdown · {fmtDate(latest.as_of)}
                            </h2>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[28rem] text-sm">
                                <thead>
                                    <tr className="border-b border-slate-800 text-left text-[0.6875rem] font-bold uppercase tracking-[0.06em] text-slate-500">
                                        <th className="px-5 py-3">Account</th>
                                        <th className="px-5 py-3">Balance</th>
                                        <th className="px-5 py-3 text-right">
                                            In {latest.base_currency}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(latest.breakdown ?? []).map((b) => (
                                        <tr key={b.account_id} className="border-b border-slate-800 last:border-0">
                                            <td className="px-5 py-3">
                                                <div className="font-medium text-slate-200">{b.name}</div>
                                                <div className="text-xs text-slate-500">
                                                    {accountTypeLabel(b.type)}
                                                </div>
                                            </td>
                                            <td className="px-5 py-3 text-slate-300 tnum">
                                                {fmtMoney(Number(b.balance), b.currency)}
                                            </td>
                                            <td className="px-5 py-3 text-right font-bold text-slate-200 tnum">
                                                {b.rate_missing ? (
                                                    <span
                                                        className="text-xs font-semibold text-amber-400"
                                                        title="No FX rate for this currency yet — excluded from totals. Try 'Update now'."
                                                    >
                                                        ⚠ no rate
                                                    </span>
                                                ) : (
                                                    fmtMoney(
                                                        Number(b.base_amount ?? 0),
                                                        latest.base_currency,
                                                    )
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                </>
            )}
        </>
    );
}

