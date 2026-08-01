import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useConfirm } from "../components/Confirm";
import DataTable, { type Column } from "../components/DataTable";
import {
    ColorPill,
    Field,
    Input,
    PageHeader,
    Picker,
    Pill,
    QueryError,
    StatCard,
} from "../components/ui";
import {
    DEFAULT_CURRENCY,
    EXPORT_ROW_LIMIT,
    TRANSACTION_KINDS,
    TRANSACTION_PAGE_SIZE as PAGE_SIZE,
} from "../lib/constants";
import { fmtDate, fmtMoney } from "../lib/format";
import { enumOptions } from "../lib/options";
import { useAccountOptions, useAccounts, useCategoryOptions } from "../lib/queries";
import { signedUrlFor } from "../lib/storage";
import { requireSupabase } from "../lib/supabase";
import { regenerateSummaries, runSummaryBacklog, useSummaryJob } from "../lib/summaryJob";
import type { Transaction } from "../lib/types";

interface TxRow extends Transaction {
    categories: { name: string; icon: string | null; color: string | null } | null;
}

interface Filters {
    from: string;
    to: string;
    accountId: string;
    categoryId: string;
    kind: string;
}

const EMPTY_FILTERS: Filters = { from: "", to: "", accountId: "", categoryId: "", kind: "" };

/** The four kinds, as picker rows. Fixed, so it never needs re-deriving. */
const KIND_OPTIONS = enumOptions(TRANSACTION_KINDS);

/** The sign a kind puts in front of its amount, and which way it moves money. */
function signOf(kind: TxRow["kind"]): number {
    return kind === "income" ? 1 : kind === "expense" ? -1 : 0;
}

/* --- The filtered set ------------------------------------------------------
   Three queries read the same slice of the ledger — the visible page, the
   totals above it, and the export. They share this clause so a new filter
   can't reach one of them and not the others. */

type Clause = ["eq" | "gte" | "lte", string, string];

/** The PostgREST clauses the current filter state implies. */
function filterClauses(filters: Filters): Clause[] {
    const clauses: Clause[] = [["eq", "review_status", "accepted"]];
    if (filters.from) clauses.push(["gte", "occurred_at", filters.from]);
    // The `to` date covers the whole day, not midnight on it.
    if (filters.to) clauses.push(["lte", "occurred_at", `${filters.to}T23:59:59`]);
    if (filters.accountId) clauses.push(["eq", "account_id", filters.accountId]);
    if (filters.categoryId) clauses.push(["eq", "category_id", filters.categoryId]);
    if (filters.kind) clauses.push(["eq", "kind", filters.kind]);
    return clauses;
}

/**
 * Apply those clauses to a PostgREST builder, in and out as the same type.
 * The cast is confined to this one function: the builder's fluent `this` types
 * are too deep for the compiler to re-check at every call site.
 */
function applyFilters<Q>(query: Q, filters: Filters): Q {
    type Chainable = Record<Clause[0], (column: string, value: string) => Chainable>;
    let q = query as Chainable;
    for (const [op, column, value] of filterClauses(filters)) {
        q = q[op](column, value);
    }
    return q as Q;
}

/* --- Credits and debits ----------------------------------------------------
   Money in and money out across everything the filters match, not just the
   pages loaded into the table — so narrowing the date range answers "what did
   this month actually cost?" rather than "what cost that of the last 200 rows?".

   Kept per-currency: Sagebook is multi-currency and adding ₦ to $ would be a
   lie. Transfers and adjustments are neither a credit nor a debit — they move
   money between your own accounts — so they are counted separately. */

interface CurrencyTotals {
    currency: string;
    credits: number;
    debits: number;
    creditCount: number;
    debitCount: number;
}

interface LedgerTotals {
    byCurrency: CurrencyTotals[];
    /** Entries matched that are neither a credit nor a debit. */
    neutralCount: number;
    /** The row cap was hit, so the figures are a floor rather than a total. */
    truncated: boolean;
}

function summarize(
    records: Array<Pick<Transaction, "kind" | "amount" | "currency">>,
    truncated: boolean,
): LedgerTotals {
    const byCurrency = new Map<string, CurrencyTotals>();
    let neutralCount = 0;

    for (const r of records) {
        if (r.kind !== "income" && r.kind !== "expense") {
            neutralCount++;
            continue;
        }
        const t = byCurrency.get(r.currency) ?? {
            currency: r.currency,
            credits: 0,
            debits: 0,
            creditCount: 0,
            debitCount: 0,
        };
        if (r.kind === "income") {
            t.credits += Number(r.amount);
            t.creditCount++;
        } else {
            t.debits += Number(r.amount);
            t.debitCount++;
        }
        byCurrency.set(r.currency, t);
    }

    return {
        byCurrency: [...byCurrency.values()].sort(
            (a, b) => b.credits + b.debits - (a.credits + a.debits),
        ),
        neutralCount,
        truncated,
    };
}

export default function Transactions() {
    const qc = useQueryClient();
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [limit, setLimit] = useState(PAGE_SIZE);

    const accounts = useAccounts();
    const accountOpts = useAccountOptions();
    const categoryOpts = useCategoryOptions();

    const txs = useQuery({
        queryKey: ["transactions", filters, limit],
        queryFn: async () => {
            const q = applyFilters(
                requireSupabase()
                    .from("transactions")
                    .select("*, categories(name, icon, color)"),
                filters,
            );
            const { data, error } = await q
                .order("occurred_at", { ascending: false })
                .limit(limit);
            if (error) throw new Error(error.message);
            return (data ?? []) as TxRow[];
        },
    });

    // Totals span every matching row, so they stay correct as the table pages.
    // Only three columns come back, which keeps this cheap next to the table's
    // own query.
    const totals = useQuery({
        queryKey: ["transaction-totals", filters],
        queryFn: async () => {
            const q = applyFilters(
                requireSupabase().from("transactions").select("kind, amount, currency"),
                filters,
            );
            const { data, error } = await q.limit(EXPORT_ROW_LIMIT);
            if (error) throw new Error(error.message);
            const records = (data ?? []) as Array<
                Pick<Transaction, "kind" | "amount" | "currency">
            >;
            return summarize(records, records.length === EXPORT_ROW_LIMIT);
        },
    });

    const rows = txs.data ?? [];
    const missingSummaries = rows.filter((t) => !t.summary).length;
    const maybeMore = rows.length === limit;
    const activeFilterCount = Object.values(filters).filter(Boolean).length;

    const accountName = useMemo(
        () => new Map((accounts.data ?? []).map((a) => [a.id, a.name])),
        [accounts.data],
    );

    function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
        setFilters((f) => ({ ...f, [key]: value }));
        setLimit(PAGE_SIZE);
    }

    // Export everything matching the current filters (not just loaded pages).
    const exportData = useMutation({
        mutationFn: async (format: "csv" | "json") => {
            const q = applyFilters(
                requireSupabase().from("transactions").select("*, categories(name)"),
                filters,
            );
            const { data, error } = await q
                .order("occurred_at", { ascending: false })
                .limit(EXPORT_ROW_LIMIT);
            if (error) throw new Error(error.message);

            const records = (data ?? []).map((t) => ({
                date: t.occurred_at,
                summary: t.summary ?? "",
                payee: t.payee ?? "",
                memo: t.memo ?? "",
                amount: t.amount,
                currency: t.currency,
                kind: t.kind,
                category: (t.categories as { name: string } | null)?.name ?? "",
                account: t.account_id ? (accountName.get(t.account_id) ?? "") : "",
                tags: (t.tags ?? []).join(";"),
                id: t.id,
            }));

            const stamp = new Date().toISOString().slice(0, 10);
            if (format === "json") {
                download(`sagebook-transactions-${stamp}.json`, "application/json",
                    JSON.stringify(records, null, 2));
            } else {
                const cols = Object.keys(records[0] ?? { date: "" });
                const esc = (v: unknown) => {
                    const s = String(v ?? "");
                    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                };
                const csv = [
                    cols.join(","),
                    ...records.map((r) => cols.map((c) => esc((r as Record<string, unknown>)[c])).join(",")),
                ].join("\n");
                download(`sagebook-transactions-${stamp}.csv`, "text/csv", csv);
            }
            return records.length;
        },
    });

    // Bulk edits and deletes for the current selection. Both ripple into
    // balances, reports and net worth, so the whole cache is invalidated.
    const bulkUpdate = useMutation({
        mutationFn: async (args: { ids: string[]; patch: Record<string, unknown> }) => {
            const { error } = await requireSupabase()
                .from("transactions")
                .update(args.patch)
                .in("id", args.ids);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries(),
    });

    const bulkDelete = useMutation({
        mutationFn: async (ids: string[]) => {
            const { error } = await requireSupabase().from("transactions").delete().in("id", ids);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries(),
    });

    const columns: Array<Column<TxRow>> = [
        {
            id: "date",
            label: "Date",
            width: "9rem",
            mobile: "meta",
            sortValue: (t) => t.occurred_at,
            searchValue: (t) => fmtDate(t.occurred_at),
            cell: (t) => (
                <span className="whitespace-nowrap text-[0.78125rem] text-slate-500">
                    {fmtDate(t.occurred_at)}
                </span>
            ),
        },
        {
            id: "summary",
            label: "Summary",
            hideable: false,
            mobile: "title",
            sortValue: (t) => t.summary ?? t.payee ?? "",
            searchValue: (t) => [t.summary, t.payee, t.memo].filter(Boolean).join(" "),
            // Search matches the narration too, but an export of this column
            // should be the readable line — the raw text has its own column.
            exportValue: (t) => t.summary ?? t.payee ?? "",
            cell: (t, { dense }) => {
                // The summary is the readable line. The bank's raw narration
                // sits underneath but is clamped — those strings run to 150+
                // characters and would set the width of the whole table. The
                // full text is one row-click away, in TxFacts.
                const secondary = t.summary ? (t.payee ?? t.memo) : t.memo;
                return (
                    <div className="min-w-0">
                        <div className="font-medium text-slate-200">
                            {t.summary ?? t.payee ?? "—"}
                        </div>
                        {secondary && (
                            <div
                                className={`mt-0.5 break-words text-[0.6875rem] leading-[1.35] text-slate-500 ${
                                    dense ? "line-clamp-1" : "line-clamp-2"
                                }`}
                            >
                                {secondary}
                            </div>
                        )}
                    </div>
                );
            },
        },
        {
            id: "category",
            label: "Category",
            width: "14rem",
            sortValue: (t) => t.categories?.name ?? "",
            searchValue: (t) => t.categories?.name ?? "",
            cell: (t) =>
                t.categories ? (
                    <ColorPill color={t.categories.color}>
                        {t.categories.icon} {t.categories.name}
                    </ColorPill>
                ) : (
                    <span className="text-xs text-slate-500">uncategorized</span>
                ),
        },
        {
            // Off by default — the row already shows a clamped preview of it.
            // Turn it on to read or export the bank's wording in full.
            id: "narration",
            label: "Narration",
            defaultHidden: true,
            mobile: "hidden",
            sortValue: (t) => t.memo ?? "",
            cell: (t, { dense }) =>
                t.memo ? (
                    <span
                        className={`block break-words text-xs text-slate-400 ${
                            dense ? "line-clamp-1" : "line-clamp-3"
                        }`}
                    >
                        {t.memo}
                    </span>
                ) : (
                    <span className="text-xs text-slate-600">—</span>
                ),
        },
        {
            id: "account",
            label: "Account",
            width: "11rem",
            sortValue: (t) => (t.account_id ? (accountName.get(t.account_id) ?? "") : ""),
            cell: (t) => (
                <span className="text-[0.8125rem] text-slate-400">
                    {(t.account_id && accountName.get(t.account_id)) || "—"}
                </span>
            ),
        },
        {
            id: "kind",
            label: "Kind",
            width: "7rem",
            defaultHidden: true,
            sortValue: (t) => t.kind,
            cell: (t) => (
                <Pill tint={t.kind === "income" ? "green" : t.kind === "expense" ? "coral" : "blue"}>
                    {t.kind}
                </Pill>
            ),
        },
        {
            id: "tags",
            label: "Tags",
            defaultHidden: true,
            searchValue: (t) => t.tags.join(" "),
            sortValue: (t) => t.tags.join(" "),
            cell: (t) =>
                t.tags.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                        {t.tags.map((tag) => (
                            <span key={tag} className="rounded bg-chip px-1.5 py-0.5 text-xs text-slate-400">
                                #{tag}
                            </span>
                        ))}
                    </span>
                ) : (
                    <span className="text-xs text-slate-600">—</span>
                ),
        },
        {
            id: "amount",
            label: "Amount",
            align: "right",
            width: "10rem",
            hideable: false,
            mobile: "trailing",
            sortValue: (t) => signOf(t.kind) * Number(t.amount),
            exportValue: (t) => signOf(t.kind) * Number(t.amount),
            cell: (t) => (
                <span
                    className={`whitespace-nowrap font-bold tnum ${
                        t.kind === "income" ? "text-emerald-400" : "text-slate-200"
                    }`}
                >
                    {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                    {fmtMoney(t.amount, t.currency)}
                </span>
            ),
        },
    ];

    return (
        <>
            <PageHeader
                title="Ledger"
                subtitle={`${rows.length}${maybeMore ? "+" : ""} accepted entr${
                    rows.length === 1 ? "y" : "ies"
                } loaded`}
            />
            {/* Exporting lives in the table's own Export menu, next to the
                controls that decide what would be exported. */}

            <QueryError error={exportData.error} />
            <QueryError error={txs.error} />
            <QueryError error={totals.error} />
            <QueryError error={bulkUpdate.error ?? bulkDelete.error} />

            <LedgerTotalsPanel
                totals={totals.data}
                loading={totals.isLoading}
                fallbackCurrency={rows[0]?.currency ?? DEFAULT_CURRENCY}
                scope={activeFilterCount > 0 ? "matching your filters" : "across your whole ledger"}
            />

            {missingSummaries > 0 && <SummaryBacklogBanner missing={missingSummaries} />}

            <DataTable
                storageKey="transactions"
                data={rows}
                columns={columns}
                rowId={(t) => t.id}
                loading={txs.isLoading}
                searchPlaceholder="Search summary, payee, memo, category…"
                rowNoun="entry"
                exportFilename={`sagebook-ledger-${new Date().toISOString().slice(0, 10)}`}
                exportActions={[
                    {
                        label: "Everything matching filters · CSV",
                        hint: "Every matching row, not just the pages loaded here",
                        onSelect: () => exportData.mutate("csv"),
                    },
                    {
                        label: "Everything matching filters · JSON",
                        hint: "Every matching row, not just the pages loaded here",
                        onSelect: () => exportData.mutate("json"),
                    },
                ]}
                initialSort={{ columnId: "date", direction: "desc" }}
                activeFilterCount={activeFilterCount}
                onClearFilters={() => {
                    setFilters(EMPTY_FILTERS);
                    setLimit(PAGE_SIZE);
                }}
                filters={
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label="From">
                            <Input
                                type="date"
                                value={filters.from}
                                onChange={(e) => setFilter("from", e.target.value)}
                            />
                        </Field>
                        <Field label="To">
                            <Input
                                type="date"
                                value={filters.to}
                                onChange={(e) => setFilter("to", e.target.value)}
                            />
                        </Field>
                        <Field label="Account">
                            <Picker
                                options={accountOpts}
                                value={filters.accountId}
                                onChange={(v) => setFilter("accountId", v)}
                                placeholder="All accounts"
                                clearable
                            />
                        </Field>
                        <Field label="Category">
                            <Picker
                                options={categoryOpts}
                                value={filters.categoryId}
                                onChange={(v) => setFilter("categoryId", v)}
                                placeholder="All categories"
                                clearable
                            />
                        </Field>
                        <Field label="Kind">
                            <Picker
                                options={KIND_OPTIONS}
                                value={filters.kind}
                                onChange={(v) => setFilter("kind", v)}
                                placeholder="All kinds"
                                clearable
                            />
                        </Field>
                    </div>
                }
                selectable
                bulkActions={({ ids, clear }) => (
                    <BulkActions
                        ids={ids}
                        busy={bulkUpdate.isPending || bulkDelete.isPending}
                        onPatch={(patch) => bulkUpdate.mutate({ ids, patch }, { onSuccess: clear })}
                        onDelete={() => bulkDelete.mutate(ids, { onSuccess: clear })}
                    />
                )}
                renderExpanded={(t) => <TxDetail tx={t} />}
                hasMore={maybeMore}
                loadingMore={txs.isFetching}
                onLoadMore={() => setLimit((l) => l + PAGE_SIZE)}
                emptyTitle={
                    activeFilterCount > 0 ? "No matches" : "No accepted transactions yet"
                }
                emptyBody={
                    activeFilterCount > 0
                        ? "Nothing matches the current filters. Clear one and try again."
                        : "Capture something or review your inbox — accepted entries land here."
                }
                footNote="Click a row for the original narration, reference, and source capture."
            />
        </>
    );
}

/**
 * Money in, money out, and the difference — for whatever the filters currently
 * select. One row of tiles per currency, so a multi-currency ledger never
 * implies that two currencies add up.
 */
function LedgerTotalsPanel({
    totals,
    loading,
    fallbackCurrency,
    scope,
}: {
    totals: LedgerTotals | undefined;
    loading: boolean;
    fallbackCurrency: string;
    scope: string;
}) {
    if (loading && !totals) {
        return (
            <div className="grid gap-3.5 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                    <div key={i} className="sb-card px-5 py-[1.125rem]">
                        <div className="sb-skeleton h-3 w-20" />
                        <div className="sb-skeleton mt-3 h-6 w-32" />
                    </div>
                ))}
            </div>
        );
    }
    if (!totals) return null;

    // An empty result still gets a row of zeros — "no credits this month" is an
    // answer, and hiding the tiles would read as the feature being broken.
    const rows: CurrencyTotals[] = totals.byCurrency.length
        ? totals.byCurrency
        : [
              {
                  currency: fallbackCurrency,
                  credits: 0,
                  debits: 0,
                  creditCount: 0,
                  debitCount: 0,
              },
          ];
    const multi = rows.length > 1;

    /** A figure the row cap may have cut short is marked as a floor, not a total. */
    const figure = (value: number, currency: string, signed = false) => {
        const sign = !signed || value === 0 ? "" : value > 0 ? "+" : "−";
        const body = `${sign}${fmtMoney(signed ? Math.abs(value) : value, currency)}`;
        if (!totals.truncated) return body;
        return (
            <span title={`More than ${EXPORT_ROW_LIMIT.toLocaleString()} entries match — this is a floor, not the full total. Narrow the date range for an exact figure.`}>
                ≥ {body}
            </span>
        );
    };

    return (
        <div className="flex flex-col gap-3.5">
            {rows.map((t) => {
                const net = t.credits - t.debits;
                return (
                    <div key={t.currency} className="grid gap-3.5 sm:grid-cols-3">
                        <StatCard
                            label={multi ? `Credits · ${t.currency}` : "Credits"}
                            value={figure(t.credits, t.currency)}
                            tone="positive"
                            hint={`money in · ${t.creditCount} ${t.creditCount === 1 ? "entry" : "entries"}`}
                        />
                        <StatCard
                            label={multi ? `Debits · ${t.currency}` : "Debits"}
                            value={figure(t.debits, t.currency)}
                            tone="negative"
                            hint={`money out · ${t.debitCount} ${t.debitCount === 1 ? "entry" : "entries"}`}
                        />
                        <StatCard
                            label={multi ? `Net · ${t.currency}` : "Net"}
                            value={figure(net, t.currency, true)}
                            tone="dark"
                            hint={scope}
                        />
                    </div>
                );
            })}
            {totals.neutralCount > 0 && (
                <p className="text-xs text-slate-500">
                    {totals.neutralCount} transfer
                    {totals.neutralCount === 1 ? "" : "s"} / adjustment
                    {totals.neutralCount === 1 ? "" : "s"} excluded — they move money between your
                    own accounts rather than in or out.
                </p>
            )}
        </div>
    );
}

/** The verbs offered once rows are ticked in the ledger. */
function BulkActions({
    ids,
    busy,
    onPatch,
    onDelete,
}: {
    ids: string[];
    busy: boolean;
    onPatch: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
}) {
    const categoryOpts = useCategoryOptions();
    const accountOpts = useAccountOptions();
    const confirm = useConfirm();
    const scope = `${ids.length} selected`;
    const noun = `${ids.length} transaction${ids.length === 1 ? "" : "s"}`;

    // These two are verbs, not fields: they hold no value, they apply one. The
    // trigger keeps showing its prompt, and the palette names the target set so
    // it is clear what a click is about to rewrite.
    return (
        <>
            <Picker
                compact
                options={categoryOpts}
                value=""
                onChange={(v) => onPatch({ category_id: v })}
                placeholder="Set category…"
                title="Set category"
                subtitle={scope}
                aria-label="Set category for selected"
                disabled={busy}
            />
            <Picker
                compact
                options={accountOpts}
                value=""
                onChange={(v) => onPatch({ account_id: v })}
                placeholder="Set account…"
                title="Set account"
                subtitle={scope}
                aria-label="Set account for selected"
                disabled={busy}
            />
            <button
                className="sb-tbtn"
                disabled={busy}
                title="Return these to the review inbox"
                onClick={() => onPatch({ review_status: "pending_review", reviewed_at: null })}
            >
                Back to inbox
            </button>
            <button
                className="sb-tbtn"
                disabled={busy}
                title="Leaves the ledger but stays on record"
                onClick={() =>
                    confirm({
                        title: `Reject ${noun}?`,
                        body: "They leave the ledger but stay on record — you can find them again with the inbox's Rejected filter and accept them back.",
                        confirmLabel: `Reject ${ids.length}`,
                        onConfirm: () => onPatch({ review_status: "rejected" }),
                    })
                }
            >
                Reject
            </button>
            <button
                className="sb-tbtn !border-rose-900/60 !text-rose-400"
                disabled={busy}
                onClick={() =>
                    confirm({
                        title: `Delete ${noun}?`,
                        body: "They are erased from the ledger for good — no undo, and the balances and reports they feed change to match.",
                        confirmLabel: `Delete ${ids.length} permanently`,
                        danger: true,
                        // Bulk deletion is the one action here that can wreck a
                        // ledger in a click, so it costs a deliberate keystroke.
                        requirePhrase: "delete",
                        alternative: {
                            label: "Reject instead",
                            hint: "Rejecting takes them out of the ledger but keeps the records.",
                            onSelect: () => onPatch({ review_status: "rejected" }),
                        },
                        onConfirm: onDelete,
                    })
                }
            >
                {busy ? "Working…" : "Delete"}
            </button>
        </>
    );
}

function TxDetail({ tx }: { tx: TxRow }) {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [editing, setEditing] = useState(false);

    const update = useMutation({
        mutationFn: async (patch: Record<string, unknown>) => {
            const { error } = await requireSupabase()
                .from("transactions")
                .update(patch)
                .eq("id", tx.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setEditing(false);
            // Edits ripple into balances, reports, and net worth — refetch broadly.
            qc.invalidateQueries();
        },
    });

    const remove = useMutation({
        mutationFn: async () => {
            const { error } = await requireSupabase()
                .from("transactions")
                .delete()
                .eq("id", tx.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries(),
    });

    return (
        <div className="flex flex-col gap-2 text-xs">
            {!editing && <TxFacts tx={tx} onRegenerated={() => qc.invalidateQueries()} />}

            {tx.tags.length > 0 && !editing && (
                <div className="flex flex-wrap gap-1">
                    {tx.tags.map((tag) => (
                        <span key={tag} className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                            #{tag}
                        </span>
                    ))}
                </div>
            )}

            {editing ? (
                <TxEditForm
                    tx={tx}
                    busy={update.isPending}
                    onSave={(patch) => update.mutate(patch)}
                    onCancel={() => setEditing(false)}
                />
            ) : (
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
                        onClick={() => setEditing(true)}
                    >
                        Edit
                    </button>
                    <button
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-400 hover:bg-slate-700"
                        title="Return to the review inbox (removes it from the ledger until re-accepted)"
                        disabled={update.isPending}
                        onClick={() =>
                            update.mutate({ review_status: "pending_review", reviewed_at: null })
                        }
                    >
                        Back to inbox
                    </button>
                    <button
                        className="rounded-lg bg-rose-900/50 px-3 py-1.5 text-rose-200 hover:bg-rose-900"
                        disabled={update.isPending}
                        title="Leaves the ledger but stays on record (recoverable from the inbox filters)"
                        onClick={() =>
                            confirm({
                                title: "Reject this transaction?",
                                body: "It leaves the ledger but stays on record — the inbox's Rejected filter can bring it back.",
                                confirmLabel: "Reject",
                                onConfirm: () => update.mutate({ review_status: "rejected" }),
                            })
                        }
                    >
                        Reject
                    </button>
                    <button
                        className="ml-auto rounded-lg px-3 py-1.5 text-rose-400 hover:bg-rose-950/50 hover:text-rose-300"
                        disabled={remove.isPending}
                        title="Permanently delete — cannot be undone"
                        onClick={() =>
                            confirm({
                                title: "Delete this transaction?",
                                body: (
                                    <>
                                        <b className="text-slate-300">
                                            {fmtMoney(tx.amount, tx.currency)}
                                            {tx.payee ? ` · ${tx.payee}` : ""}
                                        </b>{" "}
                                        is erased for good, and your balances change to match.
                                    </>
                                ),
                                confirmLabel: "Delete permanently",
                                danger: true,
                                alternative: {
                                    label: "Reject instead",
                                    hint: "Rejecting takes it out of the ledger but keeps the record.",
                                    onSelect: () => update.mutate({ review_status: "rejected" }),
                                },
                                onConfirm: () => remove.mutate(),
                            })
                        }
                    >
                        {remove.isPending ? "Deleting…" : "Delete"}
                    </button>
                </div>
            )}
            {(update.isError || remove.isError) && (
                <p className="text-rose-400">{((update.error ?? remove.error) as Error).message}</p>
            )}

            {!editing && (tx.original_ai_data?.line_items?.length ?? 0) > 0 && (
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-2">
                    <div className="mb-1 text-slate-500">Receipt items:</div>
                    <ul className="flex flex-col gap-0.5">
                        {tx.original_ai_data!.line_items!.map((item, i) => (
                            <li key={i} className="flex justify-between gap-3 text-slate-400">
                                <span>
                                    {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ""}
                                    {item.description}
                                </span>
                                {typeof item.amount === "number" && (
                                    <span className="whitespace-nowrap text-slate-500">
                                        {fmtMoney(item.amount, tx.currency)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {tx.ingestion_id ? (
                <MediaPreview ingestionId={tx.ingestion_id} />
            ) : (
                <span className="text-slate-600">Manually entered — no source capture.</span>
            )}
        </div>
    );
}

/**
 * Everything the summary line leaves out. The list row is deliberately one
 * readable sentence, so this is where the raw record lives: what the bank
 * actually wrote, the reference, the account, and the exact timestamp.
 */
function TxFacts({ tx, onRegenerated }: { tx: TxRow; onRegenerated: () => void }) {
    const accounts = useAccounts();
    const account = (accounts.data ?? []).find((a) => a.id === tx.account_id);
    const reference = tx.metadata?.reference;

    const regenerate = useMutation({
        mutationFn: () => regenerateSummaries([tx.id]),
        onSuccess: onRegenerated,
    });

    const rows: Array<[string, ReactNode]> = [];
    if (tx.summary) {
        rows.push([
            "Summary",
            <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-slate-200">{tx.summary}</span>
                <span className="text-slate-600">
                    {tx.summary_model === "user" ? "· edited by you" : `· ${tx.summary_model ?? "generated"}`}
                </span>
            </span>,
        ]);
    }
    rows.push(["Amount", `${tx.kind === "expense" ? "−" : tx.kind === "income" ? "+" : ""}${fmtMoney(tx.amount, tx.currency)} · ${tx.kind}`]);
    rows.push(["Date", new Date(tx.occurred_at).toLocaleString()]);
    if (tx.payee) rows.push(["Payee", tx.payee]);
    // The memo holds the bank's verbatim narration — never truncated here.
    if (tx.memo && tx.memo !== tx.payee) rows.push(["Narration", <span className="break-words">{tx.memo}</span>]);
    if (reference) rows.push(["Reference", <span className="break-all font-mono">{reference}</span>]);
    rows.push(["Account", account?.name ?? "— unassigned —"]);
    rows.push(["Category", tx.categories?.name ?? "— uncategorized —"]);
    if (tx.original_ai_data?.category_reason) {
        rows.push(["Why this category", tx.original_ai_data.category_reason]);
    }
    rows.push(["Added", new Date(tx.created_at).toLocaleString()]);

    return (
        <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
            <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_1fr]">
                {rows.map(([label, value], i) => (
                    <Fragment key={i}>
                        <dt className="text-slate-500">{label}</dt>
                        <dd className="mb-1 text-slate-300 sm:mb-0">{value}</dd>
                    </Fragment>
                ))}
            </dl>
            {tx.summary_model !== "user" && (
                <button
                    className="mt-2 text-slate-500 hover:text-slate-300 disabled:opacity-50"
                    disabled={regenerate.isPending}
                    onClick={() => regenerate.mutate()}
                    title="Ask the model to rewrite this summary from the narration"
                >
                    {regenerate.isPending ? "Rewriting…" : tx.summary ? "↻ Rewrite summary" : "✨ Generate summary"}
                </button>
            )}
            {regenerate.isError && (
                <p className="mt-1 text-rose-400">{(regenerate.error as Error).message}</p>
            )}
        </div>
    );
}

/** Prompt to fill in summaries when the loaded page has rows without one. */
function SummaryBacklogBanner({ missing }: { missing: number }) {
    const qc = useQueryClient();
    const job = useSummaryJob();
    const running = job.status === "running";

    return (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-sky-900/50 bg-sky-950/20 px-3 py-2 text-xs">
            <span className="text-slate-300">
                {running
                    ? `Writing summaries… ${job.summarized} done, ${job.remaining} to go.`
                    : `${missing} transaction${missing === 1 ? " has" : "s have"} no plain-language summary yet.`}
            </span>
            {job.status === "error" && <span className="text-rose-400">{job.error}</span>}
            <button
                className="ml-auto rounded bg-sky-800/60 px-2 py-1 text-sky-200 hover:bg-sky-700/60 disabled:opacity-50"
                disabled={running}
                onClick={() => void runSummaryBacklog().then(() => qc.invalidateQueries())}
            >
                {running ? "Working…" : "Generate summaries"}
            </button>
        </div>
    );
}

function toLocalInput(iso: string): string {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TxEditForm({
    tx,
    busy,
    onSave,
    onCancel,
}: {
    tx: TxRow;
    busy: boolean;
    onSave: (patch: Record<string, unknown>) => void;
    onCancel: () => void;
}) {
    const [summary, setSummary] = useState(tx.summary ?? "");
    const [payee, setPayee] = useState(tx.payee ?? "");
    const [amount, setAmount] = useState(String(tx.amount));
    const [currency, setCurrency] = useState(tx.currency);
    const [kind, setKind] = useState(tx.kind);
    const [occurredAt, setOccurredAt] = useState(() => toLocalInput(tx.occurred_at));
    const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
    const [accountId, setAccountId] = useState(tx.account_id ?? "");
    const [memo, setMemo] = useState(tx.memo ?? "");
    const [tags, setTags] = useState(tx.tags.join(", "));

    const categoryOpts = useCategoryOptions();
    const accountOpts = useAccountOptions({ showCurrency: true });

    function submit(e: FormEvent) {
        e.preventDefault();
        const trimmedSummary = summary.trim();
        onSave({
            summary: trimmedSummary || null,
            // Claim the summary as the user's once they touch it, so a later
            // regeneration pass leaves their wording alone.
            ...(trimmedSummary !== (tx.summary ?? "")
                ? { summary_model: trimmedSummary ? "user" : null, summary_at: new Date().toISOString() }
                : {}),
            payee: payee.trim() || null,
            amount: Number(amount),
            currency: currency.trim().toUpperCase(),
            kind,
            occurred_at: new Date(occurredAt).toISOString(),
            category_id: categoryId || null,
            account_id: accountId || null,
            memo: memo.trim() || null,
            tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        });
    }

    return (
        <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
            <input
                className={`${editInputCls} sm:col-span-2`}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="summary — the one line shown in the list"
                maxLength={200}
            />
            <input className={editInputCls} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="payee" />
            <div className="flex flex-wrap gap-2">
                <input
                    className={`${editInputCls} min-w-0 flex-1`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                />
                <input
                    className={`${editInputCls} w-16`}
                    value={currency}
                    maxLength={3}
                    onChange={(e) => setCurrency(e.target.value)}
                    required
                />
                <Picker
                    className={editPickerCls}
                    options={KIND_OPTIONS}
                    value={kind}
                    onChange={(v) => setKind(v as TxRow["kind"])}
                    title="Kind"
                />
            </div>
            <input
                className={editInputCls}
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
            />
            <Picker
                className={editPickerCls}
                options={categoryOpts}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="— no category —"
                title="Category"
                clearable
            />
            <Picker
                className={editPickerCls}
                options={accountOpts}
                value={accountId}
                onChange={setAccountId}
                placeholder="— no account —"
                title="Account"
                clearable
            />
            <input className={editInputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="memo" />
            <input
                className={`${editInputCls} sm:col-span-2`}
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tags, comma-separated"
            />
            <div className="flex gap-2 sm:col-span-2">
                <button
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    disabled={busy}
                >
                    {busy ? "Saving…" : "Save"}
                </button>
                <button
                    type="button"
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
                    onClick={onCancel}
                >
                    Cancel
                </button>
            </div>
        </form>
    );
}

const editInputCls =
    "sb-input !py-1.5 text-xs";

/* `Picker` already carries `.sb-input`, so it takes only the size overrides. */
const editPickerCls = "!py-1.5 text-xs";

function MediaPreview({ ingestionId }: { ingestionId: string }) {
    const media = useQuery({
        queryKey: ["ingestion-media", ingestionId],
        queryFn: async () => {
            const sb = requireSupabase();
            const { data, error } = await sb
                .from("media_ingestions")
                .select("storage_path, media_kind, mime_type, parsed_payload")
                .eq("id", ingestionId)
                .single();
            if (error) throw new Error(error.message);
            const transcript =
                (data.parsed_payload as { transcript?: string } | null)?.transcript ?? null;
            if (!data.storage_path) return { ...data, transcript, url: null as string | null };
            return { ...data, transcript, url: await signedUrlFor(data.storage_path) };
        },
        staleTime: 30 * 60_000,
    });

    if (media.isLoading) return <span className="text-slate-500">Loading source…</span>;
    if (media.isError) {
        return <span className="text-rose-400">{(media.error as Error).message}</span>;
    }

    const m = media.data!;
    const transcriptBlock = m.transcript && (
        <blockquote className="rounded-lg border-l-2 border-slate-700 bg-slate-950/60 px-3 py-2 italic text-slate-400">
            “{m.transcript}”
        </blockquote>
    );

    if (!m.url) {
        return (
            <div className="flex flex-col gap-2">
                {transcriptBlock}
                <span className="text-slate-600">
                    Captured as {m.media_kind} — no file archived (inline capture).
                </span>
            </div>
        );
    }

    if (m.media_kind === "audio") {
        return (
            <div className="flex flex-col gap-2">
                {transcriptBlock}
                <audio controls src={m.url} className="max-w-full" />
            </div>
        );
    }

    if (m.media_kind === "image") {
        return (
            <a href={m.url} target="_blank" rel="noreferrer">
                <img
                    src={m.url}
                    alt="Source receipt"
                    className="max-h-72 rounded-lg border border-slate-800"
                />
            </a>
        );
    }
    return (
        <a
            href={m.url}
            target="_blank"
            rel="noreferrer"
            className="self-start rounded-lg bg-slate-800 px-3 py-1.5 text-slate-200 hover:bg-slate-700"
        >
            Open source file ({m.mime_type})
        </a>
    );
}

function download(filename: string, mime: string, content: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
