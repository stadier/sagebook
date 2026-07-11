import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import type { AccountType, AccountWithBalance } from "../lib/types";

async function fetchAccountBalances(): Promise<AccountWithBalance[]> {
    const { data, error } = await requireSupabase()
        .from("v_account_balances")
        .select("*")
        .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []) as AccountWithBalance[];
}

const ACCOUNT_TYPES: Array<{ value: AccountType; label: string }> = [
    { value: "cash", label: "Cash" },
    { value: "checking", label: "Checking" },
    { value: "savings", label: "Savings" },
    { value: "credit_card", label: "Credit card" },
    { value: "loan", label: "Loan" },
    { value: "investment", label: "Investment" },
    { value: "retirement", label: "Retirement" },
    { value: "real_estate", label: "Real estate" },
    { value: "vehicle", label: "Vehicle" },
    { value: "crypto", label: "Crypto" },
    { value: "other_asset", label: "Other asset" },
    { value: "other_liability", label: "Other liability" },
];

export default function Accounts() {
    const qc = useQueryClient();
    const [showArchived, setShowArchived] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const accounts = useQuery({
        queryKey: ["account-balances"],
        queryFn: fetchAccountBalances,
    });

    const setArchived = useMutation({
        mutationFn: async (args: { id: string; archived: boolean }) => {
            const { error } = await requireSupabase()
                .from("accounts")
                .update({ is_archived: args.archived })
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["accounts"] });
            qc.invalidateQueries({ queryKey: ["account-balances"] });
        },
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const sb = requireSupabase();
            // account_id FK cascades on delete, so detach transactions first —
            // deleting an account should never silently wipe its history.
            const detach = await sb
                .from("transactions")
                .update({ account_id: null })
                .eq("account_id", id);
            if (detach.error) throw new Error(detach.error.message);
            const { error } = await sb.from("accounts").delete().eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries();
        },
    });

    const rows = (accounts.data ?? []).filter((a) => showArchived || !a.is_archived);

    return (
        <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-semibold">Accounts</h1>
                    <p className="text-sm text-slate-400">
                        Where transactions are filed on accept — the basis for balances and net worth.
                    </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-400">
                    <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                    />
                    Show archived
                </label>
            </div>

            {accounts.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            {accounts.isError && (
                <p className="text-sm text-rose-400">{(accounts.error as Error).message}</p>
            )}

            <div className="mb-6 flex flex-col gap-2">
                {rows.map((a) => (
                    <div
                        key={a.id}
                        className={`rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 ${
                            a.is_archived ? "opacity-50" : ""
                        }`}
                    >
                    {editingId === a.id ? (
                        <EditAccountForm
                            account={a}
                            onDone={() => setEditingId(null)}
                        />
                    ) : (
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                                {a.name}
                                {a.metadata?.auto_balance && (
                                    <span
                                        className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-normal text-sky-300"
                                        title="Opening balance is inferred from observed activity (a debit implies the funds were there). Set an opening balance manually to take over."
                                    >
                                        inferred balance
                                    </span>
                                )}
                            </div>
                            <div className="text-xs text-slate-500">
                                {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label ?? a.type}
                                {a.institution ? ` · ${a.institution}` : ""}
                                {a.metadata?.number_masked ? ` · ${a.metadata.number_masked}` : ""}
                            </div>
                        </div>
                        <div className="text-right text-sm">
                            <div className="font-medium text-slate-100">
                                {fmtMoney(Number(a.current_balance), a.currency)}
                            </div>
                            <div className="text-xs text-slate-600">
                                opened at {fmtMoney(Number(a.opening_balance), a.currency)}
                            </div>
                        </div>
                        <button
                            className="text-xs text-slate-500 hover:text-slate-300"
                            onClick={() => setEditingId(a.id)}
                        >
                            Edit
                        </button>
                        <button
                            className="text-xs text-slate-500 hover:text-slate-300"
                            disabled={setArchived.isPending}
                            onClick={() => setArchived.mutate({ id: a.id, archived: !a.is_archived })}
                        >
                            {a.is_archived ? "Unarchive" : "Archive"}
                        </button>
                        <button
                            className="text-xs text-rose-400 hover:text-rose-300"
                            disabled={remove.isPending}
                            title="Permanently delete this account; its transactions are kept but unlinked"
                            onClick={() => {
                                if (
                                    window.confirm(
                                        `Permanently delete "${a.name}"? Its transactions are kept but will no longer be filed under any account. This cannot be undone.`,
                                    )
                                ) {
                                    remove.mutate(a.id);
                                }
                            }}
                        >
                            {remove.isPending ? "Deleting…" : "Delete"}
                        </button>
                    </div>
                    )}
                    </div>
                ))}
                {accounts.isSuccess && rows.length === 0 && (
                    <p className="text-sm text-slate-500">No accounts yet — create your first below.</p>
                )}
            </div>

            <CreateAccountForm />
        </div>
    );
}

function EditAccountForm({
    account,
    onDone,
}: {
    account: AccountWithBalance;
    onDone: () => void;
}) {
    const qc = useQueryClient();
    const [name, setName] = useState(account.name);
    const [type, setType] = useState<AccountType>(account.type);
    const [currency, setCurrency] = useState(account.currency);
    const [institution, setInstitution] = useState(account.institution ?? "");
    const [openingBalance, setOpeningBalance] = useState(String(account.opening_balance));

    const save = useMutation({
        mutationFn: async () => {
            const patch: Record<string, unknown> = {
                name: name.trim(),
                type,
                currency: currency.trim().toUpperCase(),
                institution: institution.trim() || null,
                opening_balance: Number(openingBalance) || 0,
            };
            // A manually set opening balance takes over from inference.
            if (
                account.metadata?.auto_balance &&
                Number(openingBalance) !== Number(account.opening_balance)
            ) {
                patch.metadata = { ...account.metadata, auto_balance: false };
            }
            const { error } = await requireSupabase()
                .from("accounts")
                .update(patch)
                .eq("id", account.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            onDone();
            qc.invalidateQueries(); // balances, pickers, net worth all depend on accounts
        },
    });

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) save.mutate();
            }}
            className="grid gap-2 sm:grid-cols-2"
        >
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                        {t.label}
                    </option>
                ))}
            </select>
            <input
                className={inputCls}
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value)}
                required
            />
            <input
                className={inputCls}
                placeholder="Institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-slate-500">
                Opening balance
                <input
                    className={`${inputCls} flex-1`}
                    type="number"
                    step="0.01"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                />
            </label>
            <div className="flex items-center gap-2">
                <button
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    disabled={save.isPending || !name.trim()}
                >
                    {save.isPending ? "Saving…" : "Save"}
                </button>
                <button
                    type="button"
                    className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                    onClick={onDone}
                >
                    Cancel
                </button>
            </div>
            {account.metadata?.auto_balance && (
                <p className="text-xs text-sky-300/70 sm:col-span-2">
                    This account's opening balance is currently inferred from activity.
                    Changing it here switches to your manual value permanently.
                </p>
            )}
            {save.isError && (
                <p className="text-xs text-rose-400 sm:col-span-2">{(save.error as Error).message}</p>
            )}
        </form>
    );
}

function CreateAccountForm() {
    const qc = useQueryClient();
    const [name, setName] = useState("");
    const [type, setType] = useState<AccountType>("checking");
    const [currency, setCurrency] = useState("USD");
    const [institution, setInstitution] = useState("");
    const [openingBalance, setOpeningBalance] = useState("0");

    const create = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            const { data: userData, error: userErr } = await sb.auth.getUser();
            if (userErr || !userData.user) throw new Error("not signed in");
            const { error } = await sb.from("accounts").insert({
                user_id: userData.user.id,
                name: name.trim(),
                type,
                currency: currency.trim().toUpperCase(),
                institution: institution.trim() || null,
                opening_balance: Number(openingBalance) || 0,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setName("");
            setInstitution("");
            setOpeningBalance("0");
            qc.invalidateQueries({ queryKey: ["accounts"] });
            qc.invalidateQueries({ queryKey: ["account-balances"] });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim()) create.mutate();
    }

    return (
        <form
            onSubmit={submit}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New account</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <input
                    className={inputCls}
                    placeholder="Name, e.g. GTBank Current"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <select
                    className={inputCls}
                    value={type}
                    onChange={(e) => setType(e.target.value as AccountType)}
                >
                    {ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                            {t.label}
                        </option>
                    ))}
                </select>
                <input
                    className={inputCls}
                    placeholder="Currency (ISO), e.g. NGN"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    maxLength={3}
                    required
                />
                <input
                    className={inputCls}
                    placeholder="Institution (optional)"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                />
                <input
                    className={inputCls}
                    type="number"
                    step="0.01"
                    placeholder="Opening balance"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                />
                <button
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    disabled={create.isPending || !name.trim()}
                >
                    {create.isPending ? "Creating…" : "Create account"}
                </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
                Note: the currency must exist in the currencies table (majors plus NGN,
                ZAR, KES, GHS, INR, AED and more are seeded by the migrations).
            </p>
            {create.isError && (
                <p className="mt-2 text-xs text-rose-400">{(create.error as Error).message}</p>
            )}
        </form>
    );
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500";
