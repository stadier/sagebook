import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fmtDate, fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import { fetchAccounts, fetchTaxonomy } from "../lib/taxonomy";
import type { Recurrence, ScheduledTransaction } from "../lib/types";

async function fetchScheduled(): Promise<ScheduledTransaction[]> {
    const { data, error } = await requireSupabase()
        .from("scheduled_transactions")
        .select("*")
        .order("next_due");
    if (error) throw new Error(error.message);
    return (data ?? []) as ScheduledTransaction[];
}

/** Human label for a scheduled item's flavour. */
function flavour(s: ScheduledTransaction): string {
    if (s.schedule_kind === "recurring") {
        return `${s.kind === "income" ? "Recurring income" : "Recurring payment"} · ${s.recurrence}`;
    }
    return s.kind === "income" ? "Owed to me (receivable)" : "I owe (payable)";
}

export default function Scheduled() {
    const qc = useQueryClient();
    const scheduled = useQuery({ queryKey: ["scheduled"], queryFn: fetchScheduled });
    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

    const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));

    function invalidate() {
        qc.invalidateQueries({ queryKey: ["scheduled"] });
        qc.invalidateQueries({ queryKey: ["pending-review"] });
    }

    // "Check now" — posts anything already due into the inbox.
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

    const toggle = useMutation({
        mutationFn: async (args: { id: string; active: boolean }) => {
            const { error } = await requireSupabase()
                .from("scheduled_transactions")
                .update({ active: args.active })
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled"] }),
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase()
                .from("scheduled_transactions")
                .delete()
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduled"] }),
    });

    const rows = scheduled.data ?? [];
    const recurring = rows.filter((s) => s.schedule_kind === "recurring");
    const receivables = rows.filter((s) => s.schedule_kind === "one_off" && s.kind === "income");
    const payables = rows.filter((s) => s.schedule_kind === "one_off" && s.kind === "expense");
    const dueCount = rows.filter((s) => s.active && s.next_due <= new Date().toISOString().slice(0, 10)).length;

    function Section({ title, items }: { title: string; items: ScheduledTransaction[] }) {
        if (items.length === 0) return null;
        return (
            <div className="mb-6">
                <h2 className="mb-2 text-sm font-semibold text-slate-300">{title}</h2>
                <div className="flex flex-col gap-2">
                    {items.map((s) => {
                        const due = s.active && s.next_due <= new Date().toISOString().slice(0, 10);
                        return (
                            <div
                                key={s.id}
                                className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
                                    s.active ? "border-slate-800 bg-slate-900/60" : "border-slate-800 bg-slate-900/30 opacity-60"
                                }`}
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                                        {s.name}
                                        {due && (
                                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-normal text-amber-300">
                                                due
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                        {flavour(s)} · next {fmtDate(s.next_due)}
                                        {s.account_id && accountName.has(s.account_id)
                                            ? ` · ${accountName.get(s.account_id)}`
                                            : ""}
                                        {s.payee ? ` · ${s.payee}` : ""}
                                    </div>
                                </div>
                                <div
                                    className={`text-sm font-semibold ${
                                        s.kind === "income" ? "text-emerald-400" : "text-slate-100"
                                    }`}
                                >
                                    {s.kind === "income" ? "+" : "−"}
                                    {fmtMoney(Number(s.amount), s.currency)}
                                </div>
                                <div className="flex items-center gap-2 text-xs">
                                    <button
                                        className="rounded bg-emerald-600/80 px-2 py-1 text-white hover:bg-emerald-500 disabled:opacity-50"
                                        disabled={postNow.isPending || !s.active}
                                        title="Post this into the inbox right now"
                                        onClick={() => postNow.mutate(s.id)}
                                    >
                                        Post now
                                    </button>
                                    <button
                                        className="text-slate-500 hover:text-slate-300"
                                        onClick={() => toggle.mutate({ id: s.id, active: !s.active })}
                                    >
                                        {s.active ? "Pause" : "Resume"}
                                    </button>
                                    <button
                                        className="text-slate-600 hover:text-rose-400"
                                        onClick={() => {
                                            if (window.confirm(`Delete scheduled item "${s.name}"?`)) remove.mutate(s.id);
                                        }}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-1 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Scheduled</h1>
                <button
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate()}
                >
                    {runNow.isPending ? "Checking…" : "Check for due items"}
                </button>
            </div>
            <p className="mb-6 text-sm text-slate-400">
                Money you expect to move — salary and bills that repeat, or one-off amounts
                you're owed or owe. On its date each one drops into your inbox to confirm.
                {dueCount > 0 && (
                    <span className="ml-1 text-amber-400">{dueCount} due now.</span>
                )}
            </p>

            {runNow.isSuccess && (
                <p className="mb-4 text-sm text-emerald-400">
                    Posted {runNow.data} item{runNow.data === 1 ? "" : "s"} to your inbox.
                </p>
            )}
            {(runNow.isError || postNow.isError) && (
                <p className="mb-4 text-sm text-rose-400">
                    {((runNow.error ?? postNow.error) as Error).message}
                </p>
            )}

            <CreateScheduledForm />

            {scheduled.isLoading && <p className="mt-6 text-sm text-slate-400">Loading…</p>}
            {scheduled.isSuccess && rows.length === 0 && (
                <p className="mt-6 text-sm text-slate-500">Nothing scheduled yet.</p>
            )}

            <div className="mt-6">
                <Section title="Recurring" items={recurring} />
                <Section title="Owed to me" items={receivables} />
                <Section title="I owe" items={payables} />
            </div>
        </div>
    );
}

function CreateScheduledForm() {
    const qc = useQueryClient();
    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });

    const [name, setName] = useState("");
    const [kind, setKind] = useState<"income" | "expense">("income");
    const [scheduleKind, setScheduleKind] = useState<"recurring" | "one_off">("recurring");
    const [recurrence, setRecurrence] = useState<Recurrence>("monthly");
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState("NGN");
    const [accountId, setAccountId] = useState("");
    const [categoryId, setCategoryId] = useState("");
    const [payee, setPayee] = useState("");
    const [nextDue, setNextDue] = useState(new Date().toISOString().slice(0, 10));

    const create = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            const { data: u } = await sb.auth.getUser();
            if (!u.user) throw new Error("not signed in");
            const { error } = await sb.from("scheduled_transactions").insert({
                user_id: u.user.id,
                name: name.trim(),
                kind,
                schedule_kind: scheduleKind,
                recurrence: scheduleKind === "recurring" ? recurrence : null,
                amount: Number(amount),
                currency: currency.trim().toUpperCase(),
                account_id: accountId || null,
                category_id: categoryId || null,
                payee: payee.trim() || null,
                next_due: nextDue,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setName("");
            setAmount("");
            setPayee("");
            qc.invalidateQueries({ queryKey: ["scheduled"] });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim() && Number(amount) > 0) create.mutate();
    }

    const oneOffLabel = kind === "income" ? "someone will pay me" : "I owe someone";

    return (
        <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New scheduled item</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <input
                    className={inputCls}
                    placeholder="Name, e.g. Monthly salary"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as "income" | "expense")}>
                    <option value="income">Money in (income)</option>
                    <option value="expense">Money out (expense)</option>
                </select>
                <select
                    className={inputCls}
                    value={scheduleKind}
                    onChange={(e) => setScheduleKind(e.target.value as "recurring" | "one_off")}
                >
                    <option value="recurring">Repeats</option>
                    <option value="one_off">One-off ({oneOffLabel})</option>
                </select>
                {scheduleKind === "recurring" ? (
                    <select className={inputCls} value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Every 2 weeks</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="yearly">Yearly</option>
                    </select>
                ) : (
                    <div />
                )}
                <div className="flex gap-2">
                    <input
                        className={`${inputCls} min-w-0 flex-1`}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                    />
                    <input
                        className={`${inputCls} w-20`}
                        value={currency}
                        maxLength={3}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                        required
                    />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                    {scheduleKind === "recurring" ? "First/next date" : "Due date"}
                    <input
                        className={`${inputCls} flex-1`}
                        type="date"
                        value={nextDue}
                        onChange={(e) => setNextDue(e.target.value)}
                        required
                    />
                </label>
                <select className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    <option value="">Account… (optional)</option>
                    {(accounts.data ?? [])
                        .filter((a) => !a.is_archived)
                        .map((a) => (
                            <option key={a.id} value={a.id}>
                                {a.name} ({a.currency})
                            </option>
                        ))}
                </select>
                <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Category… (optional)</option>
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
                <input
                    className={`${inputCls} sm:col-span-2`}
                    placeholder="Payee / counterparty (optional), e.g. Acme Ltd"
                    value={payee}
                    onChange={(e) => setPayee(e.target.value)}
                />
            </div>
            <button
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={create.isPending || !name.trim() || !(Number(amount) > 0)}
            >
                {create.isPending ? "Saving…" : "Add scheduled item"}
            </button>
            {create.isError && (
                <p className="mt-2 text-xs text-rose-400">{(create.error as Error).message}</p>
            )}
        </form>
    );
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500";
