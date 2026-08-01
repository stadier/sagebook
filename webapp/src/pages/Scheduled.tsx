import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useMemo, useState } from "react";
import { useConfirm } from "../components/Confirm";
import DataTable, { type Column, type RowAction } from "../components/DataTable";
import { PauseIcon, PlayIcon, SendIcon, TrashIcon } from "../components/icons";
import { Field, Input, PageHeader, Picker, Pill, QueryError } from "../components/ui";
import { DEFAULT_CURRENCY } from "../lib/constants";
import { fmtDate, fmtMoney } from "../lib/format";
import { pairOptions } from "../lib/options";
import {
    QK,
    useAccountOptions,
    useAccounts,
    useCategoryOptions,
    useScheduled,
} from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import type { Recurrence, ScheduledTransaction } from "../lib/types";

/** Human label for a scheduled item's flavour. */
function flavour(s: ScheduledTransaction): string {
    if (s.schedule_kind === "recurring") {
        return `${s.kind === "income" ? "Recurring income" : "Recurring payment"} · ${s.recurrence}`;
    }
    return s.kind === "income" ? "Owed to me (receivable)" : "I owe (payable)";
}

/** The three buckets the page used to split into separate sections. */
const GROUPS = [
    { value: "recurring", label: "Recurring" },
    { value: "receivable", label: "Owed to me" },
    { value: "payable", label: "I owe" },
] as const;

const GROUP_OPTIONS = pairOptions(GROUPS);

/* The form's fixed choices. Written once at module scope so the picker's
   options array is referentially stable across renders. */
const KIND_OPTIONS = pairOptions([
    { value: "income", label: "Money in (income)" },
    { value: "expense", label: "Money out (expense)" },
] as const);

const RECURRENCE_OPTIONS = pairOptions([
    { value: "weekly", label: "Weekly" },
    { value: "biweekly", label: "Every 2 weeks" },
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "yearly", label: "Yearly" },
] as const);

function groupOf(s: ScheduledTransaction): (typeof GROUPS)[number]["value"] {
    if (s.schedule_kind === "recurring") return "recurring";
    return s.kind === "income" ? "receivable" : "payable";
}

function isDue(s: ScheduledTransaction): boolean {
    return s.active && s.next_due <= new Date().toISOString().slice(0, 10);
}

export default function Scheduled() {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [group, setGroup] = useState("");
    const [dueOnly, setDueOnly] = useState(false);
    const scheduled = useScheduled();
    const accounts = useAccounts();

    const accountName = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));

    function invalidate() {
        qc.invalidateQueries({ queryKey: QK.scheduled });
        qc.invalidateQueries({ queryKey: QK.pendingReview });
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

    const all = scheduled.data ?? [];
    const rows = all.filter(
        (s) => (!group || groupOf(s) === group) && (!dueOnly || isDue(s)),
    );
    const dueCount = all.filter(isDue).length;
    const activeFilterCount = (group ? 1 : 0) + (dueOnly ? 1 : 0);

    const columns: Array<Column<ScheduledTransaction>> = [
        {
            id: "name",
            label: "Item",
            hideable: false,
            mobile: "title",
            sortValue: (s) => s.name,
            searchValue: (s) => `${s.name} ${s.payee ?? ""} ${flavour(s)}`,
            cell: (s) => (
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[0.875rem] font-semibold text-slate-100">
                        <span className="truncate">{s.name}</span>
                        {isDue(s) && <Pill tint="amber">due</Pill>}
                        {!s.active && <Pill>paused</Pill>}
                    </div>
                    {s.payee && <div className="truncate text-xs text-slate-500">{s.payee}</div>}
                </div>
            ),
        },
        {
            id: "flavour",
            label: "Type",
            width: "14rem",
            sortValue: (s) => flavour(s),
            cell: (s) => <span className="text-[0.8125rem] text-slate-400">{flavour(s)}</span>,
        },
        {
            id: "next_due",
            label: "Next due",
            width: "10rem",
            sortValue: (s) => s.next_due,
            searchValue: (s) => fmtDate(s.next_due),
            cell: (s) => (
                <span
                    className={`whitespace-nowrap text-[0.8125rem] ${
                        isDue(s) ? "font-semibold text-amber-400" : "text-slate-400"
                    }`}
                >
                    {fmtDate(s.next_due)}
                </span>
            ),
        },
        {
            id: "account",
            label: "Account",
            width: "11rem",
            defaultHidden: true,
            sortValue: (s) => (s.account_id ? (accountName.get(s.account_id) ?? "") : ""),
            cell: (s) => (
                <span className="text-[0.8125rem] text-slate-400">
                    {(s.account_id && accountName.get(s.account_id)) || "—"}
                </span>
            ),
        },
        {
            id: "amount",
            label: "Amount",
            align: "right",
            width: "10rem",
            hideable: false,
            mobile: "trailing",
            sortValue: (s) => (s.kind === "income" ? 1 : -1) * Number(s.amount),
            cell: (s) => (
                <span
                    className={`whitespace-nowrap font-bold tnum ${
                        s.kind === "income" ? "text-emerald-400" : "text-slate-100"
                    }`}
                >
                    {s.kind === "income" ? "+" : "−"}
                    {fmtMoney(Number(s.amount), s.currency)}
                </span>
            ),
        },
    ];

    return (
        <>
            <PageHeader
                title="Scheduled"
                subtitle={
                    <>
                        Money you expect to move — salary and bills that repeat, or one-off amounts
                        you're owed or owe. On its date each one drops into your inbox to confirm.
                        {dueCount > 0 && (
                            <span className="ml-1 font-semibold text-amber-400">
                                {dueCount} due now.
                            </span>
                        )}
                    </>
                }
            >
                <button
                    className="sb-btn sb-btn-primary"
                    disabled={runNow.isPending}
                    onClick={() => runNow.mutate()}
                >
                    {runNow.isPending ? "Checking…" : "Check for due items"}
                </button>
            </PageHeader>

            {runNow.isSuccess && (
                <p className="text-sm text-emerald-400">
                    Posted {runNow.data} item{runNow.data === 1 ? "" : "s"} to your inbox.
                </p>
            )}
            <QueryError error={runNow.error ?? postNow.error} />

            <CreateScheduledForm />

            <QueryError error={scheduled.error ?? toggle.error ?? remove.error} />

            <DataTable
                storageKey="scheduled"
                data={rows}
                columns={columns}
                rowId={(s) => s.id}
                loading={scheduled.isLoading}
                rowNoun="item"
                searchPlaceholder="Search name, payee, type…"
                exportFilename="sagebook-scheduled"
                initialSort={{ columnId: "next_due", direction: "asc" }}
                activeFilterCount={activeFilterCount}
                onClearFilters={() => {
                    setGroup("");
                    setDueOnly(false);
                }}
                filters={
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Kind">
                            <Picker
                                options={GROUP_OPTIONS}
                                value={group}
                                onChange={setGroup}
                                placeholder="Everything"
                                title="Kind"
                                clearable
                            />
                        </Field>
                        <Field label="Due">
                            <label className="flex items-center gap-2 py-2 text-[0.8125rem] text-slate-400">
                                <input
                                    type="checkbox"
                                    className="sb-check"
                                    checked={dueOnly}
                                    onChange={(e) => setDueOnly(e.target.checked)}
                                />
                                Only items due now
                            </label>
                        </Field>
                    </div>
                }
                rowClassName={(s) => (s.active ? "" : "opacity-60")}
                rowLabel={(s) => s.name}
                rowActions={(s): RowAction[] => [
                    {
                        label: "Post to inbox now",
                        icon: <SendIcon />,
                        hint: "Skips the wait",
                        disabled: postNow.isPending || !s.active,
                        onSelect: () => postNow.mutate(s.id),
                    },
                    {
                        label: s.active ? "Pause" : "Resume",
                        icon: s.active ? <PauseIcon /> : <PlayIcon />,
                        onSelect: () => toggle.mutate({ id: s.id, active: !s.active }),
                    },
                    {
                        label: "Delete…",
                        icon: <TrashIcon />,
                        danger: true,
                        onSelect: () =>
                            confirm({
                                title: `Delete "${s.name}"?`,
                                body: "The schedule goes for good. Anything it has already posted into your inbox or ledger stays where it is.",
                                confirmLabel: "Delete permanently",
                                danger: true,
                                // Pausing is the reversible version of "stop this".
                                alternative: s.active
                                    ? {
                                          label: "Pause instead",
                                          hint: "Pausing keeps the schedule and stops it posting.",
                                          onSelect: () =>
                                              toggle.mutate({ id: s.id, active: false }),
                                      }
                                    : undefined,
                                onConfirm: () => remove.mutate(s.id),
                            }),
                    },
                ]}
                emptyTitle="Nothing scheduled yet"
                emptyBody="Add salary, bills, or a one-off you owe above — each drops into your inbox on its date."
            />
        </>
    );
}

function CreateScheduledForm() {
    const qc = useQueryClient();
    const accountOpts = useAccountOptions({ showCurrency: true });
    const categoryOpts = useCategoryOptions();

    const [name, setName] = useState("");
    const [kind, setKind] = useState<"income" | "expense">("income");
    const [scheduleKind, setScheduleKind] = useState<"recurring" | "one_off">("recurring");
    const [recurrence, setRecurrence] = useState<Recurrence>("monthly");
    const [amount, setAmount] = useState("");
    const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
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
            qc.invalidateQueries({ queryKey: QK.scheduled });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim() && Number(amount) > 0) create.mutate();
    }

    const oneOffLabel = kind === "income" ? "someone will pay me" : "I owe someone";
    // The one-off row explains itself differently for money in and money out.
    const scheduleKindOptions = useMemo(
        () =>
            pairOptions([
                { value: "recurring", label: "Repeats" },
                { value: "one_off", label: `One-off (${oneOffLabel})` },
            ] as const),
        [oneOffLabel],
    );

    return (
        <form onSubmit={submit} className="sb-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New scheduled item</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <Input
                    placeholder="Name, e.g. Monthly salary"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <Picker
                    options={KIND_OPTIONS}
                    value={kind}
                    onChange={setKind}
                    title="Direction"
                />
                <Picker
                    options={scheduleKindOptions}
                    value={scheduleKind}
                    onChange={setScheduleKind}
                    title="Schedule"
                />
                {scheduleKind === "recurring" ? (
                    <Picker
                        options={RECURRENCE_OPTIONS}
                        value={recurrence}
                        onChange={setRecurrence}
                        title="How often"
                    />
                ) : (
                    <div />
                )}
                <div className="flex gap-2">
                    <Input
                        className="min-w-0 flex-1"
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                    />
                    <Input
                        className="w-20"
                        value={currency}
                        maxLength={3}
                        onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                        required
                    />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                    {scheduleKind === "recurring" ? "First/next date" : "Due date"}
                    <Input
                        className="flex-1"
                        type="date"
                        value={nextDue}
                        onChange={(e) => setNextDue(e.target.value)}
                        required
                    />
                </label>
                <Picker
                    options={accountOpts}
                    value={accountId}
                    onChange={setAccountId}
                    placeholder="Account… (optional)"
                    title="Account"
                    clearable
                />
                <Picker
                    options={categoryOpts}
                    value={categoryId}
                    onChange={setCategoryId}
                    placeholder="Category… (optional)"
                    title="Category"
                    clearable
                />
                <Input
                    className="sm:col-span-2"
                    placeholder="Payee / counterparty (optional), e.g. Acme Ltd"
                    value={payee}
                    onChange={(e) => setPayee(e.target.value)}
                />
            </div>
            <button
                className="sb-btn sb-btn-primary mt-3"
                disabled={create.isPending || !name.trim() || !(Number(amount) > 0)}
            >
                {create.isPending ? "Saving…" : "Add scheduled item"}
            </button>
            <div className="mt-2">
                <QueryError error={create.error} />
            </div>
        </form>
    );
}

