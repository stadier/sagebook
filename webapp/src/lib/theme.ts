/* The runtime half of the design system. index.css owns the CSS custom
   properties; this file owns the TypeScript that has to name them — chart
   series, tinted surfaces, and the hash that keeps an account the same colour
   everywhere it appears.

   Everything resolves to a `var(--…)`, never a literal hex, so light/dark and
   any future retheme stay a stylesheet concern. */

import type { CSSProperties } from "react";

/* --- Categorical series ----------------------------------------------------
   The order the design assigns colours to an unlabelled series (spending
   breakdowns, budget meters, donut slices). Indigo leads because it is also
   the single-series colour for the net-worth line. */

export const CHART_SERIES = [
    "var(--color-chart-indigo)",
    "var(--color-chart-coral)",
    "var(--color-chart-amber)",
    "var(--color-chart-blue)",
    "var(--color-chart-violet)",
    "var(--color-chart-green)",
] as const;

/** Series colour by position, wrapping past the end of the palette. */
export function seriesColor(index: number): string {
    return CHART_SERIES[index % CHART_SERIES.length];
}

/** Semantic colours — reserved meanings that must not be reused as a series. */
export const CHART_COLORS = {
    /** Income, gains, anything moving the right way. */
    positive: "var(--color-chart-green)",
    /** Expense, over-budget, debt. */
    negative: "var(--color-chart-coral)",
    /** The primary single-series line. */
    primary: "var(--color-chart-indigo)",
    /** Empty remainder of a meter or stacked bar. */
    track: "var(--color-track)",
} as const;

/* --- Tinted surfaces -------------------------------------------------------
   A pale fill plus a readable foreground: category pills, account avatars,
   status badges. */

export type Tint = "coral" | "indigo" | "green" | "blue" | "amber" | "violet" | "neutral";

export const TINT_STYLES: Record<Tint, CSSProperties> = {
    coral: { backgroundColor: "var(--color-tint-coral)", color: "var(--color-chart-coral)" },
    indigo: { backgroundColor: "var(--color-tint-indigo)", color: "var(--color-chart-indigo)" },
    green: { backgroundColor: "var(--color-tint-green)", color: "var(--color-chart-green)" },
    blue: { backgroundColor: "var(--color-tint-blue)", color: "var(--color-chart-blue)" },
    amber: { backgroundColor: "var(--color-tint-amber)", color: "var(--color-amber-400)" },
    violet: { backgroundColor: "var(--color-tint-violet)", color: "var(--color-chart-violet)" },
    neutral: { backgroundColor: "var(--color-chip)", color: "var(--color-slate-400)" },
};

/** Tints eligible for automatic assignment — neutral is opt-in only. */
const TINT_CYCLE: Tint[] = ["indigo", "green", "blue", "amber", "violet", "coral"];

/**
 * The swatches offered when a user picks a colour for a category. Literal hex
 * rather than `var(--…)`, unlike everything else here: these are written to the
 * database and read back by exports, the backend and any future client, none of
 * which can resolve one of this app's custom properties.
 */
export const CATEGORY_COLORS = [
    "#6c63ff",
    "#ff6a55",
    "#5ea8ff",
    "#8b6cff",
    "#ffb443",
    "#2fa86a",
] as const;

/**
 * Pale fill plus readable ink for a colour the database supplied — the recipe
 * behind category pills and the board's icon tiles. Falls back to the hashed
 * tint when the row never got a colour, so an uncoloured category still reads
 * as itself rather than as grey.
 */
export function tintStyle(color: string | null | undefined, seed = ""): CSSProperties {
    if (!color) return TINT_STYLES[tintFor(seed)];
    // 12% alpha. The hex suffix only works on a 6-digit value, so anything
    // else goes the long way round.
    const fill = /^#[0-9a-f]{6}$/i.test(color)
        ? `${color}1f`
        : `color-mix(in oklab, ${color} 12%, transparent)`;
    return { backgroundColor: fill, color };
}

/**
 * Stable tint for a name. Deterministic so an account or payee keeps its colour
 * across pages and reloads, without persisting a choice anywhere.
 */
export function tintFor(seed: string): Tint {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    return TINT_CYCLE[hash % TINT_CYCLE.length];
}

/**
 * Colour for a row that may carry its own from the database (categories have a
 * user-chosen `color`), falling back to its position in the series.
 */
export function colorFor(stored: string | null | undefined, index: number): string {
    return stored || seriesColor(index);
}
