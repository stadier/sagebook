import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
    Avatar,
    Card,
    Input,
    PageHeader,
    Pill,
    QueryError,
    Select,
    SectionLabel,
    StatCard,
    tintFor,
} from "../components/ui";
import {
    ACCOUNT_SECTIONS,
    ACCOUNT_TYPES,
    accountTypeLabel,
    DEFAULT_CURRENCY,
} from "../lib/constants";
import { fmtMoney } from "../lib/format";
import { QK, useAccountBalances } from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import type { AccountType, AccountWithBalance } from "../lib/types";

export default function Accounts() {
    const qc = useQueryClient();
    const [showArchived, setShowArchived] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const accounts = useAccountBalances();

    const setArchived = useMutation({
        mutationFn: async (args: { id: string; archived: boolean }) => {
            const { error } = await requireSupabase()
                .from("accounts")
                .update({ is_archived: args.archived })
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: QK.accounts });
            qc.invalidateQueries({ queryKey: QK.accountBalances });
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

    // Fold one account into another — all transactions and scheduled items move.
    const merge = useMutation({
        mutationFn: async (args: { source: string; target: string }) => {
            const { error } = await requireSupabase().rpc("merge_accounts", {
                p_source: args.source,
                p_target: args.target,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries(),
    });

    const rows = (accounts.data ?? []).filter((a) => showArchived || !a.is_archived);
    const allActive = (accounts.data ?? []).filter((a) => !a.is_archived);

    // The design stacks accounts by asset class, each class its own card.
    const sections = ACCOUNT_SECTIONS.map((s) => ({
        ...s,
        accounts: rows.filter((a) => s.types.includes(a.type)),
    })).filter((s) => s.accounts.length > 0);

    const assets = allActive.reduce((s, a) => s + Math.max(0, Number(a.current_balance)), 0);
    const liabilities = allActive.reduce((s, a) => s + Math.min(0, Number(a.current_balance)), 0);
    const baseCurrency = allActive[0]?.currency ?? DEFAULT_CURRENCY;

    return (
        <>
            <PageHeader
                title="Accounts"
                subtitle={`${allActive.length} active · where transactions are filed on accept`}
            >
                <label className="flex items-center gap-2 text-[0.8125rem] text-slate-400">
                    <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(e) => setShowArchived(e.target.checked)}
                    />
                    Show archived
                </label>
            </PageHeader>

            <div className="grid gap-3.5 sm:grid-cols-3">
                <StatCard label="Total assets" value={fmtMoney(assets, baseCurrency)} />
                <StatCard
                    label="Total liabilities"
                    value={fmtMoney(liabilities, baseCurrency)}
                    tone="negative"
                />
                <StatCard label="Net worth" value={fmtMoney(assets + liabilities, baseCurrency)} tone="dark" />
            </div>

            {accounts.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
            <QueryError error={accounts.error} />

            {sections.map((section) => (
                <div key={section.label}>
                    <SectionLabel>{section.label}</SectionLabel>
                    <Card padded={false}>
                {section.accounts.map((a) => (
                    <div
                        key={a.id}
                        className={`border-b border-slate-800 px-5 py-3.5 last:border-0 ${
                            a.is_archived ? "opacity-50" : ""
                        }`}
                    >
                    {editingId === a.id ? (
                        <EditAccountForm
                            account={a}
                            onDone={() => setEditingId(null)}
                        />
                    ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-3.5 sm:flex-1">
                            <Avatar label={a.name} tint={tintFor(a.name)} />
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-100">
                                    {a.name}
                                    {a.metadata?.auto_balance && (
                                        <span title="Opening balance is inferred from observed activity (a debit implies the funds were there). Set an opening balance manually to take over.">
                                            <Pill tint="indigo">inferred</Pill>
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-slate-500">
                                    {accountTypeLabel(a.type)}
                                    {a.institution ? ` · ${a.institution}` : ""}
                                    {a.metadata?.number_masked ? ` · ${a.metadata.number_masked}` : ""}
                                </div>
                            </div>
                            <div className="shrink-0 text-right">
                                <div
                                    className={`text-[0.9375rem] font-bold tnum ${
                                        Number(a.current_balance) < 0
                                            ? "text-rose-400"
                                            : "text-slate-100"
                                    }`}
                                >
                                    {fmtMoney(Number(a.current_balance), a.currency)}
                                </div>
                                <div className="text-xs text-slate-500">
                                    opened at {fmtMoney(Number(a.opening_balance), a.currency)}
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
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
                            {allActive.length > 1 && (
                                <Select
                                    compact
                                    className="!px-2 !py-1 text-xs"
                                    title="Merge this account into another (moves all its transactions)"
                                    value=""
                                    disabled={merge.isPending}
                                    onChange={(e) => {
                                        const target = e.target.value;
                                        if (!target) return;
                                        const targetName = allActive.find((x) => x.id === target)?.name;
                                        if (
                                            window.confirm(
                                                `Merge "${a.name}" into "${targetName}"? All of "${a.name}"'s transactions and scheduled items move over, then "${a.name}" is deleted.`,
                                            )
                                        ) {
                                            merge.mutate({ source: a.id, target });
                                        }
                                        e.target.value = "";
                                    }}
                                >
                                    <option value="">Merge into…</option>
                                    {allActive
                                        .filter((x) => x.id !== a.id)
                                        .map((x) => (
                                            <option key={x.id} value={x.id}>
                                                {x.name}
                                            </option>
                                        ))}
                                </Select>
                            )}
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
                    </div>
                    )}
                    </div>
                ))}
                    </Card>
                </div>
            ))}

            {accounts.isSuccess && rows.length === 0 && (
                <p className="text-sm text-slate-500">No accounts yet — create your first below.</p>
            )}
            <QueryError error={merge.error} />

            <CreateAccountForm />
        </>
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
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
            <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                        {t.label}
                    </option>
                ))}
            </Select>
            <Input
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value)}
                required
            />
            <Input
                placeholder="Institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-slate-500">
                Opening balance
                <Input
                    className="flex-1"
                    type="number"
                    step="0.01"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                />
            </label>
            <div className="flex items-center gap-2">
                <button className="sb-btn sb-btn-primary" disabled={save.isPending || !name.trim()}>
                    {save.isPending ? "Saving…" : "Save"}
                </button>
                <button type="button" className="sb-btn sb-btn-ghost" onClick={onDone}>
                    Cancel
                </button>
            </div>
            {account.metadata?.auto_balance && (
                <p className="text-xs text-sky-300/70 sm:col-span-2">
                    This account's opening balance is currently inferred from activity.
                    Changing it here switches to your manual value permanently.
                </p>
            )}
            <div className="sm:col-span-2">
                <QueryError error={save.error} />
            </div>
        </form>
    );
}

function CreateAccountForm() {
    const qc = useQueryClient();
    const [name, setName] = useState("");
    const [type, setType] = useState<AccountType>("checking");
    const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
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
            qc.invalidateQueries({ queryKey: QK.accounts });
            qc.invalidateQueries({ queryKey: QK.accountBalances });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim()) create.mutate();
    }

    return (
        <form
            onSubmit={submit}
            className="sb-card p-4"
        >
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New account</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <Input
                    placeholder="Name, e.g. GTBank Current"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                    {ACCOUNT_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                            {t.label}
                        </option>
                    ))}
                </Select>
                <Input
                    placeholder="Currency (ISO), e.g. NGN"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    maxLength={3}
                    required
                />
                <Input
                    placeholder="Institution (optional)"
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                />
                <Input
                    type="number"
                    step="0.01"
                    placeholder="Opening balance"
                    value={openingBalance}
                    onChange={(e) => setOpeningBalance(e.target.value)}
                />
                <button className="sb-btn sb-btn-primary" disabled={create.isPending || !name.trim()}>
                    {create.isPending ? "Creating…" : "Create account"}
                </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
                Note: the currency must exist in the currencies table (majors plus NGN,
                ZAR, KES, GHS, INR, AED and more are seeded by the migrations).
            </p>
            <div className="mt-2">
                <QueryError error={create.error} />
            </div>
        </form>
    );
}
