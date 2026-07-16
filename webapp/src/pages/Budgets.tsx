import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { fmtDate, fmtMoney } from "../lib/format";
import { requireSupabase } from "../lib/supabase";
import { fetchTaxonomy, fetchAccounts } from "../lib/taxonomy";
import type {
    Budget,
    BudgetCategory,
    BudgetLineKind,
    BudgetPeriod,
    BudgetProgress,
} from "../lib/types";

/* -------------------------------------------------------------------------- */
/*  Data fetching                                                              */
/* -------------------------------------------------------------------------- */

async function fetchBudgets(): Promise<Budget[]> {
    const { data, error } = await requireSupabase()
        .from("budgets")
        .select("*")
        .order("starts_on", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Budget[];
}

async function fetchBudgetCategories(budgetId: string): Promise<BudgetCategory[]> {
    const { data, error } = await requireSupabase()
        .from("budget_categories")
        .select("*")
        .eq("budget_id", budgetId)
        .order("sort_order");
    if (error) throw new Error(error.message);
    return (data ?? []) as BudgetCategory[];
}

async function fetchBudgetProgress(budgetId: string): Promise<BudgetProgress[]> {
    const { data, error } = await requireSupabase()
        .from("v_budget_progress")
        .select("*")
        .eq("budget_id", budgetId)
        .order("sort_order");
    if (error) throw new Error(error.message);
    return (data ?? []) as BudgetProgress[];
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function periodDates(kind: BudgetPeriod): { starts: string; ends: string } {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (kind) {
        case "quarterly": {
            const qStart = Math.floor(m / 3) * 3;
            const s = new Date(y, qStart, 1);
            const e = new Date(y, qStart + 3, 0);
            return { starts: iso(s), ends: iso(e) };
        }
        case "yearly":
            return { starts: `${y}-01-01`, ends: `${y}-12-31` };
        default: {
            const s = new Date(y, m, 1);
            const e = new Date(y, m + 1, 0);
            return { starts: iso(s), ends: iso(e) };
        }
    }
}

function iso(d: Date): string {
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

function periodLabel(b: Budget): string {
    const s = new Date(b.starts_on);
    const e = new Date(b.ends_on);
    if (b.period_kind === "monthly") {
        return s.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    }
    return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-emerald-500";

const kindColors: Record<BudgetLineKind, string> = {
    income: "text-emerald-400",
    expense: "text-slate-100",
    saving: "text-sky-400",
    transfer: "text-amber-400",
};

const kindLabels: Record<BudgetLineKind, string> = {
    income: "Income",
    expense: "Expense",
    saving: "Saving",
    transfer: "Transfer",
};

/* -------------------------------------------------------------------------- */
/*  Main page                                                                  */
/* -------------------------------------------------------------------------- */

export default function Budgets() {
    const [selected, setSelected] = useState<string | null>(null);
    const budgets = useQuery({ queryKey: ["budgets"], queryFn: fetchBudgets });

    const active = (budgets.data ?? []).filter((b) => !b.is_template);
    const templates = (budgets.data ?? []).filter((b) => b.is_template);

    if (selected) {
        const budget = (budgets.data ?? []).find((b) => b.id === selected);
        if (budget) return <BudgetDetail budget={budget} onBack={() => setSelected(null)} />;
    }

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold">Budgets</h1>
            <p className="mb-6 text-sm text-slate-400">
                Plan your spending and income, then reconcile against actual transactions.
            </p>

            <CreateBudgetForm />

            {budgets.isLoading && <p className="mt-6 text-sm text-slate-400">Loading…</p>}

            {active.length > 0 && (
                <div className="mt-6">
                    <h2 className="mb-2 text-sm font-semibold text-slate-300">Active budgets</h2>
                    <div className="flex flex-col gap-2">
                        {active.map((b) => (
                            <BudgetCard key={b.id} budget={b} onClick={() => setSelected(b.id)} />
                        ))}
                    </div>
                </div>
            )}

            {templates.length > 0 && (
                <div className="mt-6">
                    <h2 className="mb-2 text-sm font-semibold text-slate-300">Templates</h2>
                    <div className="flex flex-col gap-2">
                        {templates.map((b) => (
                            <BudgetCard key={b.id} budget={b} onClick={() => setSelected(b.id)} />
                        ))}
                    </div>
                </div>
            )}

            {budgets.isSuccess && active.length === 0 && templates.length === 0 && (
                <p className="mt-6 text-sm text-slate-500">No budgets yet. Create one above.</p>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Budget card (list view)                                                    */
/* -------------------------------------------------------------------------- */

function BudgetCard({ budget, onClick }: { budget: Budget; onClick: () => void }) {
    const progress = useQuery({
        queryKey: ["budget-progress", budget.id],
        queryFn: () => fetchBudgetProgress(budget.id),
        enabled: !budget.is_template,
    });

    const lines = progress.data ?? [];
    const totalPlanned = lines.reduce((s, l) => s + Number(l.planned_amount), 0);
    const totalActual = lines.reduce((s, l) => s + Number(l.actual_amount), 0);
    const pct = totalPlanned > 0 ? Math.min((totalActual / totalPlanned) * 100, 100) : 0;

    return (
        <button
            onClick={onClick}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-left transition-colors hover:border-slate-700 hover:bg-slate-900"
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    {budget.name}
                    {budget.is_template && (
                        <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                            template
                        </span>
                    )}
                </div>
                <div className="text-xs text-slate-500">
                    {budget.is_template
                        ? `${budget.period_kind} · ${budget.currency}`
                        : `${periodLabel(budget)} · ${budget.currency}`}
                    {lines.length > 0 && ` · ${lines.length} line${lines.length === 1 ? "" : "s"}`}
                </div>
            </div>
            {!budget.is_template && totalPlanned > 0 && (
                <div className="flex items-center gap-3">
                    <div className="text-right">
                        <div className="text-sm font-semibold text-slate-100">
                            {fmtMoney(totalActual, budget.currency)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                            of {fmtMoney(totalPlanned, budget.currency)}
                        </div>
                    </div>
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-800">
                        <div
                            className={`h-full rounded-full transition-all ${
                                pct > 90 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"
                            }`}
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
            )}
        </button>
    );
}

/* -------------------------------------------------------------------------- */
/*  Create budget form                                                         */
/* -------------------------------------------------------------------------- */

function CreateBudgetForm() {
    const qc = useQueryClient();
    const budgets = useQuery({ queryKey: ["budgets"], queryFn: fetchBudgets });

    const [name, setName] = useState("");
    const [periodKind, setPeriodKind] = useState<BudgetPeriod>("monthly");
    const [startsOn, setStartsOn] = useState(() => periodDates("monthly").starts);
    const [endsOn, setEndsOn] = useState(() => periodDates("monthly").ends);
    const [currency, setCurrency] = useState("NGN");
    const [isTemplate, setIsTemplate] = useState(false);
    const [cloneFrom, setCloneFrom] = useState("");

    function handlePeriodChange(kind: BudgetPeriod) {
        setPeriodKind(kind);
        if (kind !== "custom") {
            const { starts, ends } = periodDates(kind);
            setStartsOn(starts);
            setEndsOn(ends);
        }
    }

    const create = useMutation({
        mutationFn: async () => {
            if (cloneFrom) {
                const { data, error } = await requireSupabase().rpc("clone_budget", {
                    p_source_id: cloneFrom,
                    p_name: name.trim(),
                    p_starts_on: startsOn,
                    p_ends_on: endsOn,
                    p_apply_rollover: true,
                });
                if (error) throw new Error(error.message);
                return data;
            }
            const sb = requireSupabase();
            const { data: u } = await sb.auth.getUser();
            if (!u.user) throw new Error("not signed in");
            const { error } = await sb.from("budgets").insert({
                user_id: u.user.id,
                name: name.trim(),
                period_kind: periodKind,
                starts_on: startsOn,
                ends_on: endsOn,
                currency: currency.trim().toUpperCase(),
                is_template: isTemplate,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setName("");
            setCloneFrom("");
            qc.invalidateQueries({ queryKey: ["budgets"] });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim()) create.mutate();
    }

    const cloneable = (budgets.data ?? []).filter((b) => b.is_template || !b.is_template);

    return (
        <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New budget</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <input
                    className={inputCls}
                    placeholder="Name, e.g. July 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <select
                    className={inputCls}
                    value={periodKind}
                    onChange={(e) => handlePeriodChange(e.target.value as BudgetPeriod)}
                >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom dates</option>
                </select>
                <input
                    className={inputCls}
                    type="date"
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                    required
                />
                <input
                    className={inputCls}
                    type="date"
                    value={endsOn}
                    onChange={(e) => setEndsOn(e.target.value)}
                    required
                />
                <input
                    className={`${inputCls} w-full`}
                    placeholder="Currency"
                    value={currency}
                    maxLength={3}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    required
                />
                {cloneable.length > 0 && (
                    <select
                        className={inputCls}
                        value={cloneFrom}
                        onChange={(e) => setCloneFrom(e.target.value)}
                    >
                        <option value="">Clone from… (optional)</option>
                        {cloneable.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}
                                {b.is_template ? " (template)" : ""}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-400">
                <input
                    type="checkbox"
                    checked={isTemplate}
                    onChange={(e) => setIsTemplate(e.target.checked)}
                    className="rounded border-slate-700"
                />
                Save as reusable template
            </label>
            <button
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={create.isPending || !name.trim()}
            >
                {create.isPending ? "Creating…" : "Create budget"}
            </button>
            {create.isError && (
                <p className="mt-2 text-xs text-rose-400">{(create.error as Error).message}</p>
            )}
        </form>
    );
}

/* -------------------------------------------------------------------------- */
/*  Budget detail view                                                         */
/* -------------------------------------------------------------------------- */

function BudgetDetail({ budget, onBack }: { budget: Budget; onBack: () => void }) {
    const qc = useQueryClient();
    const progress = useQuery({
        queryKey: ["budget-progress", budget.id],
        queryFn: () => fetchBudgetProgress(budget.id),
    });

    const lines = progress.data ?? [];
    const incomeLines = lines.filter((l) => l.kind === "income");
    const expenseLines = lines.filter((l) => l.kind === "expense");
    const savingLines = lines.filter((l) => l.kind === "saving");
    const transferLines = lines.filter((l) => l.kind === "transfer");

    const totalPlanned = expenseLines.reduce((s, l) => s + Number(l.planned_amount), 0);
    const totalActual = expenseLines.reduce((s, l) => s + Number(l.actual_amount), 0);
    const totalIncomePlanned = incomeLines.reduce((s, l) => s + Number(l.planned_amount), 0);
    const totalIncomeActual = incomeLines.reduce((s, l) => s + Number(l.actual_amount), 0);

    const remove = useMutation({
        mutationFn: async () => {
            const { error } = await requireSupabase()
                .from("budgets")
                .delete()
                .eq("id", budget.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["budgets"] });
            onBack();
        },
    });

    return (
        <div className="mx-auto max-w-3xl">
            <button
                onClick={onBack}
                className="mb-4 flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                </svg>
                All budgets
            </button>

            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold">
                    {budget.name}
                    {budget.is_template && (
                        <span className="ml-2 rounded bg-slate-700 px-1.5 py-0.5 text-xs font-normal text-slate-400">
                            template
                        </span>
                    )}
                </h1>
                <button
                    className="text-xs text-slate-600 hover:text-rose-400"
                    onClick={() => {
                        if (window.confirm(`Delete budget "${budget.name}"?`)) remove.mutate();
                    }}
                >
                    Delete budget
                </button>
            </div>
            <p className="mb-6 text-sm text-slate-400">
                {periodLabel(budget)} · {budget.currency}
                {budget.notes ? ` · ${budget.notes}` : ""}
            </p>

            {/* Summary stats */}
            {!budget.is_template && (
                <div className="mb-6 grid gap-4 sm:grid-cols-2">
                    <div className="sb-stat bg-sage text-sage-ink">
                        <div className="mb-2 text-sm font-medium opacity-80">Planned income</div>
                        <p className="text-2xl font-bold">{fmtMoney(totalIncomePlanned, budget.currency)}</p>
                        <p className="mt-1 text-sm opacity-70">
                            Actual: {fmtMoney(totalIncomeActual, budget.currency)}
                        </p>
                    </div>
                    <div className="sb-stat bg-gold text-gold-ink">
                        <div className="mb-2 text-sm font-medium opacity-80">Planned expenses</div>
                        <p className="text-2xl font-bold">{fmtMoney(totalPlanned, budget.currency)}</p>
                        <p className="mt-1 text-sm opacity-70">
                            Spent: {fmtMoney(totalActual, budget.currency)}
                        </p>
                    </div>
                </div>
            )}

            {/* Add line form */}
            <AddLineForm budgetId={budget.id} />

            {/* Budget lines by kind */}
            {progress.isLoading && <p className="mt-4 text-sm text-slate-400">Loading…</p>}
            <LineSection title="Income" lines={incomeLines} currency={budget.currency} isTemplate={budget.is_template} />
            <LineSection title="Expenses" lines={expenseLines} currency={budget.currency} isTemplate={budget.is_template} />
            <LineSection title="Savings" lines={savingLines} currency={budget.currency} isTemplate={budget.is_template} />
            <LineSection title="Transfers" lines={transferLines} currency={budget.currency} isTemplate={budget.is_template} />

            {lines.length === 0 && !progress.isLoading && (
                <p className="mt-4 text-sm text-slate-500">
                    No budget lines yet. Add categories above to start planning.
                </p>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Line section (group of budget lines by kind)                               */
/* -------------------------------------------------------------------------- */

function LineSection({
    title,
    lines,
    currency,
    isTemplate,
}: {
    title: string;
    lines: BudgetProgress[];
    currency: string;
    isTemplate: boolean;
}) {
    const qc = useQueryClient();

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editAmount, setEditAmount] = useState("");

    const updateAmount = useMutation({
        mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
            const { error } = await requireSupabase()
                .from("budget_categories")
                .update({ planned_amount: amount })
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setEditingId(null);
            qc.invalidateQueries({ queryKey: ["budget-progress"] });
        },
    });

    const removeLine = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase()
                .from("budget_categories")
                .delete()
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-progress"] }),
    });

    if (lines.length === 0) return null;

    const totalPlanned = lines.reduce((s, l) => s + Number(l.planned_amount), 0);
    const totalActual = lines.reduce((s, l) => s + Number(l.actual_amount), 0);

    return (
        <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
                <span className="text-xs text-slate-500">
                    {isTemplate
                        ? fmtMoney(totalPlanned, currency)
                        : `${fmtMoney(totalActual, currency)} / ${fmtMoney(totalPlanned, currency)}`}
                </span>
            </div>
            <div className="flex flex-col gap-2">
                {lines.map((line) => {
                    const pct = Number(line.planned_amount) > 0
                        ? Math.min((Number(line.actual_amount) / Number(line.planned_amount)) * 100, 100)
                        : 0;
                    const isEditing = editingId === line.budget_category_id;

                    return (
                        <div
                            key={line.budget_category_id}
                            className="group rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
                        >
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 text-sm text-slate-200">
                                        <span className={`font-medium ${kindColors[line.kind]}`}>
                                            {line.label}
                                        </span>
                                        {line.rollover && (
                                            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                                                rollover
                                            </span>
                                        )}
                                    </div>
                                    {!isTemplate && (
                                        <div className="text-xs text-slate-500">
                                            {Number(line.tx_count)} transaction{Number(line.tx_count) === 1 ? "" : "s"}
                                        </div>
                                    )}
                                </div>
                                <div className="text-right">
                                    {isEditing ? (
                                        <form
                                            className="flex items-center gap-1"
                                            onSubmit={(e) => {
                                                e.preventDefault();
                                                updateAmount.mutate({
                                                    id: line.budget_category_id,
                                                    amount: Number(editAmount),
                                                });
                                            }}
                                        >
                                            <input
                                                className={`${inputCls} w-28`}
                                                type="number"
                                                step="0.01"
                                                value={editAmount}
                                                onChange={(e) => setEditAmount(e.target.value)}
                                                autoFocus
                                            />
                                            <button className="text-xs text-emerald-400 hover:text-emerald-300">
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                className="text-xs text-slate-500"
                                                onClick={() => setEditingId(null)}
                                            >
                                                ×
                                            </button>
                                        </form>
                                    ) : (
                                        <button
                                            className="text-sm font-semibold text-slate-100 hover:text-emerald-400"
                                            onClick={() => {
                                                setEditingId(line.budget_category_id);
                                                setEditAmount(String(Number(line.planned_amount)));
                                            }}
                                            title="Click to edit"
                                        >
                                            {fmtMoney(Number(line.planned_amount), currency)}
                                        </button>
                                    )}
                                    {!isTemplate && !isEditing && (
                                        <div className="text-[10px] text-slate-500">
                                            {fmtMoney(Number(line.actual_amount), currency)} spent
                                        </div>
                                    )}
                                </div>
                                <button
                                    className="hidden text-xs text-slate-600 hover:text-rose-400 group-hover:inline"
                                    onClick={() => removeLine.mutate(line.budget_category_id)}
                                >
                                    ×
                                </button>
                            </div>
                            {!isTemplate && Number(line.planned_amount) > 0 && (
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                                    <div
                                        className={`h-full rounded-full transition-all ${
                                            pct > 90
                                                ? "bg-rose-500"
                                                : pct > 70
                                                  ? "bg-amber-500"
                                                  : "bg-emerald-500"
                                        }`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/*  Add budget line form                                                       */
/* -------------------------------------------------------------------------- */

function AddLineForm({ budgetId }: { budgetId: string }) {
    const qc = useQueryClient();
    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });

    const [kind, setKind] = useState<BudgetLineKind>("expense");
    const [categoryId, setCategoryId] = useState("");
    const [groupId, setGroupId] = useState("");
    const [label, setLabel] = useState("");
    const [amount, setAmount] = useState("");
    const [rollover, setRollover] = useState(false);
    const [mode, setMode] = useState<"category" | "group" | "custom">("category");

    const add = useMutation({
        mutationFn: async () => {
            const { error } = await requireSupabase().from("budget_categories").insert({
                budget_id: budgetId,
                category_id: mode === "category" && categoryId ? categoryId : null,
                group_id: mode === "group" && groupId ? groupId : null,
                label: mode === "custom" ? label.trim() : null,
                kind,
                planned_amount: Number(amount) || 0,
                rollover,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setCategoryId("");
            setGroupId("");
            setLabel("");
            setAmount("");
            setRollover(false);
            qc.invalidateQueries({ queryKey: ["budget-progress"] });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        const hasTarget =
            (mode === "category" && categoryId) ||
            (mode === "group" && groupId) ||
            (mode === "custom" && label.trim());
        if (hasTarget) add.mutate();
    }

    return (
        <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Add budget line</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as BudgetLineKind)}>
                    {(Object.keys(kindLabels) as BudgetLineKind[]).map((k) => (
                        <option key={k} value={k}>{kindLabels[k]}</option>
                    ))}
                </select>
                <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "category" | "group" | "custom")}>
                    <option value="category">By category</option>
                    <option value="group">By group (all categories in group)</option>
                    <option value="custom">Custom label</option>
                </select>

                {mode === "category" && (
                    <select className={`${inputCls} sm:col-span-2`} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                        <option value="">Select category…</option>
                        {(taxonomy.data ?? []).map((g) => (
                            <optgroup key={g.id} label={g.name}>
                                {g.categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.parent_id ? "· " : ""}{c.name}
                                    </option>
                                ))}
                            </optgroup>
                        ))}
                    </select>
                )}
                {mode === "group" && (
                    <select className={`${inputCls} sm:col-span-2`} value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
                        <option value="">Select group…</option>
                        {(taxonomy.data ?? []).map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </select>
                )}
                {mode === "custom" && (
                    <input
                        className={`${inputCls} sm:col-span-2`}
                        placeholder="Custom label, e.g. Emergency fund"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        required
                    />
                )}

                <input
                    className={inputCls}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Planned amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm text-slate-400">
                    <input
                        type="checkbox"
                        checked={rollover}
                        onChange={(e) => setRollover(e.target.checked)}
                        className="rounded border-slate-700"
                    />
                    Rollover unspent
                </label>
            </div>
            <button
                className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={add.isPending}
            >
                {add.isPending ? "Adding…" : "Add line"}
            </button>
            {add.isError && (
                <p className="mt-2 text-xs text-rose-400">{(add.error as Error).message}</p>
            )}
        </form>
    );
}
