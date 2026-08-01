/* The option model every "pick one of these" in Sagebook speaks.

   Pages used to build `<option>` / `<optgroup>` markup inline, which meant the
   same category-flattening loop was written seven times and no list could ever
   be searched. Now a page produces an `Option[]` — from one of the adapters
   below — and hands it to `<Picker>`; the command palette owns presentation,
   filtering and keyboard behaviour for all of them.

   Nothing here renders. Nothing here knows about React. */

import type { GroupWithCategories } from "./taxonomy";
import type { Account } from "./types";

export interface Option<T extends string = string> {
    value: T;
    /** The row's primary text, and what the trigger shows once chosen. */
    label: string;
    /** Quiet right-aligned detail — a currency, a count, an account number. */
    hint?: string;
    /** Section heading. Consecutive options sharing one are drawn together. */
    group?: string;
    /** Matched by search but never displayed — parent names, synonyms, codes. */
    keywords?: string;
    /** Swatch dot, for the colours the database already carries. */
    color?: string | null;
    /** Indent level; 1 is a child category sitting under its parent. */
    depth?: number;
    disabled?: boolean;
}

/* --- Search ---------------------------------------------------------------
   Ranked substring matching, not fuzzy-everything: with a few hundred
   categories a subsequence match on scattered letters produces noise, so a
   subsequence only scores once nothing better matched. Ties keep the caller's
   order, which is how a taxonomy stays in its curated sequence. */

const EXACT = 100;
const PREFIX = 80;
const WORD = 60;
const INFIX = 45;
const META = 25;
const LOOSE = 10;

/** Position-aware score for `needle` inside `hay`, or 0 for no match. */
function scoreText(hay: string, needle: string): number {
    if (!hay) return 0;
    if (hay === needle) return EXACT;
    const at = hay.indexOf(needle);
    if (at === 0) return PREFIX;
    if (at > 0) {
        // A match starting a word reads as intentional; mid-word is weaker.
        const before = hay[at - 1];
        return before === " " || before === "-" || before === "/" ? WORD : INFIX;
    }
    return 0;
}

/** Do `needle`'s characters appear in order in `hay`? The last-resort match. */
function isSubsequence(hay: string, needle: string): boolean {
    let i = 0;
    for (const ch of hay) {
        if (ch === needle[i] && ++i === needle.length) return true;
    }
    return false;
}

/** How well one search term matches one option, across all its text. */
function scoreTerm(label: string, meta: string, term: string): number {
    const direct = scoreText(label, term);
    if (direct) return direct;
    if (meta.includes(term)) return META;
    return isSubsequence(label, term) ? LOOSE : 0;
}

/**
 * `options` narrowed to `query`, best first. An empty query is the identity,
 * so the palette's resting state is the curated order the adapter produced.
 *
 * Terms are matched independently and all must hit, which is what makes
 * "transport fuel" find Fuel under Transport — the words live in different
 * fields and in the wrong order for any single-substring test.
 */
export function filterOptions<T extends string>(options: Option<T>[], query: string): Option<T>[] {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return options;

    const scored: Array<{ option: Option<T>; score: number; index: number }> = [];
    options.forEach((option, index) => {
        const label = option.label.toLowerCase();
        const meta = `${option.group ?? ""} ${option.hint ?? ""} ${option.keywords ?? ""}`
            .toLowerCase()
            .trim();

        let total = 0;
        for (const term of terms) {
            const score = scoreTerm(label, meta, term);
            if (!score) return; // one miss disqualifies the option
            total += score;
        }
        scored.push({ option, score: total, index });
    });
    // `index` breaks ties so equally-good matches stay in their original order.
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map((s) => s.option);
}

/** The chosen option, for rendering a trigger's current state. */
export function findOption<T extends string>(
    options: Option<T>[],
    value: T | "" | null | undefined,
): Option<T> | undefined {
    if (value === "" || value === null || value === undefined) return undefined;
    return options.find((o) => o.value === value);
}

/* --- Adapters -------------------------------------------------------------
   One per shape the app actually loads. A screen that needs a list calls one
   of these inside `useMemo` rather than mapping rows to markup by hand. */

/**
 * Every category, grouped by its group and with children indented under their
 * parent — the taxonomy's own order, preserved. The group name and the parent
 * name ride along as keywords, so "housing rent" finds Rent under Housing even
 * though neither word pair appears in one label.
 */
export function categoryOptions(taxonomy: GroupWithCategories[] | undefined): Option[] {
    const out: Option[] = [];
    for (const group of taxonomy ?? []) {
        const nameById = new Map(group.categories.map((c) => [c.id, c.name]));
        for (const category of group.categories) {
            const parent = category.parent_id ? nameById.get(category.parent_id) : undefined;
            out.push({
                value: category.id,
                label: category.name,
                group: group.name,
                color: category.color,
                depth: category.parent_id ? 1 : 0,
                keywords: [group.name, parent].filter(Boolean).join(" "),
            });
        }
    }
    return out;
}

/**
 * Live accounts, with the institution as searchable context and the currency
 * as the hint. Archived accounts are dropped unless asked for, matching what
 * every call site was already filtering by hand.
 */
export function accountOptions(
    accounts: Account[] | undefined,
    { includeArchived = false, showCurrency = false } = {},
): Option[] {
    return (accounts ?? [])
        .filter((a) => includeArchived || !a.is_archived)
        .map((a) => ({
            value: a.id,
            label: a.name,
            hint: showCurrency ? a.currency : undefined,
            group: a.is_archived ? "Archived" : undefined,
            keywords: [a.institution, a.currency, a.metadata?.number_masked]
                .filter(Boolean)
                .join(" "),
        }));
}

/** A plain enum: `["income", "expense"]`, optionally relabelled for display. */
export function enumOptions<T extends string>(
    values: readonly T[],
    label: (value: T) => string = (v) => v,
): Option<T>[] {
    return values.map((value) => ({ value, label: label(value) }));
}

/** `{ value, label }` pairs the constants module already exports, as options. */
export function pairOptions<T extends string>(
    pairs: ReadonlyArray<{ value: T; label: string }>,
): Option<T>[] {
    return pairs.map(({ value, label }) => ({ value, label }));
}
