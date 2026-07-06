import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type { Category, CategoryGroup, PendingTransaction } from "../lib/types";

type ReviewAction = "accept" | "reject" | "edit";

export default function Inbox() {
    const qc = useQueryClient();

    const pending = useQuery({
        queryKey: ["pending-review"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("v_pending_review")
                .select("*")
                .order("occurred_at", { ascending: false });
            if (error) throw new Error(error.message);
            return (data ?? []) as PendingTransaction[];
        },
    });

    const review = useMutation({
        mutationFn: (args: { id: string; action: ReviewAction; patch?: Record<string, unknown> }) =>
            invokeFn("review-transaction", {
                transactionId: args.id,
                action: args.action,
                patch: args.patch,
            }),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["pending-review"] });
            qc.invalidateQueries({ queryKey: ["transactions"] });
        },
    });

    if (pending.isLoading) return <p className="text-sm text-slate-400">Loading inbox…</p>;
    if (pending.isError) {
        return <p className="text-sm text-rose-400">{(pending.error as Error).message}</p>;
    }

    const rows = pending.data ?? [];

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold">Inbox</h1>
            <p className="mb-6 text-sm text-slate-400">
                {rows.length === 0
                    ? "Nothing waiting for review."
                    : `${rows.length} transaction${rows.length === 1 ? "" : "s"} awaiting review.`}
            </p>

            {review.isError && (
                <p className="mb-4 text-sm text-rose-400">{(review.error as Error).message}</p>
            )}

            <div className="flex flex-col gap-3">
                {rows.map((tx) => (
                    <InboxCard
                        key={tx.id}
                        tx={tx}
                        busy={review.isPending}
                        onAction={(action, patch) => review.mutate({ id: tx.id, action, patch })}
                    />
                ))}
            </div>
        </div>
    );
}

function InboxCard({
    tx,
    busy,
    onAction,
}: {
    tx: PendingTransaction;
    busy: boolean;
    onAction: (action: ReviewAction, patch?: Record<string, unknown>) => void;
}) {
    const [editing, setEditing] = useState(false);

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-100">{tx.payee ?? "(no payee)"}</span>
                        {tx.category_name && (
                            <span
                                className="rounded px-2 py-0.5 text-xs"
                                style={{
                                    backgroundColor: `${tx.category_color ?? "#64748b"}26`,
                                    color: tx.category_color ?? "#94a3b8",
                                }}
                            >
                                {tx.category_icon} {tx.category_name}
                            </span>
                        )}
                        {tx.duplicate_group_id && (
                            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                                ⚠ possible duplicate
                            </span>
                        )}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                        {fmtDateTime(tx.occurred_at)} · {tx.kind}
                        {tx.media_kind ? ` · via ${tx.media_kind}` : ""}
                        {tx.memo ? ` · ${tx.memo}` : ""}
                    </div>
                </div>
                <div
                    className={`shrink-0 text-right font-semibold ${
                        tx.kind === "income" ? "text-emerald-400" : "text-slate-100"
                    }`}
                >
                    {tx.kind === "expense" ? "−" : tx.kind === "income" ? "+" : ""}
                    {fmtMoney(tx.amount, tx.currency)}
                </div>
            </div>

            {editing ? (
                <EditForm
                    tx={tx}
                    busy={busy}
                    onCancel={() => setEditing(false)}
                    onSave={(patch) => {
                        onAction("edit", patch);
                        setEditing(false);
                    }}
                />
            ) : (
                <div className="mt-3 flex gap-2">
                    <button className={acceptCls} disabled={busy} onClick={() => onAction("accept")}>
                        Accept
                    </button>
                    <button className={neutralCls} disabled={busy} onClick={() => setEditing(true)}>
                        Edit
                    </button>
                    <button className={rejectCls} disabled={busy} onClick={() => onAction("reject")}>
                        Reject
                    </button>
                </div>
            )}
        </div>
    );
}

function EditForm({
    tx,
    busy,
    onSave,
    onCancel,
}: {
    tx: PendingTransaction;
    busy: boolean;
    onSave: (patch: Record<string, unknown>) => void;
    onCancel: () => void;
}) {
    const [payee, setPayee] = useState(tx.payee ?? "");
    const [amount, setAmount] = useState(String(tx.amount));
    const [currency, setCurrency] = useState(tx.currency);
    const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
    const [memo, setMemo] = useState(tx.memo ?? "");

    const taxonomy = useQuery({
        queryKey: ["taxonomy"],
        queryFn: fetchTaxonomy,
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        onSave({
            payee: payee.trim() || null,
            amount: Number(amount),
            currency: currency.trim().toUpperCase(),
            category_id: categoryId || null,
            memo: memo.trim() || null,
        });
    }

    return (
        <form onSubmit={submit} className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <input className={inputCls} value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="payee" />
            <div className="flex gap-2">
                <input
                    className={`${inputCls} flex-1`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    type="number"
                    step="0.01"
                    min="0"
                    required
                />
                <input
                    className={`${inputCls} w-20`}
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    maxLength={3}
                    required
                />
            </div>
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
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
            <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="memo" />
            <div className="col-span-2 flex gap-2">
                <button className={acceptCls} disabled={busy}>
                    Save & accept
                </button>
                <button type="button" className={neutralCls} onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </form>
    );
}

export interface GroupWithCategories extends CategoryGroup {
    categories: Category[];
}

/** Groups (sorted) with their categories; parents listed before children. */
export async function fetchTaxonomy(): Promise<GroupWithCategories[]> {
    const sb = requireSupabase();
    const [groupsRes, catsRes] = await Promise.all([
        sb.from("category_groups").select("*").order("sort_order"),
        sb.from("categories").select("*").order("name"),
    ]);
    if (groupsRes.error) throw new Error(groupsRes.error.message);
    if (catsRes.error) throw new Error(catsRes.error.message);

    const groups = (groupsRes.data ?? []) as CategoryGroup[];
    const cats = (catsRes.data ?? []) as Category[];

    const orderWithinGroup = (list: Category[]) => {
        const parents = list.filter((c) => !c.parent_id);
        const ordered: Category[] = [];
        for (const p of parents) {
            ordered.push(p, ...list.filter((c) => c.parent_id === p.id));
        }
        // Children whose parent sits in another group still need listing.
        ordered.push(...list.filter((c) => c.parent_id && !ordered.includes(c)));
        return ordered;
    };

    const result: GroupWithCategories[] = groups.map((g) => ({
        ...g,
        categories: orderWithinGroup(cats.filter((c) => c.group_id === g.id)),
    }));

    const ungrouped = cats.filter((c) => !c.group_id);
    if (ungrouped.length) {
        result.push({
            id: "__ungrouped__",
            name: "Ungrouped",
            icon: null,
            color: null,
            sort_order: 999,
            categories: orderWithinGroup(ungrouped),
        });
    }
    return result;
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-emerald-500";
const acceptCls =
    "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50";
const rejectCls =
    "rounded-lg bg-rose-900/60 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-900 disabled:opacity-50";
const neutralCls =
    "rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50";
