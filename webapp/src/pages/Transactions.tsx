import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type FormEvent, useState } from "react";
import { fmtDate, fmtMoney } from "../lib/format";
import { signedUrlFor } from "../lib/storage";
import { requireSupabase } from "../lib/supabase";
import { fetchAccounts, fetchTaxonomy } from "../lib/taxonomy";
import type { Transaction } from "../lib/types";

interface TxRow extends Transaction {
    categories: { name: string; icon: string | null; color: string | null } | null;
}

const PAGE_SIZE = 200;

interface Filters {
    from: string;
    to: string;
    accountId: string;
    categoryId: string;
    kind: string;
}

const EMPTY_FILTERS: Filters = { from: "", to: "", accountId: "", categoryId: "", kind: "" };

export default function Transactions() {
    const [search, setSearch] = useState("");
    const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });

    const txs = useQuery({
        queryKey: ["transactions", filters, limit],
        queryFn: async () => {
            let q = requireSupabase()
                .from("transactions")
                .select("*, categories(name, icon, color)")
                .eq("review_status", "accepted");
            if (filters.from) q = q.gte("occurred_at", filters.from);
            if (filters.to) q = q.lte("occurred_at", `${filters.to}T23:59:59`);
            if (filters.accountId) q = q.eq("account_id", filters.accountId);
            if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
            if (filters.kind) q = q.eq("kind", filters.kind);
            const { data, error } = await q
                .order("occurred_at", { ascending: false })
                .limit(limit);
            if (error) throw new Error(error.message);
            return (data ?? []) as TxRow[];
        },
    });

    const term = search.trim().toLowerCase();
    const rows = (txs.data ?? []).filter(
        (t) =>
            !term ||
            (t.payee ?? "").toLowerCase().includes(term) ||
            (t.memo ?? "").toLowerCase().includes(term) ||
            (t.categories?.name ?? "").toLowerCase().includes(term),
    );
    const maybeMore = (txs.data?.length ?? 0) === limit;
    const filtersActive = Object.values(filters).some(Boolean);

    function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
        setFilters((f) => ({ ...f, [key]: value }));
        setLimit(PAGE_SIZE);
    }

    // Export everything matching the current filters (not just loaded pages).
    const exportData = useMutation({
        mutationFn: async (format: "csv" | "json") => {
            let q = requireSupabase()
                .from("transactions")
                .select("*, categories(name)")
                .eq("review_status", "accepted");
            if (filters.from) q = q.gte("occurred_at", filters.from);
            if (filters.to) q = q.lte("occurred_at", `${filters.to}T23:59:59`);
            if (filters.accountId) q = q.eq("account_id", filters.accountId);
            if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
            if (filters.kind) q = q.eq("kind", filters.kind);
            const { data, error } = await q
                .order("occurred_at", { ascending: false })
                .limit(10000);
            if (error) throw new Error(error.message);

            const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
            const records = (data ?? []).map((t) => ({
                date: t.occurred_at,
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

    return (
        <div className="mx-auto max-w-4xl">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                    <h1 className="text-xl font-semibold">Transactions</h1>
                    <p className="text-sm text-slate-400">Accepted ledger entries.</p>
                </div>
                <input
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500 sm:w-64"
                    placeholder="Search payee, memo, category…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <input
                    type="date"
                    className={filterCls}
                    title="From date"
                    value={filters.from}
                    onChange={(e) => setFilter("from", e.target.value)}
                />
                <span className="text-slate-600">–</span>
                <input
                    type="date"
                    className={filterCls}
                    title="To date"
                    value={filters.to}
                    onChange={(e) => setFilter("to", e.target.value)}
                />
                <select
                    className={filterCls}
                    value={filters.accountId}
                    onChange={(e) => setFilter("accountId", e.target.value)}
                >
                    <option value="">All accounts</option>
                    {(accounts.data ?? [])
                        .filter((a) => !a.is_archived)
                        .map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name}
                            </option>
                        ))}
                </select>
                <select
                    className={filterCls}
                    value={filters.categoryId}
                    onChange={(e) => setFilter("categoryId", e.target.value)}
                >
                    <option value="">All categories</option>
                    {(taxonomy.data ?? []).map((g) => (
                        <optgroup key={g.id} label={g.name}>
                            {g.categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.parent_id ? "· " : ""}
                                    {c.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <select
                    className={filterCls}
                    value={filters.kind}
                    onChange={(e) => setFilter("kind", e.target.value)}
                >
                    <option value="">All kinds</option>
                    <option value="expense">expense</option>
                    <option value="income">income</option>
                    <option value="transfer">transfer</option>
                    <option value="adjustment">adjustment</option>
                </select>
                {filtersActive && (
                    <button
                        className="text-xs text-slate-500 hover:text-slate-300"
                        onClick={() => {
                            setFilters(EMPTY_FILTERS);
                            setLimit(PAGE_SIZE);
                        }}
                    >
                        Clear filters
                    </button>
                )}
                <span className="ml-auto flex gap-2">
                    <button
                        className="text-xs text-slate-500 hover:text-slate-300"
                        disabled={exportData.isPending}
                        onClick={() => exportData.mutate("csv")}
                        title="Download everything matching the current filters"
                    >
                        ⬇ CSV
                    </button>
                    <button
                        className="text-xs text-slate-500 hover:text-slate-300"
                        disabled={exportData.isPending}
                        onClick={() => exportData.mutate("json")}
                    >
                        ⬇ JSON
                    </button>
                </span>
            </div>
            {exportData.isError && (
                <p className="mb-3 text-xs text-rose-400">{(exportData.error as Error).message}</p>
            )}

            {txs.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {txs.isError && (
                <p className="text-sm text-rose-400">{(txs.error as Error).message}</p>
            )}

            {txs.isSuccess && rows.length === 0 && (
                <p className="text-sm text-slate-500">
                    {term || filtersActive
                        ? "No matches for the current search/filters."
                        : "No accepted transactions yet — review your inbox."}
                </p>
            )}

            {rows.length > 0 && (
                <p className="mb-2 text-xs text-slate-600">
                    Click a row to see tags and the original receipt/recording.
                </p>
            )}
            {rows.length > 0 && (
                <div className="-mx-1 overflow-x-auto px-1">
                <table className="w-full min-w-[32rem] text-sm">
                    <thead>
                        <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                            <th className="py-2 pr-4 font-medium">Date</th>
                            <th className="py-2 pr-4 font-medium">Payee</th>
                            <th className="py-2 pr-4 font-medium">Category</th>
                            <th className="py-2 text-right font-medium">Amount</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                        {rows.map((t) => (
                            <Fragment key={t.id}>
                            <tr
                                className="cursor-pointer hover:bg-slate-900/40"
                                onClick={() => setExpandedId(expandedId === t.id ? null : t.id)}
                            >
                                <td className="whitespace-nowrap py-2 pr-4 text-slate-400">
                                    {fmtDate(t.occurred_at)}
                                </td>
                                <td className="py-2 pr-4">
                                    <div className="text-slate-200">{t.payee ?? "—"}</div>
                                    {t.memo && <div className="text-xs text-slate-500">{t.memo}</div>}
                                </td>
                                <td className="py-2 pr-4">
                                    {t.categories ? (
                                        <span
                                            className="rounded px-2 py-0.5 text-xs"
                                            style={{
                                                backgroundColor: `${t.categories.color ?? "#64748b"}26`,
                                                color: t.categories.color ?? "#94a3b8",
                                            }}
                                        >
                                            {t.categories.icon} {t.categories.name}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-600">uncategorized</span>
                                    )}
                                </td>
                                <td
                                    className={`whitespace-nowrap py-2 text-right font-medium ${
                                        t.kind === "income" ? "text-emerald-400" : "text-slate-200"
                                    }`}
                                >
                                    {t.kind === "expense" ? "−" : t.kind === "income" ? "+" : ""}
                                    {fmtMoney(t.amount, t.currency)}
                                </td>
                            </tr>
                            {expandedId === t.id && (
                                <tr>
                                    <td colSpan={4} className="bg-slate-900/30 px-4 py-3">
                                        <TxDetail tx={t} />
                                    </td>
                                </tr>
                            )}
                            </Fragment>
                        ))}
                    </tbody>
                </table>
                </div>
            )}

            {maybeMore && (
                <button
                    className="mt-4 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    disabled={txs.isFetching}
                    onClick={() => setLimit((l) => l + PAGE_SIZE)}
                >
                    {txs.isFetching ? "Loading…" : "Load more"}
                </button>
            )}
        </div>
    );
}

function TxDetail({ tx }: { tx: TxRow }) {
    const qc = useQueryClient();
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
                        onClick={() => {
                            if (window.confirm("Reject this transaction? It leaves the ledger but stays on record.")) {
                                update.mutate({ review_status: "rejected" });
                            }
                        }}
                    >
                        Reject
                    </button>
                    <button
                        className="ml-auto rounded-lg px-3 py-1.5 text-rose-400 hover:bg-rose-950/50 hover:text-rose-300"
                        disabled={remove.isPending}
                        title="Permanently delete — cannot be undone"
                        onClick={() => {
                            if (
                                window.confirm(
                                    `Permanently delete this transaction (${fmtMoney(tx.amount, tx.currency)}${tx.payee ? ` · ${tx.payee}` : ""})? This cannot be undone.`,
                                )
                            ) {
                                remove.mutate();
                            }
                        }}
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
    const [payee, setPayee] = useState(tx.payee ?? "");
    const [amount, setAmount] = useState(String(tx.amount));
    const [currency, setCurrency] = useState(tx.currency);
    const [kind, setKind] = useState(tx.kind);
    const [occurredAt, setOccurredAt] = useState(() => toLocalInput(tx.occurred_at));
    const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
    const [accountId, setAccountId] = useState(tx.account_id ?? "");
    const [memo, setMemo] = useState(tx.memo ?? "");
    const [tags, setTags] = useState(tx.tags.join(", "));

    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });
    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

    function submit(e: FormEvent) {
        e.preventDefault();
        onSave({
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
                <select
                    className={editInputCls}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as TxRow["kind"])}
                >
                    <option value="expense">expense</option>
                    <option value="income">income</option>
                    <option value="transfer">transfer</option>
                    <option value="adjustment">adjustment</option>
                </select>
            </div>
            <input
                className={editInputCls}
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                required
            />
            <select className={editInputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— no category —</option>
                {(taxonomy.data ?? []).map((group) => (
                    <optgroup key={group.id} label={group.name}>
                        {group.categories.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.parent_id ? "· " : ""}
                                {c.name}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </select>
            <select className={editInputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— no account —</option>
                {(accounts.data ?? [])
                    .filter((a) => !a.is_archived)
                    .map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name} ({a.currency})
                        </option>
                    ))}
            </select>
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
    "rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500";

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

const filterCls =
    "rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-300 outline-none focus:border-emerald-500";
