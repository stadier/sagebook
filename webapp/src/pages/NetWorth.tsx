import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "../lib/format";
import { logEvent } from "../lib/logger";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type { NetWorthSnapshot } from "../lib/types";

// Mark color validated against the dark surface (dataviz six checks).
const MARK = "#059669";

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
            <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Net worth</h1>
                    <p className="text-sm text-slate-400">
                        Account balances converted to your base currency, snapshotted daily.
                    </p>
                </div>
                <button
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
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

interface Point {
    date: string;
    value: number;
}

function NetWorthChart({ points, currency }: { points: Point[]; currency: string }) {
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const W = 640;
    const H = 220;
    const PAD = { l: 8, r: 8, t: 8, b: 22 };
    const AXIS_W = 52;

    const xs = points.map((p) => new Date(p.date).getTime());
    const ys = points.map((p) => p.value);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMinRaw = Math.min(...ys);
    const yMaxRaw = Math.max(...ys);
    const ySpan = yMaxRaw - yMinRaw || Math.abs(yMaxRaw) || 1;
    const yMin = yMinRaw - ySpan * 0.1;
    const yMax = yMaxRaw + ySpan * 0.1;

    const plotL = PAD.l + AXIS_W;
    const plotR = W - PAD.r;
    const plotT = PAD.t;
    const plotB = H - PAD.b;

    const x = (t: number) =>
        xMax === xMin ? (plotL + plotR) / 2 : plotL + ((t - xMin) / (xMax - xMin)) * (plotR - plotL);
    const y = (v: number) => plotB - ((v - yMin) / (yMax - yMin)) * (plotB - plotT);

    const linePath = points
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(xs[i]).toFixed(1)},${y(p.value).toFixed(1)}`)
        .join(" ");
    const areaPath = `${linePath} L${x(xs[xs.length - 1]).toFixed(1)},${plotB} L${x(xs[0]).toFixed(1)},${plotB} Z`;

    const gridValues = [0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));

    function onMove(e: React.MouseEvent<SVGSVGElement>) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const px = ((e.clientX - rect.left) / rect.width) * W;
        let best = 0;
        let bestDist = Infinity;
        xs.forEach((t, i) => {
            const d = Math.abs(x(t) - px);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        });
        setHoverIdx(best);
    }

    const hover = hoverIdx !== null ? points[hoverIdx] : null;
    const hoverX = hoverIdx !== null ? x(xs[hoverIdx]) : 0;
    const hoverY = hover ? y(hover.value) : 0;

    return (
        <div className="relative">
            <svg
                ref={svgRef}
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                role="img"
                aria-label={`Net worth over time in ${currency}`}
                onMouseMove={onMove}
                onMouseLeave={() => setHoverIdx(null)}
            >
                {gridValues.map((v) => (
                    <g key={v}>
                        <line
                            x1={plotL}
                            x2={plotR}
                            y1={y(v)}
                            y2={y(v)}
                            stroke="#1e293b"
                            strokeWidth={1}
                        />
                        <text
                            x={plotL - 6}
                            y={y(v) + 3}
                            textAnchor="end"
                            fontSize={10}
                            fill="#64748b"
                        >
                            {fmtMoneyCompact(v, currency)}
                        </text>
                    </g>
                ))}

                <path d={areaPath} fill={MARK} opacity={0.12} />
                <path d={linePath} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" />

                {hover && (
                    <g>
                        <line
                            x1={hoverX}
                            x2={hoverX}
                            y1={plotT}
                            y2={plotB}
                            stroke="#475569"
                            strokeWidth={1}
                            strokeDasharray="3 3"
                        />
                        {/* 2px surface ring so the marker separates from the line */}
                        <circle cx={hoverX} cy={hoverY} r={6} fill="#0f172a" />
                        <circle cx={hoverX} cy={hoverY} r={4} fill={MARK} />
                    </g>
                )}

                <text x={plotL} y={H - 6} fontSize={10} fill="#64748b">
                    {fmtDate(points[0].date)}
                </text>
                <text x={plotR} y={H - 6} fontSize={10} fill="#64748b" textAnchor="end">
                    {fmtDate(points[points.length - 1].date)}
                </text>
            </svg>

            {hover && (
                <div
                    className="pointer-events-none absolute -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs shadow-lg"
                    style={{
                        left: `${(hoverX / W) * 100}%`,
                        top: 0,
                    }}
                >
                    <div className="text-slate-400">{fmtDate(hover.date)}</div>
                    <div className="font-medium text-slate-100">
                        {fmtMoney(hover.value, currency)}
                    </div>
                </div>
            )}
        </div>
    );
}
