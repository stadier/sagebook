import { useRef, useState } from "react";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "../lib/format";

// Mark color validated against the dark surface (dataviz six checks).
const MARK = "#059669";

export interface Point {
    date: string;
    value: number;
}

/** Hand-rolled area/line chart of net worth over time. Shared by the Net worth
 * page and the Overview dashboard. */
export default function NetWorthChart({ points, currency }: { points: Point[]; currency: string }) {
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
