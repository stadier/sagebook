/* Scheduled — money you expect to move.

   The page was a generic table: one flat list of rows, a permanently-open
   create form above it, and no way to change an item once it existed — a typo
   in a salary meant deleting the schedule and building it again. The design
   turns it into three standing sections, because "recurring", "owed to me" and
   "I owe" are three different questions, and each section keeps its own "add
   one" row so the answer to "where does a new bill go?" is on screen.

   Everything an item can do is on its card: post it now, skip one occurrence,
   pause it, delete it. Editing is a dialog, shared with creating, so there is
   exactly one description of what a scheduled item is. */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConfirm } from "../components/Confirm";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    PauseIcon,
    PlayIcon,
    PlusIcon,
    SendIcon,
    SkipIcon,
    TrashIcon,
} from "../components/icons";
import {
    DashedCard,
    FilterPill,
    Input,
    LegendDot,
    Modal,
    PageHeader,
    Picker,
    Pill,
    QueryError,
    Segmented,
} from "../components/ui";
import { DEFAULT_CURRENCY } from "../lib/constants";
import { fmtDateShort, fmtMoney } from "../lib/format";
import { pairOptions } from "../lib/options";
import {
    QK,
    useAccountOptions,
    useAccounts,
    useCategoryById,
    useCategoryOptions,
    useScheduled,
} from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import { CHART_SERIES } from "../lib/theme";
import type { Recurrence, ScheduledTransaction } from "../lib/types";

/* -------------------------------------------------------------------------- */
/*  The model the page thinks in                                               */
/* -------------------------------------------------------------------------- */

type GroupKey = "recurring" | "receivable" | "payable";

/* The three standing sections. A scheduled item is always in exactly one of
   them — the pair (schedule_kind, kind) decides which, so the sections are a
   view of the data rather than a field anyone has to set. */
const GROUPS: Array<{
    key: GroupKey;
    label: string;
    color: string;
    addLabel: string;
    blurb: string;
}> = [
    {
        key: "recurring",
        label: "Recurring",
        color: CHART_SERIES[0],
        addLabel: "+ Add something that repeats",
        blurb: "Salary, rent, subscriptions — anything on a cadence.",
    },
    {
        key: "receivable",
        label: "Owed to me",
        color: CHART_SERIES[5],
        addLabel: "+ Add money owed to me",
        blurb: "A one-off someone still has to pay you.",
    },
    {
        key: "payable",
        label: "I owe",
        color: CHART_SERIES[1],
        addLabel: "+ Add money I owe",
        blurb: "A one-off you still have to settle.",
    },
];

const RECURRENCE_LABEL: Record<Recurrence, string> = {
    weekly: "weekly",
    biweekly: "every 2 weeks",
    monthly: "monthly",
    quarterly: "quarterly",
    yearly: "yearly",
};

/** Roughly how many times a cadence fires in a month — for the per-month line. */
const PER_MONTH: Record<Recurrence, number> = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
};

const RECURRENCE_OPTIONS = pairOptions([
    { value: "weekly", label: "Weekly" },
    { value: "biweekly", label: "Every 2 weeks" },
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "yearly", label: "Yearly" },
] as const);

const DIRECTION_OPTIONS = [
    { value: "income" as const, label: "Money in" },
    { value: "expense" as const, label: "Money out" },
];

const SCHEDULE_OPTIONS = [
    { value: "recurring" as const, label: "Repeats" },
    { value: "one_off" as const, label: "One-off" },
];

const POSTING_OPTIONS = [
    { value: "auto" as const, label: "Post automatically" },
    { value: "manual" as const, label: "Ask me first" },
];

function todayISO(): string {
    return new Date().toISOString().slice(0, 10);
}

function groupOf(s: ScheduledTransaction): GroupKey {
    if (s.schedule_kind === "recurring") return "recurring";
    return s.kind === "income" ? "receivable" : "payable";
}

function isDue(s: ScheduledTransaction): boolean {
    return s.active && s.next_due <= todayISO();
}

/** What kind of expected money this is, in one phrase. */
function flavour(s: ScheduledTransaction): string {
    if (s.schedule_kind === "recurring") {
        const cadence = s.recurrence ? RECURRENCE_LABEL[s.recurrence] : "repeating";
        return `${s.kind === "income" ? "Recurring income" : "Recurring payment"} · ${cadence}`;
    }
    return s.kind === "income" ? "Owed to me" : "I owe";
}

/** How far off a due date is, in the words the page uses out loud. */
function dueHint(iso: string): string {
    const day = 86_400_000;
    const days = Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${todayISO()}T00:00:00`)) / day);
    if (days === 0) return "today";
    if (days === 1) return "tomorrow";
    if (days === -1) return "1 day late";
    if (days < 0) return `${-days} days late`;
    if (days < 14) return `in ${days} days`;
    return `in ${Math.round(days / 7)} weeks`;
}

/**
 * The one number worth putting on a section heading, when it can be stated
 * honestly: what the live items in it commit you to. Mixed currencies get no
 * figure rather than a wrong one — adding NGN to USD would be a lie the page
 * has no exchange rate to tell.
 */
function groupFigure(key: GroupKey, items: ScheduledTransaction[]): string | null {
    const live = items.filter((s) => s.active);
    if (!live.length) return null;
    const currency = live[0].currency;
    if (live.some((s) => s.currency !== currency)) return null;

    if (key === "recurring") {
        const net = live.reduce((total, s) => {
            const per = PER_MONTH[s.recurrence ?? "monthly"];
            return total + (s.kind === "income" ? 1 : -1) * Number(s.amount) * per;
        }, 0);
        const sign = net >= 0 ? "+" : "−";
        return `${sign}${fmtMoney(Math.abs(net), currency)}/mo`;
    }

    const total = live.reduce((sum, s) => sum + Number(s.amount), 0);
    return fmtMoney(total, currency);
}

/* -------------------------------------------------------------------------- */
/*  What the dialog holds                                                      */
/* -------------------------------------------------------------------------- */

interface Draft {
    /** null while creating. */
    id: string | null;
    name: string;
    kind: "income" | "expense";
    scheduleKind: "recurring" | "one_off";
    recurrence: Recurrence;
    amount: string;
    currency: string;
    accountId: string;
    categoryId: string;
    payee: string;
    memo: string;
    nextDue: string;
    /** false = it waits for you to post it, however overdue it gets. */
    autoPost: boolean;
}

/** A blank draft already filed into the section the user pressed "add" on. */
function emptyDraft(group: GroupKey): Draft {
    return {
        id: null,
        name: "",
        kind: group === "payable" ? "expense" : "income",
        scheduleKind: group === "recurring" ? "recurring" : "one_off",
        recurrence: "monthly",
        amount: "",
        currency: DEFAULT_CURRENCY,
        accountId: "",
        categoryId: "",
        payee: "",
        memo: "",
        nextDue: todayISO(),
        autoPost: true,
    };
}

function draftOf(s: ScheduledTransaction): Draft {
    return {
        id: s.id,
        // `kind` also covers transfers and adjustments, which this page cannot
        // create; anything that isn't income is money leaving.
        kind: s.kind === "income" ? "income" : "expense",
        name: s.name,
        scheduleKind: s.schedule_kind,
        recurrence: s.recurrence ?? "monthly",
        amount: String(s.amount),
        currency: s.currency,
        accountId: s.account_id ?? "",
        categoryId: s.category_id ?? "",
        payee: s.payee ?? "",
        memo: s.memo ?? "",
        nextDue: s.next_due,
        autoPost: s.auto_post,
    };
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Scheduled() {
    const qc = useQueryClient();
    const confirm = useConfirm();

    const scheduled = useScheduled();
    const accounts = useAccounts();
    const categoryById = useCategoryById();

    const [group, setGroup] = useState<GroupKey | "">("");
    const [dueOnly, setDueOnly] = useState(false);
    const [query, setQuery] = useState("");
    const [draft, setDraft] = useState<Draft | null>(null);

    const accountName = useMemo(
        () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
        [accounts.data],
    );

    function invalidate() {
        qc.invalidateQueries({ queryKey: QK.scheduled });
        qc.invalidateQueries({ queryKey: QK.pendingReview });
    }

    /* --- Writes ----------------------------------------------------------- */

    // "Check now" — posts everything already due into the inbox.
    const runNow = useMutation({
        mutationFn: async () => {
            const { data, error } = await requireSupabase().rpc("run_my_scheduled");
            if (error) throw new Error(error.message);
            return data as number;
        },
        onSuccess: invalidate,
    });

    const postNow = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase().rpc("post_scheduled_now", { p_id: id });
            if (error) throw new Error(error.message);
        },
        onSuccess: invalidate,
    });

    // Move a cadence past one occurrence without posting it — "no rent this
    // month" without having to pause the schedule and remember to resume it.
    const skip = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase().rpc("skip_scheduled_occurrence", {
                p_id: id,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.scheduled }),
    });

    const toggle = useMutation({
        mutationFn: async (args: { id: string; active: boolean }) => {
            const { error } = await requireSupabase()
                .from("scheduled_transactions")
                .update({ active: args.active })
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.scheduled }),
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase()
                .from("scheduled_transactions")
                .delete()
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.scheduled }),
    });

    /* Deleting a schedule is not the same as stopping it, and stopping it is
       nearly always what someone means — so pausing is offered as the primary
       answer and the permanent one has to be chosen past it. */
    function confirmDelete(s: ScheduledTransaction, after?: () => void) {
        confirm({
            title: `Delete "${s.name}"?`,
            body: "The schedule goes for good. Anything it has already posted into your inbox or ledger stays where it is.",
            confirmLabel: "Delete permanently",
            danger: true,
            alternative: s.active
                ? {
                      label: "Pause instead",
                      hint: "Pausing keeps the schedule and stops it posting.",
                      onSelect: () => {
                          toggle.mutate({ id: s.id, active: false });
                          after?.();
                      },
                  }
                : undefined,
            onConfirm: () => {
                remove.mutate(s.id);
                after?.();
            },
        });
    }

    /* --- Derived ---------------------------------------------------------- */

    const all = useMemo(() => scheduled.data ?? [], [scheduled.data]);
    const dueCount = all.filter(isDue).length;
    // Items that will never post themselves. If any of them are due, "check for
    // due items" cannot clear the whole list and the page has to say so.
    const waitingCount = all.filter((s) => isDue(s) && !s.auto_post).length;

    const needle = query.trim().toLowerCase();
    const narrowed = useMemo(
        () =>
            all.filter((s) => {
                if (dueOnly && !isDue(s)) return false;
                if (!needle) return true;
                const category = s.category_id ? categoryById.get(s.category_id)?.name : "";
                return `${s.name} ${s.payee ?? ""} ${s.memo ?? ""} ${category ?? ""} ${flavour(s)}`
                    .toLowerCase()
                    .includes(needle);
            }),
        [all, dueOnly, needle, categoryById],
    );

    const sections = useMemo(
        () =>
            GROUPS.filter((g) => !group || g.key === group).map((g) => ({
                ...g,
                items: narrowed
                    .filter((s) => groupOf(s) === g.key)
                    .sort((a, b) => a.next_due.localeCompare(b.next_due) || a.name.localeCompare(b.name)),
                figure: groupFigure(
                    g.key,
                    all.filter((s) => groupOf(s) === g.key),
                ),
            })),
        [narrowed, all, group],
    );

    // While something is narrowing the page, an empty section is noise; at rest
    // it is an invitation, so it keeps its heading and its "add one" row.
    const narrowing = dueOnly || needle.length > 0;
    const visible = narrowing ? sections.filter((s) => s.items.length > 0) : sections;
    const nothingMatched = narrowing && visible.length === 0;

    const busy = postNow.isPending || skip.isPending || toggle.isPending || remove.isPending;
    const posted = runNow.data ?? 0;

    return (
        <>
            <PageHeader
                title="Scheduled"
                subtitle={
                    dueCount > 0 ? (
                        <>
                            <span className="font-semibold text-amber-400">
                                {dueCount} due now
                            </span>
                            {waitingCount > 0
                                ? ` — ${waitingCount} of them waiting for you to post.`
                                : " — check them off below."}
                        </>
                    ) : (
                        "Money you expect to move. On its date each one drops into your inbox to confirm — nothing is due right now."
                    )
                }
            >
                <button
                    className="sb-btn sb-btn-soft"
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate()}
                >
                    {runNow.isPending ? "Checking…" : "Check for due items"}
                </button>
                <button
                    className="sb-btn sb-btn-primary"
                    onClick={() => setDraft(emptyDraft(group || "recurring"))}
                >
                    <PlusIcon size={15} />
                    New scheduled item
                </button>
            </PageHeader>

            {runNow.isSuccess && (
                <div className="flex flex-wrap items-center gap-x-2 rounded-xl bg-tint-green px-3.5 py-2.5 text-[0.78125rem] font-semibold text-emerald-400">
                    {posted > 0 ? (
                        <>
                            <span>
                                Posted {posted} item{posted === 1 ? "" : "s"} to your inbox.
                            </span>
                            <Link to="/inbox" className="underline underline-offset-2">
                                Review them →
                            </Link>
                        </>
                    ) : (
                        <span>Nothing was due to post automatically.</span>
                    )}
                </div>
            )}

            <QueryError
                error={
                    scheduled.error ??
                    runNow.error ??
                    postNow.error ??
                    skip.error ??
                    toggle.error ??
                    remove.error
                }
            />

            {/* Filter row — sections, then the one state worth isolating.
                Nothing to filter on an empty page, so it stays away until the
                first item exists. */}
            <div
                className={`flex-wrap items-center gap-2 ${
                    all.length > 0 ? "flex" : "hidden"
                }`}
            >
                <FilterPill active={!group} onClick={() => setGroup("")}>
                    All
                </FilterPill>
                {GROUPS.map((g) => (
                    <FilterPill
                        key={g.key}
                        active={group === g.key}
                        onClick={() => setGroup(group === g.key ? "" : g.key)}
                    >
                        {g.label}
                    </FilterPill>
                ))}
                {dueCount > 0 && (
                    <>
                        <span aria-hidden className="mx-1 h-5 w-px bg-slate-700" />
                        <FilterPill active={dueOnly} onClick={() => setDueOnly(!dueOnly)}>
                            Due now{" "}
                            <span className={dueOnly ? "" : "font-bold text-amber-400"}>
                                {dueCount}
                            </span>
                        </FilterPill>
                    </>
                )}
                <Input
                    compact
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name, payee, memo…"
                    aria-label="Search scheduled items"
                    className="w-full sm:ml-auto sm:w-56"
                />
            </div>

            {scheduled.isLoading && <SkeletonList />}

            {!scheduled.isLoading && all.length === 0 && (
                <DashedCard className="text-center">
                    <h2 className="text-[0.9375rem] font-bold text-slate-200">
                        Nothing scheduled yet
                    </h2>
                    <p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] text-slate-400">
                        Add a salary, a bill that repeats, or a one-off you owe. Each one drops
                        into your inbox on its date so you only ever confirm it.
                    </p>
                    <button
                        className="sb-btn sb-btn-primary mt-4"
                        onClick={() => setDraft(emptyDraft("recurring"))}
                    >
                        <PlusIcon size={15} />
                        New scheduled item
                    </button>
                </DashedCard>
            )}

            {nothingMatched && (
                <div className="sb-card p-6 text-center">
                    <p className="text-[0.84375rem] text-slate-400">
                        Nothing scheduled matches that.
                    </p>
                    <button
                        className="sb-btn sb-btn-ghost mt-3"
                        onClick={() => {
                            setDueOnly(false);
                            setQuery("");
                        }}
                    >
                        Clear filters
                    </button>
                </div>
            )}

            {!scheduled.isLoading &&
                all.length > 0 &&
                visible.map((section) => (
                    <section key={section.key} className="flex flex-col gap-2.5">
                        <div className="flex items-center gap-2 px-1">
                            <LegendDot color={section.color} />
                            <h2 className="text-[0.8125rem] font-bold text-slate-200">
                                {section.label}
                            </h2>
                            <span className="text-xs text-slate-500 tnum">
                                {section.items.length}
                            </span>
                            {/* A standing fact about the section, not about the
                                filtered subset — so it steps aside rather than
                                sitting next to a count it doesn't match. */}
                            {section.figure && !narrowing && (
                                <span
                                    className="ml-auto shrink-0 text-xs font-semibold text-slate-500 tnum"
                                    title={
                                        section.key === "recurring"
                                            ? "Net of the live recurring items, averaged per month"
                                            : "Total across the live items here"
                                    }
                                >
                                    {section.figure}
                                </span>
                            )}
                        </div>

                        {section.items.map((s) => (
                            <ScheduledCard
                                key={s.id}
                                item={s}
                                accountLabel={
                                    (s.account_id && accountName.get(s.account_id)) || "—"
                                }
                                categoryLabel={
                                    s.category_id
                                        ? (categoryById.get(s.category_id)?.name ?? null)
                                        : null
                                }
                                busy={busy}
                                onEdit={() => setDraft(draftOf(s))}
                                onPost={() => postNow.mutate(s.id)}
                                onSkip={() => skip.mutate(s.id)}
                                onToggle={() => toggle.mutate({ id: s.id, active: !s.active })}
                                onDelete={() => confirmDelete(s)}
                            />
                        ))}

                        {!narrowing && (
                            <button
                                onClick={() => setDraft(emptyDraft(section.key))}
                                className="rounded-2xl border-[1.5px] border-dashed border-slate-700 px-4 py-3 text-center text-[0.78125rem] font-semibold text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-300"
                            >
                                {section.addLabel}
                                {/* An empty section has to say what belongs in
                                    it; a full one has four examples above. */}
                                {section.items.length === 0 && (
                                    <span className="mt-1 block text-xs font-normal text-slate-500">
                                        {section.blurb}
                                    </span>
                                )}
                            </button>
                        )}
                    </section>
                ))}

            <ScheduledDialog
                draft={draft}
                onClose={() => setDraft(null)}
                onDelete={() => {
                    const item = all.find((s) => s.id === draft?.id);
                    if (item) confirmDelete(item, () => setDraft(null));
                }}
            />
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  One scheduled item                                                         */
/* -------------------------------------------------------------------------- */

function ScheduledCard({
    item,
    accountLabel,
    categoryLabel,
    busy,
    onEdit,
    onPost,
    onSkip,
    onToggle,
    onDelete,
}: {
    item: ScheduledTransaction;
    accountLabel: string;
    categoryLabel: string | null;
    busy: boolean;
    onEdit: () => void;
    onPost: () => void;
    onSkip: () => void;
    onToggle: () => void;
    onDelete: () => void;
}) {
    const due = isDue(item);
    const income = item.kind === "income";
    const meta = [flavour(item), item.payee, categoryLabel].filter(Boolean).join(" · ");

    return (
        <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border p-3 transition-colors sm:gap-x-4 sm:px-4 ${
                due
                    ? "border-amber-400/45 bg-tint-amber"
                    : "border-slate-700 bg-slate-900 hover:border-slate-600"
            } ${item.active ? "" : "opacity-60"}`}
        >
            {/* The whole identity block is the way in to editing — one big
                target rather than a pencil the size of a thumbnail. */}
            <button
                onClick={onEdit}
                title={`Edit ${item.name}`}
                className="flex min-w-0 flex-1 basis-48 items-center gap-3 text-left"
            >
                <span
                    aria-hidden
                    className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] ${
                        income ? "bg-tint-green text-emerald-400" : "bg-tint-coral text-rose-400"
                    }`}
                >
                    {income ? <ArrowDownIcon size={16} /> : <ArrowUpIcon size={16} />}
                </span>

                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="truncate text-[0.84375rem] font-bold text-slate-100">
                            {item.name}
                        </span>
                        {due && <Pill tint="amber">due</Pill>}
                        {!item.active && <Pill>paused</Pill>}
                        {item.active && !item.auto_post && <Pill tint="blue">ask first</Pill>}
                    </span>
                    {/* Below md the date has no column of its own, so it leads
                        the line — truncation should eat the flavour, never the
                        one fact the page exists to tell you. */}
                    <span className="mt-0.5 flex items-baseline gap-1 text-xs text-slate-500">
                        <span className="shrink-0 md:hidden">
                            {fmtDateShort(item.next_due)} ·
                        </span>
                        <span className="truncate">{meta}</span>
                    </span>
                </span>
            </button>

            <div className="hidden w-[6.5rem] shrink-0 md:block">
                <div
                    className={`text-[0.78125rem] tnum ${
                        due ? "font-bold text-amber-400" : "font-semibold text-slate-300"
                    }`}
                >
                    {fmtDateShort(item.next_due)}
                </div>
                <div className="text-[0.6875rem] text-slate-500">
                    {item.active ? dueHint(item.next_due) : "paused"}
                </div>
            </div>

            <div className="hidden w-[8.5rem] shrink-0 truncate text-[0.78125rem] text-slate-400 xl:block">
                {accountLabel}
            </div>

            <div
                className={`shrink-0 whitespace-nowrap text-right text-[0.84375rem] font-bold tnum ${
                    income ? "text-emerald-400" : "text-slate-100"
                }`}
            >
                {income ? "+" : "−"}
                {fmtMoney(Number(item.amount), item.currency)}
            </div>

            {/* Always drawn, never revealed on hover: on a phone there is no
                hover, and a verb you can only find by pressing isn't a verb.
                It takes a line of its own on a narrow card rather than squeezing
                the name down to a few characters. */}
            <div className="flex w-full shrink-0 items-center justify-end gap-1 sm:w-auto">
                {due && item.active && (
                    <CardAction label="Post to inbox now" disabled={busy} onClick={onPost}>
                        <SendIcon size={13} />
                    </CardAction>
                )}
                {item.schedule_kind === "recurring" && (
                    <CardAction
                        label={`Skip this one — move to the next ${
                            item.recurrence ? RECURRENCE_LABEL[item.recurrence] : ""
                        } date`}
                        disabled={busy}
                        onClick={onSkip}
                    >
                        <SkipIcon size={13} />
                    </CardAction>
                )}
                <CardAction
                    label={item.active ? "Pause" : "Resume"}
                    disabled={busy}
                    onClick={onToggle}
                >
                    {item.active ? <PauseIcon size={13} /> : <PlayIcon size={13} />}
                </CardAction>
                <CardAction label="Delete…" disabled={busy} danger onClick={onDelete}>
                    <TrashIcon size={13} />
                </CardAction>
            </div>
        </div>
    );
}

function CardAction({
    label,
    danger = false,
    disabled,
    onClick,
    children,
}: {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={`grid h-7 w-7 place-items-center rounded-lg bg-chip text-slate-400 transition-colors disabled:opacity-40 ${
                danger ? "hover:bg-rose-400/15 hover:text-rose-400" : "hover:bg-slate-800 hover:text-slate-200"
            }`}
        >
            {children}
        </button>
    );
}

function SkeletonList() {
    return (
        <div className="flex flex-col gap-2.5">
            {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 rounded-2xl border border-slate-700 p-3.5">
                    <div className="sb-skeleton h-[34px] w-[34px] rounded-[10px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="sb-skeleton h-3 w-40 max-w-[60%]" />
                        <div className="sb-skeleton h-2.5 w-56 max-w-[80%]" />
                    </div>
                    <div className="sb-skeleton h-3 w-20" />
                </div>
            ))}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Create / edit dialog                                                       */
/* -------------------------------------------------------------------------- */

function ScheduledDialog({
    draft,
    onClose,
    onDelete,
}: {
    draft: Draft | null;
    onClose: () => void;
    onDelete: () => void;
}) {
    return (
        <Modal
            // Remounted per item, so the form never opens holding the last
            // one's half-typed amount.
            key={draft?.id ?? "new"}
            open={draft !== null}
            onClose={onClose}
            title={draft?.id ? "Edit scheduled item" : "New scheduled item"}
            subtitle="It posts into your inbox on its date — you confirm it actually happened."
            width="30rem"
        >
            {draft && <DialogBody initial={draft} onClose={onClose} onDelete={onDelete} />}
        </Modal>
    );
}

function DialogBody({
    initial,
    onClose,
    onDelete,
}: {
    initial: Draft;
    onClose: () => void;
    onDelete: () => void;
}) {
    const qc = useQueryClient();
    const accountOpts = useAccountOptions({ showCurrency: true });
    const categoryOpts = useCategoryOptions();

    const [form, setForm] = useState<Draft>(initial);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setForm((f) => ({ ...f, [key]: value }));

    const save = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            const row = {
                name: form.name.trim(),
                kind: form.kind,
                schedule_kind: form.scheduleKind,
                // A one-off has no cadence; leaving a stale one behind would
                // make the row lie about itself.
                recurrence: form.scheduleKind === "recurring" ? form.recurrence : null,
                amount: Number(form.amount),
                currency: form.currency.trim().toUpperCase(),
                account_id: form.accountId || null,
                category_id: form.categoryId || null,
                payee: form.payee.trim() || null,
                memo: form.memo.trim() || null,
                next_due: form.nextDue,
                auto_post: form.autoPost,
            };
            if (form.id) {
                const { error } = await sb
                    .from("scheduled_transactions")
                    .update(row)
                    .eq("id", form.id);
                if (error) throw new Error(error.message);
                return;
            }
            const { data: u } = await sb.auth.getUser();
            if (!u.user) throw new Error("not signed in");
            const { error } = await sb
                .from("scheduled_transactions")
                .insert({ ...row, user_id: u.user.id });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: QK.scheduled });
            onClose();
        },
    });

    const valid = form.name.trim().length > 0 && Number(form.amount) > 0;

    function submit(e: FormEvent) {
        e.preventDefault();
        if (valid) save.mutate();
    }

    const oneOffHint =
        form.kind === "income" ? "someone will pay you" : "you owe someone";

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
                <span className="sb-eyebrow">Name</span>
                <Input
                    autoFocus
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Monthly salary"
                    required
                />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Direction</span>
                    <Segmented
                        options={DIRECTION_OPTIONS}
                        value={form.kind}
                        onChange={(v) => set("kind", v)}
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Schedule</span>
                    <Segmented
                        options={SCHEDULE_OPTIONS}
                        value={form.scheduleKind}
                        onChange={(v) => set("scheduleKind", v)}
                    />
                    {form.scheduleKind === "one_off" && (
                        <span className="text-xs text-slate-500">Fires once — {oneOffHint}.</span>
                    )}
                </div>
            </div>

            {form.scheduleKind === "recurring" && (
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">How often</span>
                    <Picker
                        options={RECURRENCE_OPTIONS}
                        value={form.recurrence}
                        onChange={(v) => set("recurrence", v)}
                        title="How often"
                        aria-label="How often"
                    />
                </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Amount</span>
                    <div className="flex gap-2">
                        <Input
                            className="min-w-0 flex-1"
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0.00"
                            value={form.amount}
                            onChange={(e) => set("amount", e.target.value)}
                            aria-label="Amount"
                            required
                        />
                        <Input
                            className="w-[4.5rem]"
                            value={form.currency}
                            maxLength={3}
                            onChange={(e) => set("currency", e.target.value.toUpperCase())}
                            aria-label="Currency"
                            required
                        />
                    </div>
                </div>
                <label className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">
                        {form.scheduleKind === "recurring" ? "First / next date" : "Due date"}
                    </span>
                    <Input
                        type="date"
                        value={form.nextDue}
                        onChange={(e) => set("nextDue", e.target.value)}
                        required
                    />
                </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Account</span>
                    <Picker
                        options={accountOpts}
                        value={form.accountId}
                        onChange={(v) => set("accountId", v)}
                        placeholder="— no account —"
                        title="Account"
                        aria-label="Account"
                        clearable
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Category</span>
                    <Picker
                        options={categoryOpts}
                        value={form.categoryId}
                        onChange={(v) => set("categoryId", v)}
                        placeholder="— no category —"
                        title="Category"
                        aria-label="Category"
                        clearable
                    />
                </div>
            </div>

            <label className="flex flex-col gap-1.5">
                <span className="sb-eyebrow">Payee / counterparty</span>
                <Input
                    value={form.payee}
                    onChange={(e) => set("payee", e.target.value)}
                    placeholder="Acme Ltd (optional)"
                />
            </label>

            <label className="flex flex-col gap-1.5">
                <span className="sb-eyebrow">Memo</span>
                <Input
                    value={form.memo}
                    onChange={(e) => set("memo", e.target.value)}
                    placeholder="Rides along onto every posting (optional)"
                />
            </label>

            {/* `auto_post` already gated the nightly job; nothing in the app had
                ever shown it, so an item could quietly never post and look
                identical to one that would. */}
            <div className="flex flex-col gap-1.5">
                <span className="sb-eyebrow">When it comes due</span>
                <Segmented
                    options={POSTING_OPTIONS}
                    value={form.autoPost ? "auto" : "manual"}
                    onChange={(v) => set("autoPost", v === "auto")}
                />
                <span className="text-xs text-slate-500">
                    {form.autoPost
                        ? "Sagebook drops it into your inbox on its date, for you to confirm."
                        : "It sits here marked due until you post it yourself."}
                </span>
            </div>

            <QueryError error={save.error} />

            <div className="flex flex-wrap items-center gap-2 pt-1">
                {form.id && (
                    <button type="button" className="sb-btn sb-btn-danger" onClick={onDelete}>
                        Delete
                    </button>
                )}
                <button
                    type="submit"
                    className="sb-btn sb-btn-primary ml-auto"
                    disabled={save.isPending || !valid}
                >
                    {save.isPending ? "Saving…" : form.id ? "Save" : "Add scheduled item"}
                </button>
                <button type="button" className="sb-btn sb-btn-ghost" onClick={onClose}>
                    Cancel
                </button>
            </div>
        </form>
    );
}
