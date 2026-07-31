/* The design system's React surface: the page header, the card family, pills,
   meters, form controls and the empty state. Pages compose these instead of
   re-deriving the same padding/radius/shadow combinations by hand.

   Colour decisions live in lib/theme.ts and index.css — nothing here should
   contain a hex value. */

import type {
    InputHTMLAttributes,
    ReactNode,
    SelectHTMLAttributes,
    TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router-dom";
import { CHART_COLORS, TINT_STYLES, type Tint } from "../lib/theme";

export { tintFor } from "../lib/theme";
export type { Tint } from "../lib/theme";

/* --- Page header ---------------------------------------------------------
   25px/800 title, a muted one-line subtitle, and an optional action cluster
   that wraps below the title on mobile. Every page opens with this. */

export function PageHeader({
    title,
    subtitle,
    children,
}: {
    title: ReactNode;
    subtitle?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-start gap-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
                <h1 className="text-[1.5625rem] font-extrabold tracking-tight text-slate-100">
                    {title}
                </h1>
                {subtitle && <p className="mt-0.5 text-[0.84375rem] text-slate-400">{subtitle}</p>}
            </div>
            {children && (
                <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">{children}</div>
            )}
        </div>
    );
}

/* --- Cards ----------------------------------------------------------------
   `Card` is the standard 18px surface; `Card feature` is the 22px hero with
   the wide floating shadow. Padding is a prop so dense tables can drop it. */

export function Card({
    feature = false,
    padded = true,
    className = "",
    children,
}: {
    feature?: boolean;
    padded?: boolean;
    className?: string;
    children: ReactNode;
}) {
    return (
        <div
            className={`${feature ? "sb-card-lg" : "sb-card"} ${
                padded ? (feature ? "p-6 sm:px-[1.625rem]" : "p-5") : ""
            } ${className}`}
        >
            {children}
        </div>
    );
}

/** The dark spotlight panel — Sage's voice, and the one "inverted" stat. */
export function DarkPanel({ className = "", children }: { className?: string; children: ReactNode }) {
    return <div className={`sb-panel p-5 sm:p-6 ${className}`}>{children}</div>;
}

/** Dashed placeholder card — "add one", "nothing scheduled yet". */
export function DashedCard({ className = "", children }: { className?: string; children: ReactNode }) {
    return <div className={`sb-dashed p-5 sm:p-6 ${className}`}>{children}</div>;
}

/* --- Card header ----------------------------------------------------------
   13px/700 label on the left, an indigo text link on the right. */

export function CardHeader({
    title,
    to,
    cta,
    aside,
    className = "",
}: {
    title: ReactNode;
    to?: string;
    cta?: string;
    aside?: ReactNode;
    className?: string;
}) {
    return (
        <div className={`mb-4 flex flex-wrap items-center justify-between gap-2 ${className}`}>
            <h2 className="text-[0.8125rem] font-bold text-slate-200">{title}</h2>
            {aside}
            {to && cta && (
                <Link to={to} className="text-[0.78125rem] font-semibold text-sky-300 hover:text-sky-200">
                    {cta}
                </Link>
            )}
        </div>
    );
}

/* --- Stat tile ------------------------------------------------------------
   Label over a big tabular figure. `tone="dark"` renders the inverted variant
   the design uses for the single most important number in a row. */

export function StatCard({
    label,
    value,
    tone = "default",
    hint,
}: {
    label: ReactNode;
    value: ReactNode;
    tone?: "default" | "dark" | "positive" | "negative";
    hint?: ReactNode;
}) {
    if (tone === "dark") {
        return (
            <div className="sb-panel px-5 py-[1.125rem]">
                <div className="text-xs text-slate-400">{label}</div>
                <div className="mt-1.5 text-2xl font-extrabold tnum">{value}</div>
                {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
            </div>
        );
    }
    const valueTone =
        tone === "positive"
            ? "text-emerald-400"
            : tone === "negative"
              ? "text-rose-400"
              : "text-slate-100";
    return (
        <div className="sb-card px-5 py-[1.125rem]">
            <div className="text-xs text-slate-400">{label}</div>
            <div className={`mt-1.5 text-2xl font-extrabold tnum ${valueTone}`}>{value}</div>
            {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
        </div>
    );
}

/* --- Pills ----------------------------------------------------------------
   `Pill` is a tinted badge; `FilterPill` is the selectable outline chip from
   the ledger's filter row (selected = solid ink). */

export function Pill({ tint = "neutral", children }: { tint?: Tint; children: ReactNode }) {
    return (
        <span className="sb-pill" style={TINT_STYLES[tint]}>
            {children}
        </span>
    );
}

/**
 * Badge tinted by a colour the database supplied (a category's own colour),
 * falling back to the neutral chip. Kept here so the 12%-alpha fill recipe
 * lives in one place.
 */
export function ColorPill({ color, children }: { color?: string | null; children: ReactNode }) {
    if (!color) return <Pill>{children}</Pill>;
    return (
        <span className="sb-pill" style={{ backgroundColor: `${color}1f`, color }}>
            {children}
        </span>
    );
}

export function FilterPill({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={`rounded-full px-3.5 py-[0.4375rem] text-[0.78125rem] transition-colors ${
                active
                    ? "bg-slate-200 font-bold text-slate-900"
                    : "border border-slate-700 font-semibold text-slate-300 hover:border-slate-600"
            }`}
        >
            {children}
        </button>
    );
}

/** Square avatar with the initials of an account / payee, on a soft tint. */
export function Avatar({
    label,
    tint = "indigo",
    size = 34,
}: {
    label: string;
    tint?: Tint;
    size?: number;
}) {
    return (
        <span
            className="grid shrink-0 place-items-center rounded-xl text-xs font-extrabold uppercase"
            style={{ ...TINT_STYLES[tint], width: size, height: size }}
        >
            {label.slice(0, 2)}
        </span>
    );
}

/* --- Meters ---------------------------------------------------------------- */

export function Meter({
    pct,
    color = CHART_COLORS.primary,
    height = 8,
}: {
    pct: number;
    color?: string;
    height?: number;
}) {
    return (
        <div className="sb-track" style={{ height }}>
            <div
                style={{
                    width: `${Math.max(0, Math.min(100, pct))}%`,
                    height,
                    background: color,
                    borderRadius: 9999,
                }}
            />
        </div>
    );
}

/** Labelled progress row: name + value above a meter. */
export function MeterRow({
    label,
    value,
    pct,
    color,
}: {
    label: ReactNode;
    value: ReactNode;
    pct: number;
    color?: string;
}) {
    return (
        <div>
            <div className="mb-[0.4375rem] flex justify-between gap-3 text-[0.84375rem]">
                <span className="min-w-0 truncate font-semibold text-slate-200">{label}</span>
                <span className="shrink-0 text-slate-400 tnum">{value}</span>
            </div>
            <Meter pct={pct} color={color} />
        </div>
    );
}

/* --- Segmented control ----------------------------------------------------
   The 6M / 1Y / All switch: a chip-coloured trough with a raised active pill. */

export function Segmented<T extends string>({
    options,
    value,
    onChange,
}: {
    options: Array<{ value: T; label: string }>;
    value: T;
    onChange: (v: T) => void;
}) {
    return (
        <div className="flex shrink-0 gap-1 rounded-[0.625rem] bg-chip p-[3px]">
            {options.map((o) => (
                <button
                    key={o.value}
                    onClick={() => onChange(o.value)}
                    className={`rounded-lg px-2.5 py-[5px] text-xs transition-colors ${
                        o.value === value
                            ? "bg-slate-900 font-bold text-slate-200 shadow-card"
                            : "font-semibold text-slate-400 hover:text-slate-300"
                    }`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/* --- Form controls ---------------------------------------------------------
   Thin wrappers over the native elements so `.sb-input` is applied once and
   every form inherits the same focus ring. `compact` is the inline size used
   in filter rows and table cells. */

type ControlSize = { compact?: boolean; className?: string };

function controlClass({ compact, className = "" }: ControlSize): string {
    return `sb-input ${compact ? "w-auto !py-1.5 text-[0.8125rem]" : ""} ${className}`;
}

export function Input({
    compact,
    className,
    ...props
}: InputHTMLAttributes<HTMLInputElement> & ControlSize) {
    return <input {...props} className={controlClass({ compact, className })} />;
}

export function Select({
    compact,
    className,
    children,
    ...props
}: SelectHTMLAttributes<HTMLSelectElement> & ControlSize) {
    return (
        <select {...props} className={controlClass({ compact, className })}>
            {children}
        </select>
    );
}

export function Textarea({
    compact,
    className,
    ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & ControlSize) {
    return <textarea {...props} className={controlClass({ compact, className })} />;
}

/** Label above a control, with optional helper text beneath. */
export function Field({
    label,
    hint,
    children,
}: {
    label: ReactNode;
    hint?: ReactNode;
    children: ReactNode;
}) {
    return (
        <label className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-400">{label}</span>
            {children}
            {hint && <span className="text-xs text-slate-500">{hint}</span>}
        </label>
    );
}

/* --- Legend ---------------------------------------------------------------- */

export function LegendDot({ color }: { color: string }) {
    return (
        <span
            className="inline-block shrink-0 rounded-[3px]"
            style={{ width: 9, height: 9, background: color }}
        />
    );
}

/* --- Empty / loading / error states ---------------------------------------- */

export function Empty({ loading, children }: { loading?: boolean; children: ReactNode }) {
    return <p className="text-sm text-slate-500">{loading ? "Loading…" : children}</p>;
}

/** Renders a query's failure message, or nothing when there isn't one. */
export function QueryError({ error }: { error: unknown }) {
    if (!error) return null;
    return <p className="text-sm text-rose-400">{(error as Error).message}</p>;
}

/* --- Section eyebrow ------------------------------------------------------- */

export function SectionLabel({ children }: { children: ReactNode }) {
    return <div className="sb-eyebrow mb-2.5">{children}</div>;
}
