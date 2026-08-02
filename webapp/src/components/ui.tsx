/* The design system's React surface: the page header, the card family, pills,
   meters, form controls and the empty state. Pages compose these instead of
   re-deriving the same padding/radius/shadow combinations by hand.

   Colour decisions live in lib/theme.ts and index.css — nothing here should
   contain a hex value. */

import { isValidElement, useEffect, useState } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { findOption, type Option } from "../lib/options";
import { CHART_COLORS, TINT_STYLES, type Tint, tintStyle } from "../lib/theme";
import { usePalette } from "./CommandPalette";
import { ChevronDownIcon, CloseIcon } from "./icons";

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

/** The plain text inside a node — for type scaling and the title attribute. */
function plainText(node: ReactNode): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(plainText).join("");
    if (isValidElement(node)) {
        return plainText((node.props as { children?: ReactNode }).children);
    }
    return "";
}

/**
 * A figure must never be clipped by its tile, and a currency amount is one
 * unbreakable run — `Intl.NumberFormat` joins the code to the digits with a
 * non-breaking space, so "NGN 63,687,101.54" offers nowhere to wrap. Step the
 * type down as the figure grows; `overflow-wrap: anywhere` on the element then
 * catches whatever is still too wide, so the worst case is a second line
 * rather than a number cut in half.
 */
function valueSize(text: string): string {
    if (text.length > 20) return "text-lg";
    if (text.length > 14) return "text-xl";
    return "text-2xl";
}

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
    const text = plainText(value);
    const valueClass = `mt-1.5 ${valueSize(text)} font-extrabold tnum [overflow-wrap:anywhere]`;

    if (tone === "dark") {
        return (
            <div className="sb-panel px-5 py-[1.125rem]">
                <div className="text-xs text-slate-400">{label}</div>
                <div className={valueClass} title={text || undefined}>
                    {value}
                </div>
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
            <div className={`${valueClass} ${valueTone}`} title={text || undefined}>
                {value}
            </div>
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
 * falling back to the neutral chip when the row has none.
 */
export function ColorPill({ color, children }: { color?: string | null; children: ReactNode }) {
    if (!color) return <Pill>{children}</Pill>;
    return (
        <span className="sb-pill" style={tintStyle(color)}>
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

/**
 * The one way to choose from a list. Renders as a control that matches `Input`
 * exactly, and opens the command palette — searchable, keyboard-driven, never
 * clipped by its container — instead of a native dropdown. It replaced the old
 * `Select` wrapper: a list of four and a list of four hundred are now the same
 * component, and the palette decides how much apparatus each one needs.
 *
 * `placeholder` doubles as the trigger's empty text and the palette's title.
 * With `clearable`, it also becomes a real first row that selects `""` — that
 * is the "All accounts" / "— no category —" case. Leave it off when the field
 * is required and the placeholder is only a prompt.
 */
export function Picker<T extends string>({
    options,
    value,
    onChange,
    placeholder = "Select…",
    clearable = false,
    title,
    subtitle,
    searchPlaceholder,
    emptyText,
    disabled,
    compact,
    className,
    id,
    "aria-label": ariaLabel,
}: ControlSize & {
    options: Option<T>[];
    value: T | "" | null | undefined;
    onChange: (value: T) => void;
    placeholder?: string;
    clearable?: boolean;
    title?: string;
    subtitle?: ReactNode;
    searchPlaceholder?: string;
    emptyText?: string;
    disabled?: boolean;
    id?: string;
    "aria-label"?: string;
}) {
    const palette = usePalette();
    const selected = findOption(options, value);
    // What this control is *for*. `placeholder` says it when it stands alone
    // ("All accounts"); `title` is there for the fields whose placeholder is
    // only a prompt, where "Select…: expense" would tell a screen reader
    // nothing about which field it just read.
    const name = title ?? placeholder;

    // The clear row is a genuine option, so it filters, highlights and ticks
    // like any other rather than being a special case in the palette.
    const rows = clearable
        ? [{ value: "" as T, label: placeholder }, ...options]
        : options;

    return (
        <button
            type="button"
            id={id}
            disabled={disabled}
            aria-label={ariaLabel ?? (selected ? `${name}: ${selected.label}` : name)}
            aria-haspopup="listbox"
            onClick={() =>
                palette.open<T>({
                    title: name,
                    subtitle: typeof subtitle === "string" ? subtitle : undefined,
                    options: rows,
                    value,
                    onSelect: onChange,
                    searchPlaceholder,
                    emptyText,
                })
            }
            className={`sb-picker ${selected ? "" : "is-empty"} ${controlClass({ compact, className })}`}
        >
            {selected?.color && (
                <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: selected.color }}
                />
            )}
            <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
            {selected?.hint && (
                <span className="shrink-0 text-xs text-slate-500">{selected.hint}</span>
            )}
            <span className="shrink-0 text-slate-600">
                <ChevronDownIcon size={15} />
            </span>
        </button>
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

/* --- Donut ----------------------------------------------------------------
   Composition as arcs on one ring, drawn with `stroke-dasharray` exactly as the
   design does. The centre label is HTML rather than `<text>` so it inherits the
   theme's text colour and the tabular figures. */

export function Donut({
    slices,
    total,
    size = 120,
    label,
    caption,
}: {
    slices: Array<{ value: number; color: string }>;
    total: number;
    size?: number;
    label?: ReactNode;
    caption?: ReactNode;
}) {
    const radius = 46;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;

    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
                <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={CHART_COLORS.track}
                    strokeWidth="20"
                />
                {slices.map((s, i) => {
                    const len = total > 0 ? (s.value / total) * circumference : 0;
                    const arc = (
                        <circle
                            key={i}
                            cx="60"
                            cy="60"
                            r={radius}
                            fill="none"
                            stroke={s.color}
                            strokeWidth="20"
                            strokeDasharray={`${len} ${circumference - len}`}
                            strokeDashoffset={-offset}
                            transform="rotate(-90 60 60)"
                        />
                    );
                    offset += len;
                    return arc;
                })}
            </svg>
            {label && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-3 text-center">
                    <span className="max-w-full truncate text-[0.8125rem] font-extrabold text-slate-100 tnum">
                        {label}
                    </span>
                    {caption && (
                        <span className="max-w-full truncate text-[0.6875rem] font-semibold text-slate-500">
                            {caption}
                        </span>
                    )}
                </div>
            )}
        </div>
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

/* --- Modal -----------------------------------------------------------------
   A centred dialog for a form that would otherwise sit permanently on the page.
   Portalled to `document.body` so no card's `overflow: hidden` can clip it. */

export function Modal({
    open,
    onClose,
    title,
    subtitle,
    children,
    width = "32rem",
}: {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    subtitle?: ReactNode;
    children: ReactNode;
    width?: string;
}) {
    // Flipped a frame after mount so the panel animates in rather than popping.
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (!open) {
            setVisible(false);
            return;
        }
        const frame = requestAnimationFrame(() => setVisible(true));
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        // The page behind must not scroll while the dialog is up.
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("keydown", onKey);
            document.body.style.overflow = previousOverflow;
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6"
            role="dialog"
            aria-modal="true"
        >
            <button
                aria-hidden
                tabIndex={-1}
                onClick={onClose}
                className={`absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px] transition-opacity duration-150 ${
                    visible ? "opacity-100" : "opacity-0"
                }`}
            />
            <div
                style={{ maxWidth: width }}
                className={`sb-card-lg relative flex max-h-[92vh] w-full flex-col transition-all duration-150 ease-out ${
                    visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"
                }`}
            >
                <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-5">
                    <div className="min-w-0">
                        <h2 className="text-[0.9375rem] font-bold text-slate-100">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
                    </div>
                    <button
                        aria-label="Close"
                        onClick={onClose}
                        className="-mr-1 shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    >
                        <CloseIcon />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            </div>
        </div>,
        document.body,
    );
}

/* --- Section eyebrow ------------------------------------------------------- */

export function SectionLabel({ children }: { children: ReactNode }) {
    return <div className="sb-eyebrow mb-2.5">{children}</div>;
}
