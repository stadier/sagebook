/* Budgets — "category caps, refined" (concept 1a).

   One period at a time rather than a list of plans: a period navigator picks
   which budget is on screen, an alert names the one line that is actually in
   trouble, and the caps themselves sit in grouped tables under the roll-up.
   Creating a budget and adding a cap moved into dialogs, so the page opens on
   the numbers instead of on two empty forms. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/Confirm";
import {
    ChevronDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    EditIcon,
    PlusIcon,
    ReplayIcon,
    TrashIcon,
    WarningIcon,
} from "../components/icons";
import {
    Card,
    CardHeader,
    DarkPanel,
    DashedCard,
    Donut,
    Input,
    LegendDot,
    Meter,
    MeterRow,
    Modal,
    PageHeader,
    Picker,
    Pill,
    QueryError,
    Segmented,
} from "../components/ui";
import { BUDGET_KIND_LABELS, BUDGET_PERIODS, DEFAULT_CURRENCY } from "../lib/constants";
import { fmtMoney, fmtMoneyCompact } from "../lib/format";
import { enumOptions, pairOptions } from "../lib/options";
import {
    currentBudget,
    QK,
    useBudgetProgress,
    useBudgets,
    useCategoryById,
    useCategoryOptions,
    useScheduled,
    useTaxonomy,
} from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import { CHART_COLORS, colorFor, seriesColor } from "../lib/theme";
import type { Budget, BudgetLineKind, BudgetPeriod, BudgetProgress } from "../lib/types";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PERIOD_OPTIONS = pairOptions(BUDGET_PERIODS);

const KIND_OPTIONS = enumOptions(
    Object.keys(BUDGET_KIND_LABELS) as BudgetLineKind[],
    (k) => BUDGET_KIND_LABELS[k],
);

/** What a budget line is measured against. */
const MODE_OPTIONS = pairOptions([
    { value: "category", label: "By category" },
    { value: "group", label: "By group (all categories in group)" },
    { value: "custom", label: "Custom label" },
] as const);

/**
 * The two ways to read one set of caps. Caps counts up — what you have used of
 * the limit. Envelope counts down — what is still in the envelope. Identical
 * numbers, opposite question, so it is a view switch rather than a second kind
 * of budget to keep in step.
 */
export type BudgetView = "caps" | "envelope";

const VIEW_OPTIONS: Array<{ value: BudgetView; label: string }> = [
    { value: "caps", label: "Caps" },
    { value: "envelope", label: "Envelope" },
];

/** The cadence switch. Short labels — the full ones don't fit a segment. */
const CADENCE_OPTIONS: Array<{ value: BudgetPeriod; label: string }> = [
    { value: "monthly", label: "Month" },
    { value: "quarterly", label: "Quarter" },
    { value: "yearly", label: "Year" },
    { value: "custom", label: "Custom" },
];

const CADENCE_NOUNS: Record<BudgetPeriod, string> = {
    monthly: "monthly",
    quarterly: "quarterly",
    yearly: "yearly",
    custom: "custom-period",
};

/** Slices before the donut and its legend stop being readable. */
const DONUT_SLICES = 6;
/** Categories in the "top movers" comparison. */
const MOVER_COLUMNS = 4;
/** Chips in the upcoming-bills strip. */
const UPCOMING_BILLS = 4;
/** Group meters under the total bar. */
const GROUP_METERS = 3;
/** A line this far under its cap is worth suggesting a trim on. */
const UNDERSPEND_TRIGGER = 0.75;

/** Labels for the non-expense kinds, which get a section each. */
const KIND_SECTIONS: Array<{ kind: BudgetLineKind; title: string }> = [
    { kind: "income", title: "Income" },
    { kind: "saving", title: "Savings" },
    { kind: "transfer", title: "Transfers" },
];

const KIND_COLORS: Record<BudgetLineKind, string> = {
    income: CHART_COLORS.positive,
    expense: CHART_COLORS.primary,
    saving: "var(--color-chart-blue)",
    transfer: "var(--color-chart-amber)",
};

/* -------------------------------------------------------------------------- */
/*  Dates                                                                      */
/* -------------------------------------------------------------------------- */

function iso(d: Date): string {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

/** Midnight local, so date-only strings never slip a day through the TZ. */
function parseISO(value: string): Date {
    return new Date(`${value}T00:00:00`);
}

function periodDates(kind: BudgetPeriod): { starts: string; ends: string } {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (kind) {
        case "quarterly": {
            const qStart = Math.floor(m / 3) * 3;
            return { starts: iso(new Date(y, qStart, 1)), ends: iso(new Date(y, qStart + 3, 0)) };
        }
        case "yearly":
            return { starts: `${y}-01-01`, ends: `${y}-12-31` };
        default:
            return { starts: iso(new Date(y, m, 1)), ends: iso(new Date(y, m + 1, 0)) };
    }
}

/** The name a period suggests for itself — "July 2026", "2026", or its range. */
function rangeName(start: Date, end: Date, kind: BudgetPeriod): string {
    if (kind === "monthly") {
        return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    if (kind === "yearly") return String(start.getFullYear());
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(
        undefined,
        { month: "short", day: "numeric", year: "numeric" },
    )}`;
}

/** The explicit span the period navigator shows: "Jul 1 – Jul 31, 2026". */
function rangeLabel(b: Budget): string {
    const start = parseISO(b.starts_on);
    const end = parseISO(b.ends_on);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(
        undefined,
        { month: "short", day: "numeric", year: "numeric" },
    )}`;
}

/** The period after this one — what "start the next period from this plan" means. */
function advancePeriod(b: Budget): { name: string; starts: string; ends: string } {
    const start = parseISO(b.starts_on);
    const end = parseISO(b.ends_on);

    if (b.period_kind === "custom") {
        const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
        const nextStart = new Date(end.getTime() + 86_400_000);
        const nextEnd = new Date(nextStart.getTime() + (days - 1) * 86_400_000);
        return {
            name: rangeName(nextStart, nextEnd, b.period_kind),
            starts: iso(nextStart),
            ends: iso(nextEnd),
        };
    }

    const months = b.period_kind === "quarterly" ? 3 : b.period_kind === "yearly" ? 12 : 1;
    const nextStart = new Date(start.getFullYear(), start.getMonth() + months, 1);
    const nextEnd = new Date(nextStart.getFullYear(), nextStart.getMonth() + months, 0);
    return {
        name: rangeName(nextStart, nextEnd, b.period_kind),
        starts: iso(nextStart),
        ends: iso(nextEnd),
    };
}

/** Days remaining in the period, or null when today sits outside it. */
function daysLeftIn(b: Budget): number | null {
    const today = iso(new Date());
    if (today < b.starts_on || today > b.ends_on) return null;
    return Math.max(
        0,
        Math.round((parseISO(b.ends_on).getTime() - parseISO(today).getTime()) / 86_400_000),
    );
}

/* -------------------------------------------------------------------------- */
/*  Shaping                                                                    */
/* -------------------------------------------------------------------------- */

interface Section {
    id: string;
    name: string;
    color: string | null;
    lines: BudgetProgress[];
}

const OTHER_SECTION = "__other__";

const sum = (lines: BudgetProgress[], field: "planned_amount" | "actual_amount"): number =>
    lines.reduce((total, l) => total + Number(l[field]), 0);

/** Real budgets on one cadence, oldest first — what ‹ and › step through. */
function periodsOf(budgets: Budget[], kind: BudgetPeriod): Budget[] {
    return budgets
        .filter((b) => !b.is_template && b.period_kind === kind)
        .sort((a, b) => a.starts_on.localeCompare(b.starts_on));
}

/** "$412 / $500" counting up, "$88 left" counting down. */
function amountText(
    view: BudgetView,
    planned: number,
    actual: number,
    currency: string,
    money: (value: number, currency: string) => string,
    separator = " / ",
): string {
    if (view === "envelope") {
        const left = planned - actual;
        return left >= 0
            ? `${money(left, currency)} left`
            : `${money(-left, currency)} over`;
    }
    return `${money(actual, currency)}${separator}${money(planned, currency)}`;
}

/**
 * The bar under those figures. Caps fills as the cap is used; envelope drains as
 * the envelope empties. An overdrawn envelope fills solid rather than showing
 * nothing at all, which would read as "no spending" rather than "none left".
 */
function meterFor(
    view: BudgetView,
    planned: number,
    actual: number,
    color: string,
): { pct: number; color: string } {
    if (view === "envelope") {
        const left = planned - actual;
        if (left < 0) return { pct: 100, color: CHART_COLORS.negative };
        return { pct: planned > 0 ? (left / planned) * 100 : 0, color };
    }
    return {
        pct: planned > 0 ? (actual / planned) * 100 : 0,
        color: actual > planned ? CHART_COLORS.negative : color,
    };
}

/**
 * Expense caps, gathered under the category group they belong to — the design's
 * "Needs / Wants / Savings" bands, read off the taxonomy the user actually has.
 * A line measured against a group is filed under it directly; a custom label has
 * no group to belong to, so it lands in "Other caps" at the end.
 */
function buildSections(
    lines: BudgetProgress[],
    groups: Array<{ id: string; name: string; color: string | null }>,
    categoryGroupId: (categoryId: string) => string | undefined,
): Section[] {
    const byId = new Map(groups.map((g) => [g.id, g]));
    const order = new Map(groups.map((g, i) => [g.id, i]));
    const sections = new Map<string, Section>();

    for (const line of lines) {
        const groupId =
            line.group_id ??
            (line.category_id ? categoryGroupId(line.category_id) : undefined) ??
            OTHER_SECTION;
        const group = byId.get(groupId);
        const existing = sections.get(groupId);
        if (existing) {
            existing.lines.push(line);
            continue;
        }
        sections.set(groupId, {
            id: groupId,
            name: group?.name ?? "Other caps",
            color: group?.color ?? null,
            lines: [line],
        });
    }

    return [...sections.values()].sort(
        (a, b) => (order.get(a.id) ?? 9_000) - (order.get(b.id) ?? 9_000),
    );
}

/**
 * How to describe a percentage change. Rounds first, so a move that displays as
 * 0% is called unchanged rather than given a direction the figure doesn't have.
 */
function trendOf(pct: number): { label: string; tone: "up" | "down" | "flat" } {
    const rounded = Math.round(Math.abs(pct));
    if (rounded === 0) return { label: "unchanged", tone: "flat" };
    return { label: `${pct > 0 ? "▲" : "▼"} ${rounded}%`, tone: pct > 0 ? "up" : "down" };
}

/** More spending is the wrong direction, so "up" is the alarming colour here. */
const TREND_TONES = {
    up: "text-rose-400",
    down: "text-emerald-400",
    flat: "text-slate-500",
} as const;

interface Mover {
    label: string;
    now: number;
    before: number;
    /** Percent change against the previous period, or null when it started at 0. */
    pct: number | null;
    color: string;
}

/**
 * Every line that has a same-named counterpart in the previous period, biggest
 * move first. The chart shows the head of this list; the tables read their
 * trend chips off all of it, so a row never claims "no change" merely because
 * it didn't make the top four.
 */
function buildMovers(
    lines: BudgetProgress[],
    previous: BudgetProgress[],
    colorOf: (line: BudgetProgress, index: number) => string,
): Mover[] {
    const before = new Map(previous.map((l) => [l.label, Number(l.actual_amount)]));
    return lines
        .map((line, index) => {
            const was = before.get(line.label);
            const now = Number(line.actual_amount);
            if (was === undefined || (was <= 0 && now <= 0)) return null;
            return {
                label: line.label,
                now,
                before: was,
                pct: was > 0 ? ((now - was) / was) * 100 : null,
                color: colorOf(line, index),
            } satisfies Mover;
        })
        .filter((m): m is Mover => m !== null)
        .sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before));
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Budgets() {
    const budgets = useBudgets();
    const taxonomy = useTaxonomy();
    const categoryById = useCategoryById();
    const upcoming = useScheduled({ activeOnly: true, limit: UPCOMING_BILLS });

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [view, setView] = useState<BudgetView>("caps");
    /** null = whatever the budget on screen happens to be. */
    const [cadence, setCadence] = useState<BudgetPeriod | null>(null);
    const [dismissed, setDismissed] = useState<string[]>([]);
    const [newBudget, setNewBudget] = useState<{ seed?: Budget; kind?: BudgetPeriod } | null>(null);
    const [addingLine, setAddingLine] = useState(false);

    const all = budgets.data ?? [];

    /* Picking a cadence with nothing in it must show that emptiness rather than
       silently falling back to a budget of some other cadence — otherwise the
       switch would say "Quarter" over a monthly plan. */
    const chosen = selectedId ? all.find((b) => b.id === selectedId) : undefined;
    const budget =
        chosen ?? (cadence ? currentBudget(periodsOf(all, cadence)) : currentBudget(all));
    const activeCadence = cadence ?? budget?.period_kind ?? "monthly";

    /* Oldest first, so ‹ and › read as "earlier" and "later". Templates have no
       place on a timeline; they are reachable through the picker instead. */
    const timeline = useMemo(() => periodsOf(all, activeCadence), [all, activeCadence]);

    const at = budget ? timeline.findIndex((b) => b.id === budget.id) : -1;
    const earlier = at > 0 ? timeline[at - 1] : undefined;
    const later = at >= 0 && at < timeline.length - 1 ? timeline[at + 1] : undefined;

    const progress = useBudgetProgress(budget?.id);
    const previous = useBudgetProgress(earlier?.id, !!earlier);

    const budgetOptions = useMemo(
        () =>
            all.map((b) => ({
                value: b.id,
                label: b.name,
                // The navigator beside this already spells the range out; the
                // trigger repeating it would say the same thing twice.
                hint: b.is_template ? "template" : undefined,
                keywords: `${b.currency} ${rangeLabel(b)}`,
            })),
        [all],
    );

    /** Switching cadence lands on the newest plan of that kind, or on nothing. */
    function chooseCadence(kind: BudgetPeriod) {
        setCadence(kind);
        const list = periodsOf(all, kind);
        setSelectedId(list.length ? list[list.length - 1].id : null);
    }

    /** Picking a budget by name puts the cadence switch back under its control. */
    function chooseBudget(id: string) {
        setSelectedId(id);
        setCadence(null);
    }

    /* --- Mutations shared by the banner, the panel and the rows ------------ */

    const qc = useQueryClient();

    const setPlanned = useMutation({
        mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
            const { error } = await requireSupabase()
                .from("budget_categories")
                .update({ planned_amount: amount })
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-progress"] }),
    });

    /* --- Derived ----------------------------------------------------------- */

    const currency = budget?.currency ?? DEFAULT_CURRENCY;
    const isTemplate = budget?.is_template ?? false;
    const lines = progress.data ?? [];
    const expenses = lines.filter((l) => l.kind === "expense");

    const planned = sum(expenses, "planned_amount");
    const actual = sum(expenses, "actual_amount");
    const remaining = planned - actual;

    const previousActual = sum(
        (previous.data ?? []).filter((l) => l.kind === "expense"),
        "actual_amount",
    );
    const vsPrevious =
        earlier && previousActual > 0 ? ((actual - previousActual) / previousActual) * 100 : null;

    /** A cap's colour: the category's own where there is one, else its slot. */
    const colorOf = useCallback(
        (line: BudgetProgress, index: number) =>
            line.kind === "expense"
                ? colorFor(line.category_id ? categoryById.get(line.category_id)?.color : null, index)
                : KIND_COLORS[line.kind],
        [categoryById],
    );

    const sections = useMemo(
        () =>
            buildSections(
                expenses,
                (taxonomy.data ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color })),
                (categoryId) => categoryById.get(categoryId)?.group_id ?? undefined,
            ),
        [expenses, taxonomy.data, categoryById],
    );

    const movers = useMemo(
        () => (isTemplate ? [] : buildMovers(expenses, previous.data ?? [], colorOf)),
        [expenses, previous.data, isTemplate, colorOf],
    );
    const moverPct = new Map(movers.map((m) => [m.label, m.pct]));
    const chartedMovers = movers.slice(0, MOVER_COLUMNS);

    const overspent = expenses
        .filter((l) => Number(l.planned_amount) > 0 && Number(l.actual_amount) > Number(l.planned_amount))
        .sort(
            (a, b) =>
                Number(b.actual_amount) - Number(b.planned_amount) -
                (Number(a.actual_amount) - Number(a.planned_amount)),
        );
    const alert = overspent.find((l) => !dismissed.includes(l.budget_category_id));

    const underspent = expenses
        .filter(
            (l) =>
                Number(l.planned_amount) > 0 &&
                Number(l.actual_amount) < Number(l.planned_amount) * UNDERSPEND_TRIGGER,
        )
        .sort(
            (a, b) =>
                Number(b.planned_amount) - Number(b.actual_amount) -
                (Number(a.planned_amount) - Number(a.actual_amount)),
        )[0];

    const donutRows = [...expenses]
        .filter((l) => Number(l.actual_amount) > 0)
        .sort((a, b) => Number(b.actual_amount) - Number(a.actual_amount))
        .slice(0, DONUT_SLICES);
    const donutTotal = sum(donutRows, "actual_amount");

    const daysLeft = budget && !isTemplate ? daysLeftIn(budget) : null;

    /* --- Render ------------------------------------------------------------ */

    return (
        <>
            <PageHeader
                title="Budgets"
                subtitle={
                    budget
                        ? `${view === "envelope" ? "Envelopes" : "Category caps"} · ${
                              budget.period_kind
                          } · ${budget.currency}`
                        : "Category caps, measured against what you actually spent."
                }
            >
                {all.length > 0 && (
                    <Picker
                        className="w-full sm:w-[12rem]"
                        compact
                        options={budgetOptions}
                        value={budget?.id ?? ""}
                        onChange={chooseBudget}
                        title="Budget"
                        placeholder="Select budget…"
                    />
                )}
                {budget && !isTemplate && (
                    <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} />
                )}
                <Segmented
                    options={CADENCE_OPTIONS}
                    value={activeCadence}
                    onChange={chooseCadence}
                />
                {budget && !isTemplate && (
                    <div className="flex items-center gap-1 rounded-xl bg-slate-900 px-1.5 py-1 shadow-card">
                        <button
                            className="sb-page"
                            aria-label="Earlier period"
                            disabled={!earlier}
                            onClick={() => earlier && setSelectedId(earlier.id)}
                        >
                            <ChevronLeftIcon size={15} />
                        </button>
                        <span className="px-1 text-[0.8125rem] font-semibold text-slate-200 tnum">
                            {rangeLabel(budget)}
                        </span>
                        <button
                            className="sb-page"
                            aria-label="Later period"
                            disabled={!later}
                            onClick={() => later && setSelectedId(later.id)}
                        >
                            <ChevronRightIcon size={15} />
                        </button>
                    </div>
                )}
                <button className="sb-btn sb-btn-soft" onClick={() => setNewBudget({})}>
                    New budget
                </button>
                {budget && (
                    <button className="sb-btn sb-btn-primary" onClick={() => setAddingLine(true)}>
                        <PlusIcon size={15} />
                        New category
                    </button>
                )}
            </PageHeader>

            <QueryError error={budgets.error ?? progress.error} />

            {!budget && (
                <DashedCard className="flex flex-col items-start gap-3">
                    <div>
                        <h2 className="text-[0.9375rem] font-bold text-slate-100">
                            {budgets.isLoading
                                ? "Loading…"
                                : all.length === 0
                                  ? "No budgets yet"
                                  : `No ${CADENCE_NOUNS[activeCadence]} budgets yet`}
                        </h2>
                        <p className="mt-1 text-[0.84375rem] text-slate-400">
                            A budget is a period plus a set of caps. Create one and every accepted
                            transaction in those categories starts counting against it.
                        </p>
                    </div>
                    {!budgets.isLoading && (
                        <button
                            className="sb-btn sb-btn-primary"
                            onClick={() => setNewBudget({ kind: activeCadence })}
                        >
                            <PlusIcon size={15} />
                            Create a {CADENCE_NOUNS[activeCadence]} budget
                        </button>
                    )}
                </DashedCard>
            )}

            {budget && (
                <>
                    {/* --- The one line that is in trouble --------------------- */}
                    {alert && (
                        <OverspendAlert
                            line={alert}
                            currency={currency}
                            daysLeft={daysLeft}
                            pending={setPlanned.isPending}
                            onRaise={(amount) =>
                                setPlanned.mutate({ id: alert.budget_category_id, amount })
                            }
                            onDismiss={() =>
                                setDismissed((ids) => [...ids, alert.budget_category_id])
                            }
                        />
                    )}

                    {/* --- Roll-up + Sage ------------------------------------- */}
                    <div className="grid items-start gap-[18px] xl:grid-cols-[1.5fr_1fr]">
                        <Card feature>
                            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                                <h2 className="text-[0.9375rem] font-bold text-slate-100">
                                    {isTemplate
                                        ? "Planned total"
                                        : view === "envelope"
                                          ? "Left in the envelopes"
                                          : "Total budget"}
                                </h2>
                                <span className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-slate-400">
                                    {isTemplate ? (
                                        <span className="tnum">{fmtMoney(planned, currency)} planned</span>
                                    ) : view === "envelope" ? (
                                        <span className="tnum">
                                            {fmtMoney(Math.abs(remaining), currency)}{" "}
                                            {remaining >= 0 ? "left of" : "over"}{" "}
                                            {fmtMoney(planned, currency)} · {fmtMoney(actual, currency)}{" "}
                                            spent
                                        </span>
                                    ) : (
                                        <span className="tnum">
                                            {fmtMoney(actual, currency)} of {fmtMoney(planned, currency)}
                                            {planned > 0 &&
                                                ` · ${fmtMoney(Math.abs(remaining), currency)} ${
                                                    remaining >= 0 ? "left" : "over"
                                                }`}
                                        </span>
                                    )}
                                    {vsPrevious !== null && Math.round(Math.abs(vsPrevious)) > 0 && (
                                        <Pill tint={vsPrevious > 0 ? "amber" : "green"}>
                                            {trendOf(vsPrevious).label} vs {earlier?.name}
                                        </Pill>
                                    )}
                                </span>
                            </div>

                            <Meter
                                height={12}
                                {...meterFor(
                                    isTemplate ? "caps" : view,
                                    planned,
                                    isTemplate ? 0 : actual,
                                    CHART_COLORS.primary,
                                )}
                            />

                            {sections.length > 0 && (
                                <div className="mt-[18px] grid gap-3.5 sm:grid-cols-3">
                                    {sections
                                        .slice()
                                        .sort(
                                            (a, b) =>
                                                sum(b.lines, "planned_amount") -
                                                sum(a.lines, "planned_amount"),
                                        )
                                        .slice(0, GROUP_METERS)
                                        .map((s, i) => {
                                            const groupPlanned = sum(s.lines, "planned_amount");
                                            const groupActual = sum(s.lines, "actual_amount");
                                            return (
                                                <MeterRow
                                                    key={s.id}
                                                    label={s.name}
                                                    value={
                                                        isTemplate
                                                            ? fmtMoneyCompact(groupPlanned, currency)
                                                            : amountText(
                                                                  view,
                                                                  groupPlanned,
                                                                  groupActual,
                                                                  currency,
                                                                  fmtMoneyCompact,
                                                                  "/",
                                                              )
                                                    }
                                                    {...meterFor(
                                                        isTemplate ? "caps" : view,
                                                        groupPlanned,
                                                        isTemplate ? 0 : groupActual,
                                                        colorFor(s.color, i),
                                                    )}
                                                />
                                            );
                                        })}
                                </div>
                            )}

                            {!isTemplate && (
                                <button
                                    onClick={() => setNewBudget({ seed: budget })}
                                    className="sb-nested mt-[18px] flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:brightness-[0.98]"
                                >
                                    <span className="text-sky-300">
                                        <ReplayIcon size={16} />
                                    </span>
                                    <span className="min-w-0 flex-1 text-[0.8125rem] text-slate-300">
                                        Start {advancePeriod(budget).name} from this plan
                                    </span>
                                    <span className="shrink-0 text-[0.78125rem] font-bold text-sky-300">
                                        Apply →
                                    </span>
                                </button>
                            )}
                        </Card>

                        <SagePanel
                            budget={budget}
                            currency={currency}
                            line={underspent}
                            overspentCount={overspent.length}
                            pending={setPlanned.isPending}
                            onTrim={(id, amount) => setPlanned.mutate({ id, amount })}
                        />
                    </div>

                    {/* --- Where the money went ------------------------------- */}
                    {!isTemplate && donutRows.length > 0 && (
                        <div
                            className={`grid gap-[18px] ${
                                chartedMovers.length > 0 ? "lg:grid-cols-[1.5fr_1fr]" : ""
                            }`}
                        >
                            <Card feature>
                                <CardHeader title={`Spending by category · ${budget.name}`} />
                                <div className="flex flex-wrap items-center gap-7">
                                    <Donut
                                        size={140}
                                        slices={donutRows.map((l, i) => ({
                                            value: Number(l.actual_amount),
                                            color: colorOf(l, i),
                                        }))}
                                        total={donutTotal}
                                        label={fmtMoneyCompact(actual, currency)}
                                        caption="spent"
                                    />
                                    <div className="flex min-w-[11rem] flex-1 flex-col gap-2.5">
                                        {donutRows.map((l, i) => {
                                            const over =
                                                Number(l.actual_amount) > Number(l.planned_amount) &&
                                                Number(l.planned_amount) > 0;
                                            return (
                                                <span
                                                    key={l.budget_category_id}
                                                    className="flex items-center gap-2.5 text-[0.78125rem]"
                                                >
                                                    <LegendDot color={colorOf(l, i)} />
                                                    <span className="min-w-0 flex-1 truncate font-semibold text-slate-200">
                                                        {l.label}
                                                    </span>
                                                    <span
                                                        className={`shrink-0 tnum ${
                                                            over
                                                                ? "font-bold text-rose-400"
                                                                : "text-slate-400"
                                                        }`}
                                                    >
                                                        {fmtMoneyCompact(Number(l.actual_amount), currency)}
                                                        {donutTotal > 0 &&
                                                            ` · ${Math.round(
                                                                (Number(l.actual_amount) / donutTotal) * 100,
                                                            )}%`}
                                                    </span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            </Card>

                            {chartedMovers.length > 0 && earlier && (
                                <Card feature>
                                    <CardHeader title={`Top movers vs. ${earlier.name}`} />
                                    <MoverColumns movers={chartedMovers} currency={currency} />
                                    <div className="mt-4 flex gap-3.5 text-[0.71875rem] text-slate-500">
                                        <span className="flex items-center gap-1.5">
                                            <LegendDot color={CHART_COLORS.primary} />
                                            This period
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <LegendDot color="var(--color-slate-700)" />
                                            {earlier.name}
                                        </span>
                                    </div>
                                </Card>
                            )}
                        </div>
                    )}

                    {/* --- The caps themselves -------------------------------- */}
                    {sections.map((section, i) => (
                        <CapSection
                            key={section.id}
                            title={section.name}
                            color={colorFor(section.color, i)}
                            lines={section.lines}
                            currency={currency}
                            view={view}
                            isTemplate={isTemplate}
                            moverPct={moverPct}
                            previousName={earlier?.name}
                            colorOf={colorOf}
                        />
                    ))}

                    {KIND_SECTIONS.map(({ kind, title }) => {
                        const kindLines = lines.filter((l) => l.kind === kind);
                        if (kindLines.length === 0) return null;
                        return (
                            <CapSection
                                key={kind}
                                title={title}
                                color={KIND_COLORS[kind]}
                                lines={kindLines}
                                currency={currency}
                                view={view}
                                isTemplate={isTemplate}
                                moverPct={moverPct}
                                previousName={earlier?.name}
                                colorOf={colorOf}
                            />
                        );
                    })}

                    {lines.length === 0 && (
                        <DashedCard className="flex flex-col items-start gap-3">
                            <div>
                                <h2 className="text-[0.9375rem] font-bold text-slate-100">
                                    No caps in this budget yet
                                </h2>
                                <p className="mt-1 text-[0.84375rem] text-slate-400">
                                    {progress.isLoading
                                        ? "Loading…"
                                        : "Add a category and its limit; spending in that category counts against it from here on."}
                                </p>
                            </div>
                            {!progress.isLoading && (
                                <button
                                    className="sb-btn sb-btn-primary"
                                    onClick={() => setAddingLine(true)}
                                >
                                    <PlusIcon size={15} />
                                    New category
                                </button>
                            )}
                        </DashedCard>
                    )}

                    {/* --- What is already committed -------------------------- */}
                    {!isTemplate && (upcoming.data ?? []).length > 0 && (
                        <Card>
                            <h2 className="mb-3.5 text-[0.8125rem] font-bold text-slate-200">
                                Upcoming recurring bills
                            </h2>
                            <div className="flex flex-wrap gap-3">
                                {(upcoming.data ?? []).map((s, i) => (
                                    <Link
                                        key={s.id}
                                        to="/scheduled"
                                        className="sb-nested flex items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:brightness-[0.98]"
                                    >
                                        <LegendDot color={seriesColor(i)} />
                                        <span>
                                            <span className="block text-[0.78125rem] font-semibold text-slate-200">
                                                {s.name}
                                            </span>
                                            <span className="block text-[0.71875rem] text-slate-500 tnum">
                                                {parseISO(s.next_due).toLocaleDateString(undefined, {
                                                    month: "short",
                                                    day: "numeric",
                                                })}{" "}
                                                · {fmtMoney(Number(s.amount), s.currency)}
                                            </span>
                                        </span>
                                    </Link>
                                ))}
                            </div>
                        </Card>
                    )}

                    <DeleteBudgetRow budget={budget} onDeleted={() => setSelectedId(null)} />
                </>
            )}

            <NewBudgetModal
                open={newBudget !== null}
                seed={newBudget?.seed}
                kind={newBudget?.kind}
                budgets={all}
                onClose={() => setNewBudget(null)}
                onCreated={(id) => {
                    setNewBudget(null);
                    if (id) setSelectedId(id);
                }}
            />

            {budget && (
                <AddLineModal
                    open={addingLine}
                    budgetId={budget.id}
                    onClose={() => setAddingLine(false)}
                />
            )}
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  Overspend banner                                                           */
/* -------------------------------------------------------------------------- */

function OverspendAlert({
    line,
    currency,
    daysLeft,
    pending,
    onRaise,
    onDismiss,
}: {
    line: BudgetProgress;
    currency: string;
    daysLeft: number | null;
    pending: boolean;
    onRaise: (amount: number) => void;
    onDismiss: () => void;
}) {
    const spent = Number(line.actual_amount);
    const cap = Number(line.planned_amount);
    const over = Math.round(((spent - cap) / cap) * 100);
    // The cap that would actually cover this period, rounded to something a
    // person would type.
    const suggestion = Math.ceil(spent / 10) * 10;

    return (
        <div className="flex flex-wrap items-center gap-3.5 rounded-3xl bg-coral-soft px-5 py-3.5">
            <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-coral text-white">
                <WarningIcon size={17} />
            </span>
            <div className="min-w-0 flex-1">
                <div className="text-[0.84375rem] font-bold text-slate-100">
                    {line.label} is {over}% over budget
                </div>
                <div className="mt-0.5 text-[0.78125rem] text-slate-300 tnum">
                    {fmtMoney(spent, currency)} spent of {fmtMoney(cap, currency)}
                    {daysLeft !== null &&
                        `, with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left in the period`}
                    .
                </div>
            </div>
            <button
                className="sb-btn sb-btn-soft shrink-0"
                disabled={pending}
                onClick={() => onRaise(suggestion)}
            >
                Raise to {fmtMoney(suggestion, currency)}
            </button>
            <button
                className="shrink-0 text-[0.78125rem] font-semibold text-slate-400 hover:text-slate-200"
                onClick={onDismiss}
            >
                Dismiss
            </button>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Sage's read on the plan                                                    */
/* -------------------------------------------------------------------------- */

function SagePanel({
    budget,
    currency,
    line,
    overspentCount,
    pending,
    onTrim,
}: {
    budget: Budget;
    currency: string;
    line: BudgetProgress | undefined;
    overspentCount: number;
    pending: boolean;
    onTrim: (id: string, amount: number) => void;
}) {
    // Trim to what was actually used, with a little headroom, rounded up.
    const trimmed = line ? Math.ceil((Number(line.actual_amount) * 1.1) / 10) * 10 : 0;
    const spare = line ? Number(line.planned_amount) - Number(line.actual_amount) : 0;

    return (
        <DarkPanel className="flex h-full flex-col justify-between gap-4">
            <div>
                <div className="mb-3 flex items-center gap-2">
                    <span className="h-[7px] w-[7px] rounded-full bg-coral" />
                    <span className="text-[0.71875rem] font-bold uppercase tracking-[0.1em] text-[#9aa0ad]">
                        Sage noticed
                    </span>
                </div>
                <p className="text-[1.03125rem] font-semibold leading-[1.35] tracking-[-0.01em]">
                    {budget.is_template
                        ? "This is a template — nothing is measured against it until you clone it into a period."
                        : line && trimmed < Number(line.planned_amount)
                          ? `${line.label} is running ${fmtMoney(spare, currency)} under its cap — trim it to ${fmtMoney(trimmed, currency)}?`
                          : overspentCount > 0
                            ? `${overspentCount} cap${overspentCount === 1 ? " is" : "s are"} over their limit this period.`
                            : "Every cap is inside its limit this period."}
                </p>
            </div>
            <div className="flex flex-wrap gap-2">
                {!budget.is_template && line && trimmed < Number(line.planned_amount) && (
                    <button
                        className="sb-btn sb-btn-primary !py-2 !text-[0.78125rem]"
                        disabled={pending}
                        onClick={() => onTrim(line.budget_category_id, trimmed)}
                    >
                        Trim to {fmtMoney(trimmed, currency)}
                    </button>
                )}
                <Link
                    to="/console"
                    className="sb-btn !py-2 !text-[0.78125rem] border border-[#2c313d] font-semibold text-[#d5d8de] hover:bg-white/5"
                >
                    Ask Sage
                </Link>
            </div>
        </DarkPanel>
    );
}

/* -------------------------------------------------------------------------- */
/*  Top movers                                                                 */
/* -------------------------------------------------------------------------- */

function MoverColumns({ movers, currency }: { movers: Mover[]; currency: string }) {
    const peak = Math.max(1, ...movers.flatMap((m) => [m.now, m.before]));

    return (
        <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${movers.length}, 1fr)` }}>
            {movers.map((m) => (
                <div key={m.label} className="min-w-0">
                    <div className="mb-2 truncate text-xs font-semibold text-slate-300">
                        {m.label}
                    </div>
                    <div className="flex h-[70px] items-end gap-1.5">
                        <span
                            className="w-4 rounded-t"
                            title={`This period: ${fmtMoney(m.now, currency)}`}
                            style={{ height: `${(m.now / peak) * 100}%`, background: m.color }}
                        />
                        <span
                            className="w-4 rounded-t"
                            title={`Previous: ${fmtMoney(m.before, currency)}`}
                            style={{
                                height: `${(m.before / peak) * 100}%`,
                                background: "var(--color-slate-700)",
                            }}
                        />
                    </div>
                    <div
                        className={`mt-1.5 text-[0.6875rem] font-bold ${
                            m.pct === null ? "text-slate-500" : TREND_TONES[trendOf(m.pct).tone]
                        }`}
                    >
                        {m.pct === null ? "new" : trendOf(m.pct).label}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** A line's move against the same line last period, named and coloured. */
function TrendChip({ pct, previousName }: { pct: number; previousName?: string }) {
    const { label, tone } = trendOf(pct);
    return (
        <span className={`text-[0.71875rem] font-semibold ${TREND_TONES[tone]}`}>
            {label}
            {tone !== "flat" && previousName ? ` vs ${previousName}` : ""}
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/*  A group of caps                                                            */
/* -------------------------------------------------------------------------- */

function CapSection({
    title,
    color,
    lines,
    currency,
    view,
    isTemplate,
    moverPct,
    previousName,
    colorOf,
}: {
    title: string;
    color: string;
    lines: BudgetProgress[];
    currency: string;
    view: BudgetView;
    isTemplate: boolean;
    moverPct: Map<string, number | null>;
    previousName?: string;
    colorOf: (line: BudgetProgress, index: number) => string;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const planned = sum(lines, "planned_amount");
    const actual = sum(lines, "actual_amount");

    return (
        <Card padded={false}>
            <button
                onClick={() => setCollapsed((c) => !c)}
                aria-expanded={!collapsed}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left"
            >
                <span className="flex min-w-0 flex-wrap items-center gap-2.5 text-[0.875rem] font-bold text-slate-100">
                    <LegendDot color={color} />
                    {title}
                    <span className="font-medium text-slate-400 tnum">
                        {isTemplate
                            ? fmtMoney(planned, currency)
                            : amountText(view, planned, actual, currency, fmtMoney, " of ")}
                    </span>
                </span>
                <span className={`shrink-0 text-slate-500 ${collapsed ? "-rotate-90" : ""}`}>
                    <ChevronDownIcon size={15} />
                </span>
            </button>

            {!collapsed &&
                lines.map((line, i) => (
                    <CapRow
                        key={line.budget_category_id}
                        line={line}
                        color={colorOf(line, i)}
                        currency={currency}
                        view={view}
                        isTemplate={isTemplate}
                        pct={moverPct.get(line.label)}
                        previousName={previousName}
                    />
                ))}
        </Card>
    );
}

function CapRow({
    line,
    color,
    currency,
    view,
    isTemplate,
    pct,
    previousName,
}: {
    line: BudgetProgress;
    color: string;
    currency: string;
    view: BudgetView;
    isTemplate: boolean;
    pct: number | null | undefined;
    previousName?: string;
}) {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");

    const planned = Number(line.planned_amount);
    const actual = Number(line.actual_amount);
    const over = planned > 0 && actual > planned;

    const save = useMutation({
        mutationFn: async (amount: number) => {
            const { error } = await requireSupabase()
                .from("budget_categories")
                .update({ planned_amount: amount })
                .eq("id", line.budget_category_id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ["budget-progress"] });
        },
    });

    const remove = useMutation({
        mutationFn: async () => {
            const { error } = await requireSupabase()
                .from("budget_categories")
                .delete()
                .eq("id", line.budget_category_id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-progress"] }),
    });

    return (
        <div className="sb-row flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-5 py-3">
            <LegendDot color={color} />

            <div className="min-w-0 flex-1 basis-[9rem] truncate text-[0.84375rem] font-semibold text-slate-200">
                {line.label}
                {Number(line.tx_count) > 0 && !isTemplate && (
                    <span className="ml-2 text-xs font-medium text-slate-500">
                        · {Number(line.tx_count)} entr{Number(line.tx_count) === 1 ? "y" : "ies"}
                    </span>
                )}
            </div>

            {!isTemplate && (
                <span className="hidden w-[7.5rem] shrink-0 sm:block">
                    {line.rollover ? (
                        <Pill tint="green">rollover</Pill>
                    ) : pct === null || pct === undefined ? (
                        // No counterpart in the previous period, or it started
                        // from nothing — either way there is no percentage to
                        // quote, so say what is true instead of "0%".
                        <span className="text-[0.71875rem] font-semibold text-slate-500">
                            {previousName ? "new this period" : ""}
                        </span>
                    ) : (
                        <TrendChip pct={pct} previousName={previousName} />
                    )}
                </span>
            )}

            {editing ? (
                <form
                    className="flex items-center gap-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        save.mutate(Number(draft) || 0);
                    }}
                >
                    <Input
                        compact
                        className="w-28"
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft}
                        aria-label={`Cap for ${line.label}`}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                    />
                    <button className="sb-btn sb-btn-primary !py-1.5" disabled={save.isPending}>
                        Save
                    </button>
                    <button
                        type="button"
                        className="sb-btn sb-btn-ghost !py-1.5"
                        onClick={() => setEditing(false)}
                    >
                        Cancel
                    </button>
                </form>
            ) : (
                <span
                    className={`shrink-0 text-[0.8125rem] tnum sm:w-[8.5rem] sm:text-right ${
                        over ? "font-bold text-rose-400" : "text-slate-400"
                    }`}
                    title={
                        isTemplate
                            ? fmtMoney(planned, currency)
                            : `${fmtMoney(actual, currency)} spent of ${fmtMoney(planned, currency)}`
                    }
                >
                    {isTemplate
                        ? fmtMoney(planned, currency)
                        : amountText(view, planned, actual, currency, fmtMoneyCompact)}
                </span>
            )}

            {!isTemplate && (
                <span className="w-full sm:w-[11rem]">
                    <Meter height={7} {...meterFor(view, planned, actual, color)} />
                </span>
            )}

            <span className="sb-row-actions ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
                <button
                    aria-label={`Edit cap for ${line.label}`}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    onClick={() => {
                        setDraft(String(planned));
                        setEditing(true);
                    }}
                >
                    <EditIcon size={15} />
                </button>
                <button
                    aria-label={`Remove ${line.label} from this budget`}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-rose-400"
                    onClick={() =>
                        confirm({
                            title: `Remove the ${line.label} cap?`,
                            body: "It disappears from this budget and stops being measured. Your transactions are untouched — only the target goes.",
                            confirmLabel: "Remove cap",
                            danger: true,
                            alternative: {
                                label: "Set it to 0 instead",
                                hint: "Keeps the line visible so you can still see what lands in it.",
                                onSelect: () => save.mutate(0),
                            },
                            onConfirm: () => remove.mutate(),
                        })
                    }
                >
                    <TrashIcon size={15} />
                </button>
            </span>

            <QueryError error={save.error ?? remove.error} />
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Delete the budget                                                          */
/* -------------------------------------------------------------------------- */

function DeleteBudgetRow({ budget, onDeleted }: { budget: Budget; onDeleted: () => void }) {
    const qc = useQueryClient();
    const confirm = useConfirm();

    const remove = useMutation({
        mutationFn: async () => {
            const { error } = await requireSupabase().from("budgets").delete().eq("id", budget.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: QK.budgets });
            onDeleted();
        },
    });

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <QueryError error={remove.error} />
            <button
                className="sb-btn sb-btn-ghost ml-auto !text-rose-400"
                onClick={() =>
                    confirm({
                        title: `Delete "${budget.name}"?`,
                        body: "The budget and every cap in it go for good. Your transactions are untouched — only the plan they were measured against disappears.",
                        confirmLabel: "Delete permanently",
                        danger: true,
                        requirePhrase: budget.name,
                        onConfirm: () => remove.mutate(),
                    })
                }
            >
                <TrashIcon size={15} />
                Delete this budget
            </button>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  New budget                                                                 */
/* -------------------------------------------------------------------------- */

function NewBudgetModal({
    open,
    seed,
    kind,
    budgets,
    onClose,
    onCreated,
}: {
    open: boolean;
    /** Budget whose plan and period this one follows on from. */
    seed?: Budget;
    /** Cadence to open on, when the switch landed somewhere with no budgets. */
    kind?: BudgetPeriod;
    budgets: Budget[];
    onClose: () => void;
    onCreated: (id: string | null) => void;
}) {
    const next = seed ? advancePeriod(seed) : null;
    // Remounted per seed so "Apply" always opens on the period it promised.
    return (
        <Modal
            key={seed?.id ?? kind ?? "blank"}
            open={open}
            onClose={onClose}
            title="New budget"
            subtitle={
                seed
                    ? `Carrying the caps from ${seed.name} into ${next?.name}`
                    : "A period, a currency, and the caps you add to it"
            }
        >
            <NewBudgetForm seed={seed} kind={kind} budgets={budgets} onCreated={onCreated} />
        </Modal>
    );
}

function NewBudgetForm({
    seed,
    kind,
    budgets,
    onCreated,
}: {
    seed?: Budget;
    kind?: BudgetPeriod;
    budgets: Budget[];
    onCreated: (id: string | null) => void;
}) {
    const qc = useQueryClient();
    const next = seed ? advancePeriod(seed) : null;
    const opensOn = seed?.period_kind ?? kind ?? "monthly";
    const initial = periodDates(opensOn);

    const [name, setName] = useState(next?.name ?? "");
    const [periodKind, setPeriodKind] = useState<BudgetPeriod>(opensOn);
    const [startsOn, setStartsOn] = useState(next?.starts ?? initial.starts);
    const [endsOn, setEndsOn] = useState(next?.ends ?? initial.ends);
    const [currency, setCurrency] = useState(seed?.currency ?? DEFAULT_CURRENCY);
    const [isTemplate, setIsTemplate] = useState(false);
    const [cloneFrom, setCloneFrom] = useState(seed?.id ?? "");

    function handlePeriodChange(kind: BudgetPeriod) {
        setPeriodKind(kind);
        if (kind !== "custom") {
            const { starts, ends } = periodDates(kind);
            setStartsOn(starts);
            setEndsOn(ends);
        }
    }

    const create = useMutation({
        mutationFn: async (): Promise<string | null> => {
            const sb = requireSupabase();
            if (cloneFrom) {
                const { data, error } = await sb.rpc("clone_budget", {
                    p_source_id: cloneFrom,
                    p_name: name.trim(),
                    p_starts_on: startsOn,
                    p_ends_on: endsOn,
                    p_apply_rollover: true,
                });
                if (error) throw new Error(error.message);
                return typeof data === "string" ? data : null;
            }
            const { data: u } = await sb.auth.getUser();
            if (!u.user) throw new Error("not signed in");
            const { data, error } = await sb
                .from("budgets")
                .insert({
                    user_id: u.user.id,
                    name: name.trim(),
                    period_kind: periodKind,
                    starts_on: startsOn,
                    ends_on: endsOn,
                    currency: currency.trim().toUpperCase(),
                    is_template: isTemplate,
                })
                .select("id")
                .single();
            if (error) throw new Error(error.message);
            return (data as { id: string } | null)?.id ?? null;
        },
        onSuccess: (id) => {
            qc.invalidateQueries({ queryKey: QK.budgets });
            onCreated(id);
        },
    });

    // Any existing budget can seed a new one; templates say so on the row.
    const cloneOptions = useMemo(
        () =>
            budgets.map((b) => ({
                value: b.id,
                label: b.name,
                hint: b.is_template ? "template" : undefined,
            })),
        [budgets],
    );

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim()) create.mutate();
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2">
                <Input
                    placeholder="Name, e.g. August 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-label="Budget name"
                    required
                />
                <Picker
                    options={PERIOD_OPTIONS}
                    value={periodKind}
                    onChange={handlePeriodChange}
                    title="Period"
                />
                <Input
                    type="date"
                    value={startsOn}
                    aria-label="Starts on"
                    onChange={(e) => setStartsOn(e.target.value)}
                    required
                />
                <Input
                    type="date"
                    value={endsOn}
                    aria-label="Ends on"
                    onChange={(e) => setEndsOn(e.target.value)}
                    required
                />
                <Input
                    placeholder="Currency"
                    value={currency}
                    maxLength={3}
                    aria-label="Currency"
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    required
                />
                {cloneOptions.length > 0 && (
                    <Picker
                        options={cloneOptions}
                        value={cloneFrom}
                        onChange={setCloneFrom}
                        placeholder="Clone caps from… (optional)"
                        title="Clone from"
                        clearable
                    />
                )}
            </div>

            <label className="flex items-center gap-2.5 text-[0.84375rem] text-slate-400">
                <input
                    type="checkbox"
                    className="sb-check"
                    checked={isTemplate}
                    onChange={(e) => setIsTemplate(e.target.checked)}
                />
                Save as a reusable template
            </label>

            <QueryError error={create.error} />

            <button
                className="sb-btn sb-btn-primary self-start"
                disabled={create.isPending || !name.trim()}
            >
                {create.isPending ? "Creating…" : "Create budget"}
            </button>
        </form>
    );
}

/* -------------------------------------------------------------------------- */
/*  New cap                                                                    */
/* -------------------------------------------------------------------------- */

function AddLineModal({
    open,
    budgetId,
    onClose,
}: {
    open: boolean;
    budgetId: string;
    onClose: () => void;
}) {
    return (
        <Modal
            open={open}
            onClose={onClose}
            title="New category"
            subtitle="What to measure, and the limit it should stay inside"
        >
            <AddLineForm budgetId={budgetId} onAdded={onClose} />
        </Modal>
    );
}

function AddLineForm({ budgetId, onAdded }: { budgetId: string; onAdded: () => void }) {
    const qc = useQueryClient();
    const taxonomy = useTaxonomy();
    const categoryOpts = useCategoryOptions();
    const groupOptions = useMemo(
        () => (taxonomy.data ?? []).map((g) => ({ value: g.id, label: g.name })),
        [taxonomy.data],
    );

    const [kind, setKind] = useState<BudgetLineKind>("expense");
    const [categoryId, setCategoryId] = useState("");
    const [groupId, setGroupId] = useState("");
    const [label, setLabel] = useState("");
    const [amount, setAmount] = useState("");
    const [rollover, setRollover] = useState(false);
    const [mode, setMode] = useState<"category" | "group" | "custom">("category");

    const add = useMutation({
        mutationFn: async () => {
            const { error } = await requireSupabase().from("budget_categories").insert({
                budget_id: budgetId,
                category_id: mode === "category" && categoryId ? categoryId : null,
                group_id: mode === "group" && groupId ? groupId : null,
                label: mode === "custom" ? label.trim() : null,
                kind,
                planned_amount: Number(amount) || 0,
                rollover,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setCategoryId("");
            setGroupId("");
            setLabel("");
            setAmount("");
            setRollover(false);
            qc.invalidateQueries({ queryKey: ["budget-progress"] });
            onAdded();
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const hasTarget =
            (mode === "category" && categoryId) ||
            (mode === "group" && groupId) ||
            (mode === "custom" && label.trim());
        if (hasTarget) add.mutate();
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid gap-2.5 sm:grid-cols-2">
                <Picker options={KIND_OPTIONS} value={kind} onChange={setKind} title="Line kind" />
                <Picker options={MODE_OPTIONS} value={mode} onChange={setMode} title="Measured by" />

                {mode === "category" && (
                    <Picker
                        className="sm:col-span-2"
                        options={categoryOpts}
                        value={categoryId}
                        onChange={setCategoryId}
                        placeholder="Select category…"
                        title="Category"
                    />
                )}
                {mode === "group" && (
                    <Picker
                        className="sm:col-span-2"
                        options={groupOptions}
                        value={groupId}
                        onChange={setGroupId}
                        placeholder="Select group…"
                        title="Group"
                    />
                )}
                {mode === "custom" && (
                    <Input
                        className="sm:col-span-2"
                        placeholder="Custom label, e.g. Emergency fund"
                        value={label}
                        aria-label="Custom label"
                        onChange={(e) => setLabel(e.target.value)}
                        required
                    />
                )}

                <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Cap amount"
                    value={amount}
                    aria-label="Cap amount"
                    onChange={(e) => setAmount(e.target.value)}
                />
                <label className="flex items-center gap-2.5 text-[0.84375rem] text-slate-400">
                    <input
                        type="checkbox"
                        className="sb-check"
                        checked={rollover}
                        onChange={(e) => setRollover(e.target.checked)}
                    />
                    Roll unspent room forward
                </label>
            </div>

            <QueryError error={add.error} />

            <button className="sb-btn sb-btn-primary self-start" disabled={add.isPending}>
                {add.isPending ? "Adding…" : "Add category"}
            </button>
        </form>
    );
}
