import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { invokeFn, requireSupabase } from "../lib/supabase";
import { fetchAccounts, fetchTaxonomy } from "../lib/taxonomy";
import type { Account, PendingTransaction } from "../lib/types";

type ReviewAction = "accept" | "reject" | "edit";

const LAST_ACCOUNT_KEY = "sagebook.webapp.lastAccount";

export default function Inbox() {
    const qc = useQueryClient();
    const [selected, setSelected] = useState<Set<string>>(new Set());

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

    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
    const activeAccounts = (accounts.data ?? []).filter((a) => !a.is_archived);

    function invalidate() {
        qc.invalidateQueries({ queryKey: ["pending-review"] });
        qc.invalidateQueries({ queryKey: ["transactions"] });
    }

    const review = useMutation({
        mutationFn: (args: { id: string; action: ReviewAction; patch?: Record<string, unknown> }) =>
            invokeFn("review-transaction", {
                transactionId: args.id,
                action: args.action,
                patch: args.patch,
            }),
        onSuccess: invalidate,
    });

    const bulk = useMutation({
        mutationFn: (args: { ids: string[]; action: "accept" | "reject" }) =>
            invokeFn("review-transaction/bulk", {
                transactionIds: args.ids,
                action: args.action,
            }),
        onSuccess: () => {
            setSelected(new Set());
            invalidate();
        },
    });

    if (pending.isLoading) return <p className="text-sm text-slate-400">Loading inbox…</p>;
    if (pending.isError) {
        return <p className="text-sm text-rose-400">{(pending.error as Error).message}</p>;
    }

    const rows = pending.data ?? [];
    const busy = review.isPending || bulk.isPending;

    function toggle(id: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold">Inbox</h1>
            <p className="mb-4 text-sm text-slate-400">
                {rows.length === 0
                    ? "Nothing waiting for review."
                    : `${rows.length} transaction${rows.length === 1 ? "" : "s"} awaiting review.`}
            </p>

            {rows.length > 0 && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm">
                    <label className="flex items-center gap-2 text-slate-400">
                        <input
                            type="checkbox"
                            checked={selected.size === rows.length}
                            onChange={(e) =>
                                setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
                            }
                        />
                        {selected.size > 0 ? `${selected.size} selected` : "Select all"}
                    </label>
                    {selected.size > 0 && (
                        <>
                            <button
                                className={acceptCls}
                                disabled={busy}
                                onClick={() => bulk.mutate({ ids: [...selected], action: "accept" })}
                            >
                                Accept selected
                            </button>
                            <button
                                className={rejectCls}
                                disabled={busy}
                                onClick={() => bulk.mutate({ ids: [...selected], action: "reject" })}
                            >
                                Reject selected
                            </button>
                            <span className="text-xs text-slate-500">
                                Bulk accept keeps each item's current account/category.
                            </span>
                        </>
                    )}
                </div>
            )}

            {(review.isError || bulk.isError) && (
                <p className="mb-4 text-sm text-rose-400">
                    {((review.error ?? bulk.error) as Error).message}
                </p>
            )}

            <div className="flex flex-col gap-3">
                {rows.map((tx) => (
                    <InboxCard
                        key={tx.id}
                        tx={tx}
                        busy={busy}
                        accounts={activeAccounts}
                        checked={selected.has(tx.id)}
                        onToggle={() => toggle(tx.id)}
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
    accounts,
    checked,
    onToggle,
    onAction,
}: {
    tx: PendingTransaction;
    busy: boolean;
    accounts: Account[];
    checked: boolean;
    onToggle: () => void;
    onAction: (action: ReviewAction, patch?: Record<string, unknown>) => void;
}) {
    const navigate = useNavigate();
    const [editing, setEditing] = useState(false);
    const [accountId, setAccountId] = useState(
        () => tx.account_id ?? localStorage.getItem(LAST_ACCOUNT_KEY) ?? "",
    );

    function accept() {
        if (accountId) {
            localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
            // "edit" applies the patch and accepts in one call.
            onAction("edit", { account_id: accountId });
        } else {
            onAction("accept");
        }
    }

    function createRule() {
        const params = new URLSearchParams();
        if (tx.payee) params.set("payee", tx.payee);
        if (tx.category_name) params.set("category", tx.category_name);
        navigate(`/rules?${params.toString()}`);
    }

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="flex items-start gap-3">
                <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} />
                <div className="min-w-0 flex-1">
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
                    accounts={accounts}
                    onCancel={() => setEditing(false)}
                    onSave={(patch) => {
                        onAction("edit", patch);
                        setEditing(false);
                    }}
                />
            ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                        className={`${inputCls} py-1.5`}
                        value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}
                        title="Account to file this under on accept"
                    >
                        <option value="">— no account —</option>
                        {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name} ({a.currency})
                            </option>
                        ))}
                    </select>
                    <button className={acceptCls} disabled={busy} onClick={accept}>
                        Accept
                    </button>
                    <button className={neutralCls} disabled={busy} onClick={() => setEditing(true)}>
                        Edit
                    </button>
                    <button className={rejectCls} disabled={busy} onClick={() => onAction("reject")}>
                        Reject
                    </button>
                    <button
                        className="ml-auto text-xs text-slate-500 hover:text-slate-300"
                        onClick={createRule}
                        title="Pre-fill a rule from this transaction"
                    >
                        + Rule
                    </button>
                </div>
            )}
        </div>
    );
}

function EditForm({
    tx,
    busy,
    accounts,
    onSave,
    onCancel,
}: {
    tx: PendingTransaction;
    busy: boolean;
    accounts: Account[];
    onSave: (patch: Record<string, unknown>) => void;
    onCancel: () => void;
}) {
    const [payee, setPayee] = useState(tx.payee ?? "");
    const [amount, setAmount] = useState(String(tx.amount));
    const [currency, setCurrency] = useState(tx.currency);
    const [categoryId, setCategoryId] = useState(tx.category_id ?? "");
    const [accountId, setAccountId] = useState(
        () => tx.account_id ?? localStorage.getItem(LAST_ACCOUNT_KEY) ?? "",
    );
    const [memo, setMemo] = useState(tx.memo ?? "");

    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (accountId) localStorage.setItem(LAST_ACCOUNT_KEY, accountId);
        onSave({
            payee: payee.trim() || null,
            amount: Number(amount),
            currency: currency.trim().toUpperCase(),
            category_id: categoryId || null,
            account_id: accountId || null,
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
            <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">— no account —</option>
                {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                        {a.name} ({a.currency})
                    </option>
                ))}
            </select>
            <input
                className={`${inputCls} col-span-2`}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="memo"
            />
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

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-emerald-500";
const acceptCls =
    "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50";
const rejectCls =
    "rounded-lg bg-rose-900/60 px-3 py-1.5 text-sm text-rose-200 hover:bg-rose-900 disabled:opacity-50";
const neutralCls =
    "rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50";
