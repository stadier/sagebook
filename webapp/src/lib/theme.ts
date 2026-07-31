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
