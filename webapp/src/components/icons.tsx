/* The app's icon set. One line language throughout, per the design: a 24px box,
   1.9 stroke, round caps and joins, drawn from as few strokes as possible.

   `Stroke` carries those defaults so an icon is just its path data, and every
   icon takes the same `size` prop. Route icons live in nav.tsx alongside the
   navigation model they belong to; everything else is here. */

import type { ReactNode } from "react";

export interface IconProps {
    size?: number;
    /** Extra classes for the svg itself — usually a colour or `shrink-0`. */
    className?: string;
}

/** Shared svg wrapper. Colour comes from `currentColor`, so set it on a parent. */
export function Stroke({
    children,
    size = 18,
    width = 1.9,
    className = "",
}: IconProps & { children: ReactNode; width?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={width}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
            className={`shrink-0 ${className}`}
        >
            {children}
        </svg>
    );
}

/* --- Actions ---------------------------------------------------------------- */

export function PlusIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={2.2} className={className}>
            <path d="M12 5v14M5 12h14" />
        </Stroke>
    );
}

export function SearchIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4.3-4.3" />
        </Stroke>
    );
}

export function CloseIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M6 6l12 12M18 6 6 18" />
        </Stroke>
    );
}

export function MenuIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M4 7h16M4 12h16M4 17h16" />
        </Stroke>
    );
}

export function ChevronRightIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="m9 6 6 6-6 6" />
        </Stroke>
    );
}

export function ChevronLeftIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="m15 6-6 6 6 6" />
        </Stroke>
    );
}

export function ChevronDownIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="m6 9 6 6 6-6" />
        </Stroke>
    );
}

export function CheckIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2.4} className={className}>
            <path d="m5 12.5 4.5 4.5L19 7" />
        </Stroke>
    );
}

/** Collapse / expand the sidebar rail — the chevron points where it will go. */
export function PanelToggleIcon({
    collapsed,
    size = 17,
    className,
}: IconProps & { collapsed: boolean }) {
    return (
        <Stroke size={size} width={1.8} className={className}>
            <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
            <path d="M9.5 4.5v15" />
            {collapsed ? <path d="m13.5 9.5 2.5 2.5-2.5 2.5" /> : <path d="m16 9.5-2.5 2.5 2.5 2.5" />}
        </Stroke>
    );
}

export function LogoutIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
            <path d="M10 12h9m0 0-3-3m3 3-3 3" />
            <path d="M10 12H3" />
        </Stroke>
    );
}

/* --- Table toolbar ------------------------------------------------------------
   The controls above every data table: filter, sort, column visibility, export,
   and the sort indicator that lives in a column header. */

export function FilterIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M4 6h16M7 12h10M10 18h4" />
        </Stroke>
    );
}

export function SortIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M7 4v16m0 0-3-3m3 3 3-3" />
            <path d="M17 20V4m0 0-3 3m3-3 3 3" />
        </Stroke>
    );
}

export function ColumnsIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={1.8} className={className}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16M15 4v16" />
        </Stroke>
    );
}

/** Turn the row-selection gutter on or off. */
export function SelectRowsIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={1.8} className={className}>
            <rect x="3" y="3" width="18" height="18" rx="4" />
            <path d="m8 12 2.5 2.5L16 9" />
        </Stroke>
    );
}

export function DownloadIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
            <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
        </Stroke>
    );
}

/** Table display settings — how amount figures are styled (the Settings menu). */
export function SlidersIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={1.8} className={className}>
            <path d="M4 8h8M18 8h2" />
            <path d="M4 16h4M14 16h6" />
            <circle cx="15" cy="8" r="2.4" />
            <circle cx="11" cy="16" r="2.4" />
        </Stroke>
    );
}

/** The caret pair in a sortable header — the active direction is filled in. */
export function SortArrowIcon({
    direction,
    size = 14,
    className,
}: IconProps & { direction: "asc" | "desc" | null }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
            className={`shrink-0 ${className ?? ""}`}
        >
            <path
                d="m8 10 4-4 4 4z"
                fill="currentColor"
                opacity={direction === "asc" ? 1 : direction === null ? 0.35 : 0.15}
            />
            <path
                d="m8 14 4 4 4-4z"
                fill="currentColor"
                opacity={direction === "desc" ? 1 : direction === null ? 0.35 : 0.15}
            />
        </svg>
    );
}

/* --- Row verbs ----------------------------------------------------------------
   Icon-only actions inside a table row. Every one needs a `title` and an
   `aria-label` at the call site — the glyph alone is not the label. */

export function EditIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
            <path d="m14.5 7.5 2 2" />
        </Stroke>
    );
}

export function ArchiveIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <rect x="3" y="4" width="18" height="4" rx="1.4" />
            <path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
            <path d="M10 12h4" />
        </Stroke>
    );
}

export function UnarchiveIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <rect x="3" y="4" width="18" height="4" rx="1.4" />
            <path d="M5 8v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
            <path d="M12 16v-5m0 0-2 2m2-2 2 2" />
        </Stroke>
    );
}

/** Two paths joining into one — merging a record into another. */
export function MergeIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M7 4v4c0 3 2 4 5 4h5" />
            <path d="M7 20v-4c0-3 2-4 5-4" />
            <path d="m14 9 3 3-3 3" />
        </Stroke>
    );
}

export function TrashIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M4 7h16M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" />
            <path d="M6 7v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7" />
            <path d="M10 11v5M14 11v5" />
        </Stroke>
    );
}

export function PauseIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M9.5 5v14M14.5 5v14" />
        </Stroke>
    );
}

export function PlayIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M8 5.5v13l11-6.5z" />
        </Stroke>
    );
}

/** Post something onward — a scheduled item into the inbox. */
export function SendIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M20 4 3 10.5l7 3 3 7z" />
            <path d="m10 13.5 4-4" />
        </Stroke>
    );
}

/** Jump a recurrence past one occurrence without posting it. */
export function SkipIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M5 6.5v11l8-5.5z" />
            <path d="M17 6v12" />
        </Stroke>
    );
}

/* --- Direction --------------------------------------------------------------
   Money in falls into the ledger, money out climbs away from it. The pair is
   only ever used together, so they read as opposites rather than as up/down. */

export function ArrowDownIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M12 5v14M6 13l6 6 6-6" />
        </Stroke>
    );
}

export function ArrowUpIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M12 19V5M6 11l6-6 6 6" />
        </Stroke>
    );
}

/** Re-run something over history — a rule against past transactions. */
export function ReplayIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M4 12a8 8 0 1 0 2.5-5.8" />
            <path d="M4 4v4h4" />
        </Stroke>
    );
}

/** The row-actions handle. Dots rather than a caret — it opens a menu, not a
 *  value list, and it has to read as "more" at 7px wide. */
export function MoreIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <circle cx="12" cy="5" r="1.1" fill="currentColor" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" />
            <circle cx="12" cy="19" r="1.1" fill="currentColor" />
        </Stroke>
    );
}

/** Shown beside anything that cannot be undone. */
export function WarningIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M10.3 4.3 2.8 17a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3l-7.5-12.7a2 2 0 0 0-3.4 0z" />
            <path d="M12 10v4M12 17.2v.1" />
        </Stroke>
    );
}

/* --- Theme ------------------------------------------------------------------- */

export function SunIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </Stroke>
    );
}

export function MoonIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={2} className={className}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </Stroke>
    );
}

/** The current theme's toggle affordance — sun while dark, moon while light. */
export function ThemeIcon({ theme, size, className }: IconProps & { theme: string }) {
    return theme === "dark" ? (
        <SunIcon size={size} className={className} />
    ) : (
        <MoonIcon size={size} className={className} />
    );
}

/* --- Sage --------------------------------------------------------------------- */

export function SparkIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} width={1.6} className={className}>
            <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z" />
            <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
        </Stroke>
    );
}

export function MicIcon({ size = 18, className }: IconProps) {
    return (
        <Stroke size={size} className={className}>
            <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </Stroke>
    );
}

export function GridIcon({ size = 16, className }: IconProps) {
    return (
        <Stroke size={size} width={1.8} className={className}>
            <rect x="4" y="4" width="6" height="6" rx="1.4" />
            <rect x="14" y="4" width="6" height="6" rx="1.4" />
            <rect x="4" y="14" width="6" height="6" rx="1.4" />
            <rect x="14" y="14" width="6" height="6" rx="1.4" />
        </Stroke>
    );
}
