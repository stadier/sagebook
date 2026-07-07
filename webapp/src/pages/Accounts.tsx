import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import { fetchAccounts } from "../lib/taxonomy";
import type { AccountType } from "../lib/types";

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

    const accounts = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });

    const setArchived = useMutation({
        mutationFn: async (args: { id: string; archived: boolean }) => {
            const { error } = await requireSupabase()
                .from("accounts")
                .update({ is_archived: args.archived })
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["accounts"] }),
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
                        className={`flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 ${
                            a.is_archived ? "opacity-50" : ""
                        }`}
                    >
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-100">{a.name}</div>
                            <div className="text-xs text-slate-500">
                                {ACCOUNT_TYPES.find((t) => t.value === a.type)?.label ?? a.type}
                                {a.institution ? ` · ${a.institution}` : ""}
                            </div>
                        </div>
                        <div className="text-sm text-slate-300">
                            {fmtMoney(Number(a.opening_balance), a.currency)}
                            <span className="ml-1 text-xs text-slate-600">opening</span>
                        </div>
                        <button
                            className="text-xs text-slate-500 hover:text-slate-300"
                            disabled={setArchived.isPending}
                            onClick={() => setArchived.mutate({ id: a.id, archived: !a.is_archived })}
                        >
                            {a.is_archived ? "Unarchive" : "Archive"}
                        </button>
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
