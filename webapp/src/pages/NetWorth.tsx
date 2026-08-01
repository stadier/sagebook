import { useMutation, useQueryClient } from "@tanstack/react-query";
import DataTable, { type Column } from "../components/DataTable";
import NetWorthChart from "../components/NetWorthChart";
import {
    Card,
    CardHeader,
    Empty,
    PageHeader,
    QueryError,
    SectionLabel,
    StatCard,
} from "../components/ui";
import { accountTypeLabel } from "../lib/constants";
import { fmtDate, fmtMoney } from "../lib/format";
import { logEvent } from "../lib/logger";
import { QK, useNetWorthSnapshots } from "../lib/queries";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type { NetWorthBreakdownEntry } from "../lib/types";

/** The snapshot's per-account rows, converted into the base currency. */
function breakdownColumns(base: string): Array<Column<NetWorthBreakdownEntry>> {
    return [
        {
            id: "name",
            label: "Account",
            hideable: false,
            mobile: "title",
            sortValue: (b) => b.name,
            searchValue: (b) => `${b.name} ${accountTypeLabel(b.type)}`,
            cell: (b) => (
                <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-200">{b.name}</div>
                    <div className="text-xs text-slate-500">{accountTypeLabel(b.type)}</div>
                </div>
            ),
        },
        {
            id: "balance",
            label: "Balance",
            align: "right",
            width: "12rem",
            sortValue: (b) => Number(b.balance),
            cell: (b) => (
                <span className="whitespace-nowrap text-slate-300 tnum">
                    {fmtMoney(Number(b.balance), b.currency)}
                </span>
            ),
        },
        {
            id: "base",
            label: `In ${base}`,
            align: "right",
            width: "12rem",
            hideable: false,
            mobile: "trailing",
            sortValue: (b) => (b.rate_missing ? null : Number(b.base_amount ?? 0)),
            cell: (b) =>
                b.rate_missing ? (
                    <span
                        className="whitespace-nowrap text-xs font-semibold text-amber-400"
                        title="No FX rate for this currency yet — excluded from totals. Try 'Update now'."
                    >
                        ⚠ no rate
                    </span>
                ) : (
                    <span className="whitespace-nowrap font-bold text-slate-200 tnum">
                        {fmtMoney(Number(b.base_amount ?? 0), base)}
                    </span>
                ),
        },
    ];
}

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

                    <div>
                        <SectionLabel>Breakdown · {fmtDate(latest.as_of)}</SectionLabel>
                        <DataTable
                            storageKey="net-worth-breakdown"
                            data={latest.breakdown ?? []}
                            columns={breakdownColumns(latest.base_currency)}
                            rowId={(b) => b.account_id}
                            rowNoun="account"
                            searchPlaceholder="Search accounts…"
                            exportFilename={`sagebook-net-worth-${latest.as_of}`}
                            initialSort={{ columnId: "base", direction: "desc" }}
                            emptyTitle="No accounts in this snapshot"
                        />
                    </div>
                </>
            )}
        </>
    );
}

