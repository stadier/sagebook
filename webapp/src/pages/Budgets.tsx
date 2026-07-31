import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
    Input,
    PageHeader,
    Pill,
    QueryError,
    SectionLabel,
    Select,
    StatCard,
} from "../components/ui";
import { BUDGET_KIND_LABELS, BUDGET_PERIODS, DEFAULT_CURRENCY } from "../lib/constants";
import { fmtMoney } from "../lib/format";
import { QK, useBudgetProgress, useBudgets, useTaxonomy } from "../lib/queries";
import { requireSupabase } from "../lib/supabase";
import type { Budget, BudgetLineKind, BudgetPeriod, BudgetProgress } from "../lib/types";

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

const kindColors: Record<BudgetLineKind, string> = {
    income: "text-emerald-400",
    expense: "text-slate-100",
    saving: "text-sky-400",
    transfer: "text-amber-400",
};

/* -------------------------------------------------------------------------- */
/*  Main page                                                                  */
/* -------------------------------------------------------------------------- */

export default function Budgets() {
    const [selected, setSelected] = useState<string | null>(null);
    const budgets = useBudgets();

    const active = (budgets.data ?? []).filter((b) => !b.is_template);
    const templates = (budgets.data ?? []).filter((b) => b.is_template);

    if (selected) {
        const budget = (budgets.data ?? []).find((b) => b.id === selected);
        if (budget) return <BudgetDetail budget={budget} onBack={() => setSelected(null)} />;
    }

    return (
        <>
            <PageHeader
                title="Budgets"
                subtitle="Plan your spending and income, then reconcile against actual transactions."
            />

            <CreateBudgetForm />

            {budgets.isLoading && <p className="text-sm text-slate-400">Loading…</p>}

            {active.length > 0 && (
                <div>
                    <SectionLabel>Active budgets</SectionLabel>
                    <div className="flex flex-col gap-2.5">
                        {active.map((b) => (
                            <BudgetCard key={b.id} budget={b} onClick={() => setSelected(b.id)} />
                        ))}
                    </div>
                </div>
            )}

            {templates.length > 0 && (
                <div>
                    <SectionLabel>Templates</SectionLabel>
                    <div className="flex flex-col gap-2.5">
                        {templates.map((b) => (
                            <BudgetCard key={b.id} budget={b} onClick={() => setSelected(b.id)} />
                        ))}
                    </div>
                </div>
            )}

            {budgets.isSuccess && active.length === 0 && templates.length === 0 && (
                <p className="text-sm text-slate-500">No budgets yet. Create one above.</p>
            )}
        </>
    );
}

/* -------------------------------------------------------------------------- */
/*  Budget card (list view)                                                    */
/* -------------------------------------------------------------------------- */

function BudgetCard({ budget, onClick }: { budget: Budget; onClick: () => void }) {
    const progress = useBudgetProgress(budget.id, !budget.is_template);

    const lines = progress.data ?? [];
    const totalPlanned = lines.reduce((s, l) => s + Number(l.planned_amount), 0);
    const totalActual = lines.reduce((s, l) => s + Number(l.actual_amount), 0);
    const pct = totalPlanned > 0 ? Math.min((totalActual / totalPlanned) * 100, 100) : 0;

    return (
        <button
            onClick={onClick}
            className="sb-card flex flex-wrap items-center gap-3 px-5 py-3.5 text-left transition-shadow hover:shadow-float"
        >
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    {budget.name}
                    {budget.is_template && <Pill>template</Pill>}
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
    const budgets = useBudgets();

    const [name, setName] = useState("");
    const [periodKind, setPeriodKind] = useState<BudgetPeriod>("monthly");
    const [startsOn, setStartsOn] = useState(() => periodDates("monthly").starts);
    const [endsOn, setEndsOn] = useState(() => periodDates("monthly").ends);
    const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
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
            qc.invalidateQueries({ queryKey: QK.budgets });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim()) create.mutate();
    }

    const cloneable = (budgets.data ?? []).filter((b) => b.is_template || !b.is_template);

    return (
        <form onSubmit={submit} className="sb-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New budget</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <Input
                    placeholder="Name, e.g. July 2026"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <Select
                    value={periodKind}
                    onChange={(e) => handlePeriodChange(e.target.value as BudgetPeriod)}
                >
                    {BUDGET_PERIODS.map((p) => (
                        <option key={p.value} value={p.value}>
                            {p.label}
                        </option>
                    ))}
                </Select>
                <Input
                    type="date"
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                    required
                />
                <Input
                    type="date"
                    value={endsOn}
                    onChange={(e) => setEndsOn(e.target.value)}
                    required
                />
                <Input
                    placeholder="Currency"
                    value={currency}
                    maxLength={3}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                    required
                />
                {cloneable.length > 0 && (
                    <Select value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
                        <option value="">Clone from… (optional)</option>
                        {cloneable.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name}
                                {b.is_template ? " (template)" : ""}
                            </option>
                        ))}
                    </Select>
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
            <button className="sb-btn sb-btn-primary mt-3" disabled={create.isPending || !name.trim()}>
                {create.isPending ? "Creating…" : "Create budget"}
            </button>
            <div className="mt-2">
                <QueryError error={create.error} />
            </div>
        </form>
    );
}

/* -------------------------------------------------------------------------- */
/*  Budget detail view                                                         */
/* -------------------------------------------------------------------------- */

function BudgetDetail({ budget, onBack }: { budget: Budget; onBack: () => void }) {
    const qc = useQueryClient();
    const progress = useBudgetProgress(budget.id);

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
            qc.invalidateQueries({ queryKey: QK.budgets });
            onBack();
        },
    });

    return (
        <div className="flex flex-col gap-5">
            <button
                onClick={onBack}
                className="-mb-1 flex items-center gap-1 self-start text-sm text-slate-400 hover:text-slate-200"
            >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M15 18l-6-6 6-6" />
                </svg>
                All budgets
            </button>

            <PageHeader
                title={
                    <>
                        {budget.name}
                        {budget.is_template && (
                            <span className="sb-pill ml-2.5 align-middle bg-chip text-slate-400">
                                template
                            </span>
                        )}
                    </>
                }
                subtitle={`${periodLabel(budget)} · ${budget.currency}${
                    budget.notes ? ` · ${budget.notes}` : ""
                }`}
            >
                <button
                    className="sb-btn sb-btn-ghost !text-rose-400"
                    onClick={() => {
                        if (window.confirm(`Delete budget "${budget.name}"?`)) remove.mutate();
                    }}
                >
                    Delete budget
                </button>
            </PageHeader>

            {/* Summary stats */}
            {!budget.is_template && (
                <div className="grid gap-3.5 sm:grid-cols-2">
                    <StatCard
                        label="Planned income"
                        value={fmtMoney(totalIncomePlanned, budget.currency)}
                        tone="positive"
                        hint={`Actual: ${fmtMoney(totalIncomeActual, budget.currency)}`}
                    />
                    <StatCard
                        label="Planned expenses"
                        value={fmtMoney(totalPlanned, budget.currency)}
                        tone="dark"
                        hint={`Spent: ${fmtMoney(totalActual, budget.currency)}`}
                    />
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
                            className="group sb-card px-5 py-3.5"
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
                                            <Input
                                                className="w-28"
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
    const taxonomy = useTaxonomy();

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
        <form onSubmit={submit} className="sb-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">Add budget line</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <Select value={kind} onChange={(e) => setKind(e.target.value as BudgetLineKind)}>
                    {(Object.keys(BUDGET_KIND_LABELS) as BudgetLineKind[]).map((k) => (
                        <option key={k} value={k}>{BUDGET_KIND_LABELS[k]}</option>
                    ))}
                </Select>
                <Select value={mode} onChange={(e) => setMode(e.target.value as "category" | "group" | "custom")}>
                    <option value="category">By category</option>
                    <option value="group">By group (all categories in group)</option>
                    <option value="custom">Custom label</option>
                </Select>

                {mode === "category" && (
                    <Select className="sm:col-span-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
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
                    </Select>
                )}
                {mode === "group" && (
                    <Select className="sm:col-span-2" value={groupId} onChange={(e) => setGroupId(e.target.value)} required>
                        <option value="">Select group…</option>
                        {(taxonomy.data ?? []).map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                    </Select>
                )}
                {mode === "custom" && (
                    <Input
                        className="sm:col-span-2"
                        placeholder="Custom label, e.g. Emergency fund"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        required
                    />
                )}

                <Input
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
            <button className="sb-btn sb-btn-primary mt-3" disabled={add.isPending}>
                {add.isPending ? "Adding…" : "Add line"}
            </button>
            <div className="mt-2">
                <QueryError error={add.error} />
            </div>
        </form>
    );
}
