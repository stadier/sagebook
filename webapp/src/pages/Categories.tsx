/* Categories — the grouped board (concept 1c).

   The page used to be a grid of plain lists: a category was a line of text with
   a Rename and a Delete, and nothing on screen said what any of it was worth.
   The design turns the taxonomy into a board — one column per group, a card per
   category carrying its subcategory count, its rules and this month's figure,
   and a right-hand rail holding the three things you actually do here: file the
   unfiled, look inside a category, and check what the rules are doing.

   Cards drag between columns to change a category's group. Dragging is a
   shortcut, never the only way: the same move is a field in the edit dialog, so
   the board stays workable from a keyboard and on a phone. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type BoardDrag, DropSlot, useBoardDrag } from "../components/BoardDrag";
import { usePalette } from "../components/CommandPalette";
import { useConfirm } from "../components/Confirm";
import { EditIcon, PlusIcon } from "../components/icons";
import {
    Card,
    CardHeader,
    DarkPanel,
    Empty,
    Input,
    LegendDot,
    Modal,
    PageHeader,
    Picker,
    QueryError,
    SectionLabel,
} from "../components/ui";
import { DEFAULT_CURRENCY } from "../lib/constants";
import { fmtDate, fmtMoney } from "../lib/format";
import type { Option } from "../lib/options";
import {
    currentBudget,
    QK,
    useBudgetProgress,
    useBudgets,
    useCategoryById,
    useCategoryOptions,
    useCategorySummary,
    useRules,
    useTaxonomy,
    useUncategorized,
} from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import { CATEGORY_COLORS, seriesColor, tintStyle } from "../lib/theme";
import type { GroupWithCategories } from "../lib/taxonomy";
import type { Category } from "../lib/types";

/** The synthetic group `fetchTaxonomy` appends for categories with no group. */
const UNGROUPED = "__ungrouped__";

/** Rules listed in the rail before it defers to the full table. */
const RULE_PREVIEW = 3;

/* -------------------------------------------------------------------------- */
/*  Derived shapes                                                             */
/* -------------------------------------------------------------------------- */

/** One card on the board: a category plus everything drawn on it. */
interface BoardCard {
    category: Category;
    children: Category[];
    ruleCount: number;
    /** This month's accepted total for the category and its children. */
    spent: number;
    /** The current budget's cap for it, or null when it isn't budgeted. */
    planned: number | null;
}

/** What the edit dialog is holding. `id: null` means it is creating. */
interface Draft {
    id: string | null;
    name: string;
    /** "" is Ungrouped — a real choice, not an empty field. */
    groupId: string;
    /** "" is top level. */
    parentId: string;
    icon: string;
    color: string;
}

function emptyDraft(groupId: string, parentId = ""): Draft {
    return { id: null, name: "", groupId, parentId, icon: "", color: "" };
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Categories() {
    const taxonomy = useTaxonomy();
    const rules = useRules();
    const summary = useCategorySummary();
    const budgets = useBudgets();
    const budget = currentBudget(budgets.data);
    const progress = useBudgetProgress(budget?.id);

    const [draft, setDraft] = useState<Draft | null>(null);
    const [focusId, setFocusId] = useState<string | null>(null);

    const groups = useMemo(() => taxonomy.data ?? [], [taxonomy.data]);
    const currency = summary.data?.[0]?.currency ?? budget?.currency ?? DEFAULT_CURRENCY;

    /* This month's figure per category. `v_category_summary` reports by name
       rather than by id, so that is what the lookup is keyed on. */
    const spentByName = useMemo(() => {
        const map = new Map<string, number>();
        for (const row of summary.data ?? []) {
            const key = row.category.toLowerCase();
            map.set(key, (map.get(key) ?? 0) + Number(row.total_amount));
        }
        return map;
    }, [summary.data]);

    const plannedById = useMemo(() => {
        const map = new Map<string, number>();
        for (const line of progress.data ?? []) {
            if (line.category_id) map.set(line.category_id, Number(line.planned_amount));
        }
        return map;
    }, [progress.data]);

    const ruleCountById = useMemo(() => {
        const map = new Map<string, number>();
        for (const rule of rules.data ?? []) {
            if (rule.set_category_id) {
                map.set(rule.set_category_id, (map.get(rule.set_category_id) ?? 0) + 1);
            }
        }
        return map;
    }, [rules.data]);

    /* A column's cards: the group's top-level categories, each carrying the
       children that sit under it. A child whose parent was filed in a different
       group has no parent to nest under here, so it earns a card of its own. */
    const columns = useMemo(
        () =>
            groups.map((group) => {
                const present = new Set(group.categories.map((c) => c.id));
                const cards: BoardCard[] = group.categories
                    .filter((c) => !c.parent_id || !present.has(c.parent_id))
                    .map((category) => {
                        const children = group.categories.filter(
                            (c) => c.parent_id === category.id,
                        );
                        const spent = [category, ...children].reduce(
                            (total, c) => total + (spentByName.get(c.name.toLowerCase()) ?? 0),
                            0,
                        );
                        return {
                            category,
                            children,
                            ruleCount: ruleCountById.get(category.id) ?? 0,
                            spent,
                            planned: plannedById.get(category.id) ?? null,
                        };
                    });
                return { group, cards, spent: cards.reduce((t, c) => t + c.spent, 0) };
            }),
        [groups, spentByName, plannedById, ruleCountById],
    );

    const allCards = useMemo(() => columns.flatMap((c) => c.cards), [columns]);
    const focused = allCards.find((c) => c.category.id === focusId) ?? allCards[0];

    const groupOptions: Option[] = useMemo(
        () =>
            groups
                .filter((g) => g.id !== UNGROUPED)
                .map((g) => ({
                    value: g.id,
                    label: g.name,
                    color: g.color,
                })),
        [groups],
    );

    /* Only top-level categories can be a parent — the taxonomy is two deep, and
       a category cannot be filed under itself. */
    const parentOptions: Option[] = useMemo(
        () =>
            allCards
                .filter((c) => !c.category.parent_id && c.category.id !== draft?.id)
                .map((c) => ({
                    value: c.category.id,
                    label: c.category.name,
                    color: c.category.color,
                })),
        [allCards, draft?.id],
    );

    const move = useMoveCategory();

    /* The drag engine only needs to know what is in each lane, and in what
       order — it reads everything else off the cards' own boxes. */
    const dragColumns = useMemo(
        () =>
            columns.map(({ group, cards }) => ({
                id: group.id,
                itemIds: cards.map((c) => c.category.id),
            })),
        [columns],
    );

    const board = useBoardDrag({
        columns: dragColumns,
        onDrop: ({ id, to }) => move.mutate({ id, ...to }),
    });

    const cardById = useMemo(
        () => new Map(allCards.map((c) => [c.category.id, c])),
        [allCards],
    );

    if (taxonomy.isError) return <QueryError error={taxonomy.error} />;

    return (
        <>
            <PageHeader
                title="Categories"
                subtitle="Your taxonomy, and what each bucket is worth this month. Extraction files new captures into these — land receipts land under Real Estate Investment."
            >
                <Link to="/settings/rules" className="sb-btn sb-btn-soft">
                    Manage rules
                </Link>
                <button
                    className="sb-btn sb-btn-primary"
                    onClick={() => setDraft(emptyDraft(groups[0]?.id === UNGROUPED ? "" : groups[0]?.id ?? ""))}
                >
                    <PlusIcon size={15} />
                    New category
                </button>
            </PageHeader>

            <QueryError error={move.error} />

            {taxonomy.isLoading && <Empty loading>Loading…</Empty>}

            {!taxonomy.isLoading && columns.length === 0 && (
                <Card>
                    <Empty>
                        No categories yet — the first one you add starts the taxonomy off.
                    </Empty>
                </Card>
            )}

            <div className="grid items-start gap-[18px] xl:grid-cols-[minmax(0,1fr)_18.75rem]">
                <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {columns.map(({ group, cards, spent }) => (
                        <GroupColumn
                            key={group.id}
                            group={group}
                            cards={cards}
                            spent={spent}
                            currency={currency}
                            focusId={focused?.category.id ?? null}
                            board={board}
                            onFocus={setFocusId}
                            onEdit={(card) =>
                                setDraft({
                                    id: card.category.id,
                                    name: card.category.name,
                                    groupId: card.category.group_id ?? "",
                                    parentId: card.category.parent_id ?? "",
                                    icon: card.category.icon ?? "",
                                    color: card.category.color ?? "",
                                })
                            }
                            onAdd={() => setDraft(emptyDraft(group.id === UNGROUPED ? "" : group.id))}
                        />
                    ))}
                </div>

                <div className="flex flex-col gap-3.5">
                    <UncategorizedPanel currency={currency} />
                    <FocusCard card={focused} currency={currency} spentByName={spentByName} />
                    <RulesCard />
                </div>
            </div>

            {/* The card in the air — the same component, so it cannot drift
                from the one it was lifted out of. */}
            {board.overlay((id) => {
                const card = cardById.get(id);
                return card ? <CategoryCard card={card} currency={currency} lifted /> : null;
            })}

            <CategoryDialog
                draft={draft}
                onClose={() => setDraft(null)}
                groupOptions={groupOptions}
                parentOptions={parentOptions}
                childrenOf={allCards.find((c) => c.category.id === draft?.id)?.children ?? []}
            />
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  Board                                                                      */
/* -------------------------------------------------------------------------- */

function GroupColumn({
    group,
    cards,
    spent,
    currency,
    focusId,
    board,
    onFocus,
    onEdit,
    onAdd,
}: {
    group: GroupWithCategories;
    cards: BoardCard[];
    spent: number;
    currency: string;
    focusId: string | null;
    board: BoardDrag;
    onFocus: (id: string) => void;
    onEdit: (card: BoardCard) => void;
    onAdd: () => void;
}) {
    const color = group.color ?? seriesColor(group.sort_order);
    // The lifted card leaves the list outright — the gap below is standing in
    // for it, and is genuinely where it will land.
    const present = cards.filter((c) => c.category.id !== board.draggingId);
    const slot = board.slotFor(group.id);

    return (
        <div
            ref={board.columnRef(group.id)}
            className={`flex flex-col gap-2.5 rounded-3xl border p-1 transition-colors ${
                slot !== null ? "border-dashed border-slate-700" : "border-transparent"
            }`}
        >
            <div className="flex items-center gap-2 px-2 pt-1">
                <LegendDot color={color} />
                <span className="min-w-0 truncate text-[0.8125rem] font-bold text-slate-200">
                    {group.icon && <span aria-hidden>{group.icon} </span>}
                    {group.name}
                </span>
                <span className="ml-auto shrink-0 text-xs text-slate-500 tnum">
                    {spent > 0 ? fmtMoney(spent, currency) : `${cards.length}`}
                </span>
            </div>

            {present.map((card, i) => (
                <Fragment key={card.category.id}>
                    {slot === i && <DropSlot height={board.height} />}
                    <CategoryCard
                        card={card}
                        currency={currency}
                        focused={card.category.id === focusId}
                        onFocus={() => onFocus(card.category.id)}
                        onEdit={() => onEdit(card)}
                        innerRef={board.itemRef(card.category.id)}
                        onPointerDown={(e) => board.press(e, card.category.id, group.id)}
                    />
                </Fragment>
            ))}
            {slot === present.length && <DropSlot height={board.height} />}

            <button
                onClick={onAdd}
                className="rounded-2xl border-[1.5px] border-dashed border-slate-700 px-4 py-3.5 text-center text-[0.78125rem] font-semibold text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-300"
            >
                + Add to {group.name}
            </button>
        </div>
    );
}

function CategoryCard({
    card,
    currency,
    focused = false,
    lifted = false,
    onFocus,
    onEdit,
    innerRef,
    onPointerDown,
}: {
    card: BoardCard;
    currency: string;
    focused?: boolean;
    /** Drawn in the drag layer: no handles, no hover, just the card. */
    lifted?: boolean;
    onFocus?: () => void;
    onEdit?: () => void;
    innerRef?: (el: HTMLElement | null) => void;
    onPointerDown?: (e: React.PointerEvent) => void;
}) {
    const { category, children, ruleCount, spent, planned } = card;
    const over = planned !== null && planned > 0 && spent > planned;

    const meta: string[] = [];
    if (planned !== null && planned > 0) {
        meta.push(`${fmtMoney(spent, currency)} of ${fmtMoney(planned, currency)}`);
    } else if (spent > 0) {
        meta.push(`${fmtMoney(spent, currency)} this month`);
    }
    if (children.length) meta.push(`${children.length} sub`);
    if (ruleCount) meta.push(`${ruleCount} rule${ruleCount === 1 ? "" : "s"}`);

    return (
        <div
            ref={innerRef}
            onPointerDown={onPointerDown}
            // A long press on touch is the pickup gesture, so the OS callout
            // that normally answers it has to stay out of the way.
            onContextMenu={(e) => onPointerDown && e.preventDefault()}
            className={`relative rounded-2xl border p-4 ${
                lifted ? "" : "cursor-grab touch-manipulation transition-colors"
            } ${
                over
                    ? "border-rose-900/70 bg-coral-soft"
                    : focused
                      ? "border-coral bg-slate-900"
                      : `border-slate-700 bg-slate-900 ${lifted ? "" : "hover:border-slate-600"}`
            }`}
        >
            <button
                onClick={onFocus}
                aria-pressed={focused}
                tabIndex={lifted ? -1 : undefined}
                className="flex w-full min-w-0 items-center gap-2.5 pr-6 text-left"
            >
                <span
                    aria-hidden
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-sm"
                    style={tintStyle(category.color, category.name)}
                >
                    {category.icon || category.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 truncate text-[0.84375rem] font-bold text-slate-100">
                    {category.name}
                </span>
            </button>

            {!lifted && (
                <button
                    onClick={onEdit}
                    aria-label={`Edit ${category.name}`}
                    className="absolute right-3 top-3 rounded-md p-1 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
                >
                    <EditIcon size={14} />
                </button>
            )}

            <div
                className={`mt-2 truncate text-xs tnum ${
                    over ? "font-bold text-rose-400" : "text-slate-500"
                }`}
            >
                {meta.length ? meta.join(" · ") : "Nothing filed here yet"}
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Rail                                                                       */
/* -------------------------------------------------------------------------- */

/** Accepted entries with no category, filed one tap at a time. */
function UncategorizedPanel({ currency }: { currency: string }) {
    const qc = useQueryClient();
    const palette = usePalette();
    const unfiled = useUncategorized();
    const options = useCategoryOptions();

    const assign = useMutation({
        mutationFn: async (args: { id: string; categoryId: string }) => {
            const { error } = await requireSupabase()
                .from("transactions")
                .update({ category_id: args.categoryId })
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: QK.uncategorized });
            qc.invalidateQueries({ queryKey: ["category-summary"] });
            qc.invalidateQueries({ queryKey: QK.recentTransactions });
        },
    });

    const rows = unfiled.data ?? [];

    return (
        <DarkPanel>
            <div className="sb-eyebrow mb-3">Uncategorized · {rows.length}</div>

            {rows.length === 0 ? (
                <p className="text-[0.78125rem] text-slate-400">
                    {unfiled.isLoading ? "Loading…" : "Everything accepted has a category."}
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {rows.map((txn) => (
                        <button
                            key={txn.id}
                            disabled={assign.isPending}
                            onClick={() =>
                                palette.open({
                                    title: "File under",
                                    subtitle: txn.payee ?? fmtDate(txn.occurred_at),
                                    options,
                                    onSelect: (categoryId) =>
                                        assign.mutate({ id: txn.id, categoryId }),
                                })
                            }
                            className="flex items-center justify-between gap-3 rounded-[11px] bg-white/[0.07] px-3 py-2.5 text-left transition-colors hover:bg-white/[0.13] disabled:opacity-50"
                        >
                            <span className="min-w-0 flex-1 truncate text-[0.78125rem] text-slate-200">
                                {txn.payee ?? "—"}
                            </span>
                            <span className="shrink-0 text-xs text-slate-400 tnum">
                                {fmtMoney(Number(txn.amount), txn.currency || currency)}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            <QueryError error={assign.error ?? unfiled.error} />

            <Link
                to="/transactions"
                className="mt-3 inline-block text-xs font-bold text-sky-300 hover:text-sky-200"
            >
                Open the ledger →
            </Link>
        </DarkPanel>
    );
}

/** What sits inside the category the board is focused on. */
function FocusCard({
    card,
    currency,
    spentByName,
}: {
    card: BoardCard | undefined;
    currency: string;
    spentByName: Map<string, number>;
}) {
    if (!card) return null;

    return (
        <Card>
            <SectionLabel>{card.category.name} · subcategories</SectionLabel>
            {card.children.length === 0 ? (
                <p className="text-xs text-slate-500">
                    No subcategories yet — add one from this category's edit dialog.
                </p>
            ) : (
                <div className="flex flex-col gap-2">
                    {card.children.map((child) => {
                        const spent = spentByName.get(child.name.toLowerCase()) ?? 0;
                        return (
                            <div
                                key={child.id}
                                className="flex items-center justify-between gap-3 text-[0.78125rem]"
                            >
                                <span className="min-w-0 truncate font-semibold text-slate-200">
                                    {child.icon && <span aria-hidden>{child.icon} </span>}
                                    {child.name}
                                </span>
                                <span className="shrink-0 text-slate-500 tnum">
                                    {spent > 0 ? fmtMoney(spent, currency) : "—"}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

/** What the rules are doing, without leaving the page to find out. */
function RulesCard() {
    const rules = useRules();
    const categoryById = useCategoryById();

    const active = (rules.data ?? []).filter((r) => r.active);

    return (
        <Card>
            <CardHeader title={`Active rules · ${active.length}`} />
            {active.length === 0 ? (
                <p className="text-xs text-slate-500">
                    Nothing is being filed automatically yet.
                </p>
            ) : (
                <div className="flex flex-col gap-2 text-xs text-slate-400">
                    {active.slice(0, RULE_PREVIEW).map((rule) => (
                        <div key={rule.id} className="truncate">
                            <span className="text-slate-300">"{rule.match_value}"</span> →{" "}
                            {rule.set_category_id
                                ? (categoryById.get(rule.set_category_id)?.name ?? "—")
                                : "tags only"}
                        </div>
                    ))}
                </div>
            )}
            <Link
                to="/settings/rules"
                className="mt-3 inline-block text-xs font-bold text-sky-300 hover:text-sky-200"
            >
                Manage all rules →
            </Link>
        </Card>
    );
}

/* -------------------------------------------------------------------------- */
/*  Edit dialog                                                                */
/* -------------------------------------------------------------------------- */

function CategoryDialog({
    draft,
    onClose,
    groupOptions,
    parentOptions,
    childrenOf,
}: {
    draft: Draft | null;
    onClose: () => void;
    groupOptions: Option[];
    parentOptions: Option[];
    childrenOf: Category[];
}) {
    return (
        <Modal
            // Remounted per category, so the form never opens holding the
            // previous one's half-typed name.
            key={draft?.id ?? "new"}
            open={draft !== null}
            onClose={onClose}
            title={draft?.id ? "Edit category" : "New category"}
            width="27.5rem"
        >
            {draft && (
                <DialogBody
                    initial={draft}
                    onClose={onClose}
                    groupOptions={groupOptions}
                    parentOptions={parentOptions}
                    childrenOf={childrenOf}
                />
            )}
        </Modal>
    );
}

function DialogBody({
    initial,
    onClose,
    groupOptions,
    parentOptions,
    childrenOf,
}: {
    initial: Draft;
    onClose: () => void;
    groupOptions: Option[];
    parentOptions: Option[];
    childrenOf: Category[];
}) {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [form, setForm] = useState<Draft>(initial);
    const [subName, setSubName] = useState("");

    // What a delete would actually cost, fetched while the dialog is open so
    // the confirmation can name a real number rather than a vague warning.
    const usage = useCategoryUsage([initial.id, ...childrenOf.map((c) => c.id)]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
        setForm((f) => ({ ...f, [key]: value }));

    const save = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            const row = {
                name: form.name.trim(),
                group_id: form.groupId || null,
                parent_id: form.parentId || null,
                icon: form.icon.trim() || null,
                color: form.color || null,
            };
            const { error } = form.id
                ? await sb.from("categories").update(row).eq("id", form.id)
                : await sb.from("categories").insert({ ...row, user_id: await userId(sb) });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: QK.taxonomy });
            onClose();
        },
    });

    const addSub = useMutation({
        mutationFn: async (name: string) => {
            const sb = requireSupabase();
            const { error } = await sb.from("categories").insert({
                user_id: await userId(sb),
                name,
                parent_id: form.id,
                group_id: form.groupId || null,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setSubName("");
            qc.invalidateQueries({ queryKey: QK.taxonomy });
        },
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase().from("categories").delete().eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.taxonomy }),
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (form.name.trim()) save.mutate();
    }

    /* A category has no archived state to fall back on, so there is no
       reversible alternative to offer — which makes saying exactly what is lost,
       and demanding the phrase when anything is, the whole of the safety net. */
    function confirmDelete(category: { id: string; name: string }, isChild: boolean) {
        // Undefined is not zero. A count that never arrived must not be read out
        // as "nothing is filed under it" — that is the one sentence that would
        // talk someone into a delete they can't undo.
        const filed = usage.data?.[category.id];
        confirm({
            title: `Delete "${category.name}"?`,
            body: (
                <>
                    {filed === undefined
                        ? "Sagebook couldn't check how many transactions are filed under it. Whatever is there keeps its amounts and payees but loses this label, and drops out of every report broken down by category. "
                        : filed > 0
                          ? `${filed} transaction${filed === 1 ? "" : "s"} filed under it keep their amounts and payees but lose this label, and drop out of every report broken down by category. `
                          : "Nothing is filed under it, so no transaction changes. "}
                    {!isChild && childrenOf.length > 0 && (
                        <>
                            Its {childrenOf.length} subcategor
                            {childrenOf.length === 1 ? "y survives" : "ies survive"} as top-level
                            categories.{" "}
                        </>
                    )}
                    Any rule pointing at it stops having an effect.
                </>
            ),
            confirmLabel: "Delete permanently",
            danger: true,
            requirePhrase: filed === undefined || filed > 0 ? "delete" : undefined,
            onConfirm: () =>
                remove.mutate(category.id, { onSuccess: isChild ? undefined : onClose }),
        });
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
                <span className="sb-eyebrow">Name</span>
                <Input
                    autoFocus
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Groceries"
                    required
                />
            </label>

            {/* A `<label>` cannot label a button, and both pickers render as
                one — hence the eyebrow plus an explicit `aria-label`. */}
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Group</span>
                    <Picker
                        options={groupOptions}
                        value={form.groupId}
                        onChange={(v) => set("groupId", v)}
                        placeholder="— ungrouped —"
                        title="Group"
                        aria-label="Group"
                        clearable
                    />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="sb-eyebrow">Sits under</span>
                    <Picker
                        options={parentOptions}
                        value={form.parentId}
                        onChange={(v) => set("parentId", v)}
                        placeholder="— top level —"
                        title="Parent category"
                        aria-label="Parent category"
                        clearable
                    />
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
                <label className="flex flex-col gap-1.5">
                    <span className="sb-eyebrow">Icon</span>
                    <Input
                        value={form.icon}
                        onChange={(e) => set("icon", e.target.value)}
                        placeholder="🛒"
                        maxLength={4}
                        aria-label="Icon, one emoji"
                    />
                </label>
                <div className="flex flex-col gap-1.5">
                    <span className="sb-eyebrow">Colour</span>
                    <div className="flex flex-wrap items-center gap-2 py-1.5">
                        {CATEGORY_COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                aria-label={`Use ${color}`}
                                aria-pressed={form.color === color}
                                onClick={() => set("color", color)}
                                style={{ backgroundColor: color }}
                                className={`h-[26px] w-[26px] rounded-lg border-2 transition-colors ${
                                    form.color === color ? "border-slate-200" : "border-transparent"
                                }`}
                            />
                        ))}
                        {form.color && (
                            <button
                                type="button"
                                onClick={() => set("color", "")}
                                className="text-xs font-semibold text-slate-500 hover:text-slate-300"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Subcategories are rows of their own, so they are created and
                deleted straight away rather than staged in this form. Only an
                existing category can hold them. */}
            {form.id && !form.parentId && (
                <div className="flex flex-col gap-2">
                    <span className="sb-eyebrow">Subcategories</span>
                    {childrenOf.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                            {childrenOf.map((child) => (
                                <span
                                    key={child.id}
                                    className="sb-pill"
                                    style={tintStyle(child.color, child.name)}
                                >
                                    {child.name}
                                    <button
                                        type="button"
                                        aria-label={`Delete ${child.name}`}
                                        disabled={remove.isPending}
                                        onClick={() => confirmDelete(child, true)}
                                        className="ml-0.5 opacity-70 hover:opacity-100"
                                    >
                                        ✕
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2">
                        <Input
                            compact
                            className="min-w-0 flex-1"
                            placeholder="Add a subcategory…"
                            value={subName}
                            onChange={(e) => setSubName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    // Enter here means "add this one", not
                                    // "submit the whole dialog".
                                    e.preventDefault();
                                    if (subName.trim()) addSub.mutate(subName.trim());
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="sb-btn sb-btn-ghost"
                            disabled={addSub.isPending || !subName.trim()}
                            onClick={() => addSub.mutate(subName.trim())}
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            <QueryError error={save.error ?? addSub.error ?? remove.error} />

            <div className="flex flex-wrap items-center gap-2 pt-1">
                {form.id && (
                    <button
                        type="button"
                        className="sb-btn sb-btn-danger"
                        disabled={remove.isPending}
                        onClick={() => confirmDelete({ id: form.id!, name: form.name }, false)}
                    >
                        Delete
                    </button>
                )}
                <button
                    type="submit"
                    className="sb-btn sb-btn-primary ml-auto"
                    disabled={save.isPending || !form.name.trim()}
                >
                    {save.isPending ? "Saving…" : "Save"}
                </button>
                <button type="button" className="sb-btn sb-btn-ghost" onClick={onClose}>
                    Cancel
                </button>
            </div>
        </form>
    );
}

/* -------------------------------------------------------------------------- */
/*  Mutations + helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How many transactions each of these categories holds. One head-count request
 * per id — a handful, only while the edit dialog is open — because PostgREST
 * has no grouped count and pulling the rows to tally them client-side would be
 * far more expensive on a real ledger.
 */
function useCategoryUsage(ids: Array<string | null>) {
    const present = ids.filter((id): id is string => !!id);
    return useQuery({
        queryKey: ["category-usage", ...present],
        enabled: present.length > 0,
        queryFn: async () => {
            const sb = requireSupabase();
            const counts = await Promise.all(
                present.map(async (id) => {
                    const { count, error } = await sb
                        .from("transactions")
                        .select("id", { count: "exact", head: true })
                        .eq("category_id", id);
                    if (error) throw new Error(error.message);
                    return [id, count ?? 0] as const;
                }),
            );
            return Object.fromEntries(counts) as Record<string, number>;
        },
    });
}

/**
 * The write behind a dropped card: which lane it now lives in, and where in
 * that lane. The cache is rearranged first and the request follows, because a
 * card that snapped back to its old slot for the length of a round trip would
 * undo the whole point of showing the gap.
 */
function useMoveCategory() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (args: { id: string; columnId: string; index: number }) => {
            const before = qc.getQueryData<GroupWithCategories[]>(QK.taxonomy) ?? [];
            const after = reorderTaxonomy(before, args);
            if (after === before) return;

            // Repaint first: a card that snapped back to its old slot for the
            // length of a round trip would undo the point of showing the gap.
            await qc.cancelQueries({ queryKey: QK.taxonomy });
            qc.setQueryData(QK.taxonomy, after);

            const wasById = new Map(before.flatMap((g) => g.categories).map((c) => [c.id, c]));
            /* Only rows that actually changed are written. A drop near the top
               of a long lane then costs a couple of requests, not one per card
               in the lane. */
            const writes = after
                .flatMap((g) => g.categories)
                .flatMap((now) => {
                    const was = wasById.get(now.id);
                    if (!was) return [];
                    const patch: { sort_order?: number; group_id?: string | null } = {};
                    if ((was.sort_order ?? 0) !== (now.sort_order ?? 0)) {
                        patch.sort_order = now.sort_order ?? 0;
                    }
                    if (was.group_id !== now.group_id) patch.group_id = now.group_id;
                    return Object.keys(patch).length ? [{ id: now.id, patch }] : [];
                });

            const sb = requireSupabase();
            try {
                const results = await Promise.all(
                    writes.map((w) => sb.from("categories").update(w.patch).eq("id", w.id)),
                );
                const failed = results.find((r) => r.error);
                if (failed?.error) throw new Error(failed.error.message);
            } catch (error) {
                // The board must never keep showing a move that did not happen.
                qc.setQueryData(QK.taxonomy, before);
                throw error;
            }
        },

        onSettled: () => qc.invalidateQueries({ queryKey: QK.taxonomy }),
    });
}

/** The taxonomy with one category moved to a lane and a position inside it. */
function reorderTaxonomy(
    groups: GroupWithCategories[],
    { id, columnId, index }: { id: string; columnId: string; index: number },
): GroupWithCategories[] {
    const moved = groups.flatMap((g) => g.categories).find((c) => c.id === id);
    if (!moved) return groups;
    const groupId = columnId === UNGROUPED ? null : columnId;
    // Children follow their parent into the new lane; the board files them
    // under it either way, and leaving them behind would strand them.
    const family = new Set([
        id,
        ...groups.flatMap((g) => g.categories).filter((c) => c.parent_id === id).map((c) => c.id),
    ]);

    return groups.map((group) => {
        const kept = group.categories.filter((c) => !family.has(c.id));
        if (group.id !== columnId) return { ...group, categories: kept };

        const relocated = [...family]
            .map((memberId) => groups.flatMap((g) => g.categories).find((c) => c.id === memberId)!)
            .map((c) => ({ ...c, group_id: groupId }));
        const [parent, ...children] = relocated;

        const tops = kept.filter((c) => !c.parent_id);
        const at = Math.min(index, tops.length);
        const rebuilt: typeof kept = [];
        tops.slice(0, at).forEach((top) => {
            rebuilt.push(top, ...kept.filter((c) => c.parent_id === top.id));
        });
        rebuilt.push({ ...parent, sort_order: 0 }, ...children);
        tops.slice(at).forEach((top) => {
            rebuilt.push(top, ...kept.filter((c) => c.parent_id === top.id));
        });
        // Renumbered so the optimistic order survives the next sort.
        let position = 0;
        return {
            ...group,
            categories: rebuilt.map((c) =>
                c.parent_id ? c : { ...c, sort_order: ++position },
            ),
        };
    });
}

async function userId(sb: ReturnType<typeof requireSupabase>): Promise<string> {
    const { data, error } = await sb.auth.getUser();
    if (error || !data.user) throw new Error("not signed in");
    return data.user.id;
}
