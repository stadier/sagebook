import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ApplyRulesDialog from "../../components/ApplyRulesDialog";
import { useConfirm } from "../../components/Confirm";
import DataTable, { type Column, type RowAction } from "../../components/DataTable";
import { PauseIcon, PlayIcon, ReplayIcon, TrashIcon } from "../../components/icons";
import { Input, Picker, Pill, QueryError } from "../../components/ui";
import { pairOptions } from "../../lib/options";
import { QK, useCategoryNameOptions, useRules } from "../../lib/queries";
import { requireSupabase } from "../../lib/supabase";
import type { Rule } from "../../lib/types";
import { SettingsSection } from "../Settings";

/** What an "Apply to past" dialog was opened for. */
interface ApplyTarget {
    /** Omitted, the dialog runs every active rule. */
    ruleIds?: string[];
    subject: string;
}

/** The rule's condition as one readable clause. */
function conditionText(rule: Rule): string {
    return `${rule.match_field} ${rule.match_op.replace("_", " ")} "${rule.match_value}"`;
}

const MATCH_FIELD_OPTIONS = pairOptions<Rule["match_field"]>([
    { value: "payee", label: "payee" },
    { value: "memo", label: "memo" },
    { value: "kind", label: "kind" },
]);

const MATCH_OP_OPTIONS = pairOptions<Rule["match_op"]>([
    { value: "contains", label: "contains" },
    { value: "equals", label: "equals" },
    { value: "starts_with", label: "starts with" },
    { value: "regex", label: "regex" },
]);

export default function Rules() {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [activeOnly, setActiveOnly] = useState(false);
    const [applyTarget, setApplyTarget] = useState<ApplyTarget | null>(null);
    const rules = useRules();

    const update = useMutation({
        mutationFn: async (args: { id: string; patch: Record<string, unknown> }) => {
            const { error } = await requireSupabase()
                .from("rules")
                .update(args.patch)
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.rules }),
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase().from("rules").delete().eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.rules }),
    });

    const bulk = useMutation({
        mutationFn: async (args: { ids: string[]; patch: Record<string, unknown> | null }) => {
            const sb = requireSupabase();
            const { error } = args.patch
                ? await sb.from("rules").update(args.patch).in("id", args.ids)
                : await sb.from("rules").delete().in("id", args.ids);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: QK.rules }),
    });

    const rows = (rules.data ?? []).filter((r) => !activeOnly || r.active);

    const columns: Array<Column<Rule>> = [
        {
            id: "name",
            label: "Rule",
            hideable: false,
            mobile: "title",
            sortValue: (r) => r.name,
            searchValue: (r) => `${r.name} ${conditionText(r)} ${r.set_category_name ?? ""}`,
            cell: (r) => <span className="font-semibold text-slate-100">{r.name}</span>,
        },
        {
            id: "condition",
            label: "When",
            sortValue: (r) => conditionText(r),
            cell: (r) => (
                <span className="text-[0.8125rem] text-slate-500">
                    <span className="text-slate-300">{r.match_field}</span>{" "}
                    {r.match_op.replace("_", " ")}{" "}
                    <span className="font-mono text-slate-300">"{r.match_value}"</span>
                </span>
            ),
        },
        {
            id: "sets",
            label: "Then",
            sortValue: (r) => r.set_category_name ?? "",
            searchValue: (r) => `${r.set_category_name ?? ""} ${r.set_tags.join(" ")}`,
            cell: (r) => (
                <span className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-slate-400">
                    {r.set_category_name ? (
                        <Pill tint="indigo">{r.set_category_name}</Pill>
                    ) : (
                        <span className="text-xs text-slate-600">no category</span>
                    )}
                    {r.set_tags.map((tag) => (
                        <span key={tag} className="rounded bg-chip px-1.5 py-0.5 text-xs">
                            #{tag}
                        </span>
                    ))}
                </span>
            ),
        },
        {
            id: "priority",
            label: "Priority",
            align: "right",
            width: "7rem",
            sortValue: (r) => r.priority,
            cell: (r) => <span className="text-[0.8125rem] text-slate-400 tnum">{r.priority}</span>,
        },
        {
            id: "status",
            label: "Status",
            width: "7rem",
            mobile: "trailing",
            sortValue: (r) => (r.active ? "active" : "paused"),
            cell: (r) =>
                r.active ? <Pill tint="green">active</Pill> : <Pill>paused</Pill>,
        },
    ];

    return (
        <>
            <SettingsSection
                title="Rules"
                description="Applied to every new extraction, highest priority first — first match wins. Pin recurring payees to a category and tags automatically, or run a rule back over transactions you already have."
            >
                <button
                    className="sb-btn sb-btn-ghost"
                    disabled={!rules.data?.some((r) => r.active)}
                    onClick={() => setApplyTarget({ subject: "Every active rule" })}
                >
                    Apply all to past
                </button>
            </SettingsSection>

            <CreateRuleForm />

            <QueryError error={rules.error} />
            <QueryError error={update.error ?? remove.error ?? bulk.error} />

            <DataTable
                storageKey="rules"
                data={rows}
                columns={columns}
                rowId={(r) => r.id}
                loading={rules.isLoading}
                rowNoun="rule"
                searchPlaceholder="Search name, match value, category…"
                exportFilename="sagebook-rules"
                initialSort={{ columnId: "priority", direction: "desc" }}
                activeFilterCount={activeOnly ? 1 : 0}
                onClearFilters={() => setActiveOnly(false)}
                filters={
                    <label className="flex items-center gap-2 text-[0.8125rem] text-slate-400">
                        <input
                            type="checkbox"
                            className="sb-check"
                            checked={activeOnly}
                            onChange={(e) => setActiveOnly(e.target.checked)}
                        />
                        Only show active rules
                    </label>
                }
                rowClassName={(r) => (r.active ? "" : "opacity-60")}
                selectable
                bulkActions={({ ids, clear }) => (
                    <>
                        <button
                            className="sb-tbtn"
                            onClick={() =>
                                setApplyTarget({
                                    ruleIds: ids,
                                    subject: `${ids.length} selected rule${ids.length === 1 ? "" : "s"}`,
                                })
                            }
                        >
                            Apply to past
                        </button>
                        <button
                            className="sb-tbtn"
                            disabled={bulk.isPending}
                            onClick={() =>
                                bulk.mutate({ ids, patch: { active: true } }, { onSuccess: clear })
                            }
                        >
                            Enable
                        </button>
                        <button
                            className="sb-tbtn"
                            disabled={bulk.isPending}
                            onClick={() =>
                                bulk.mutate({ ids, patch: { active: false } }, { onSuccess: clear })
                            }
                        >
                            Disable
                        </button>
                        <button
                            className="sb-tbtn !border-rose-900/60 !text-rose-400"
                            disabled={bulk.isPending}
                            onClick={() =>
                                confirm({
                                    title: `Delete ${ids.length} rule${ids.length === 1 ? "" : "s"}?`,
                                    body: "Transactions they already classified keep their categories, but the rules themselves are gone for good.",
                                    confirmLabel: `Delete ${ids.length} permanently`,
                                    danger: true,
                                    requirePhrase: ids.length > 1 ? "delete" : undefined,
                                    alternative: {
                                        label: "Disable instead",
                                        hint: "Disabling keeps them and stops them running.",
                                        onSelect: () =>
                                            bulk.mutate(
                                                { ids, patch: { active: false } },
                                                { onSuccess: clear },
                                            ),
                                    },
                                    onConfirm: () =>
                                        bulk.mutate({ ids, patch: null }, { onSuccess: clear }),
                                })
                            }
                        >
                            Delete
                        </button>
                    </>
                )}
                rowLabel={(rule) => rule.name}
                rowActions={(rule): RowAction[] => [
                    {
                        label: "Apply to past transactions…",
                        icon: <ReplayIcon size={15} />,
                        hint: "runs it over the ledger",
                        onSelect: () =>
                            setApplyTarget({ ruleIds: [rule.id], subject: rule.name }),
                    },
                    {
                        label: rule.active ? "Disable" : "Enable",
                        icon: rule.active ? <PauseIcon size={15} /> : <PlayIcon size={15} />,
                        disabled: update.isPending,
                        onSelect: () =>
                            update.mutate({ id: rule.id, patch: { active: !rule.active } }),
                    },
                    {
                        label: "Delete…",
                        icon: <TrashIcon size={15} />,
                        danger: true,
                        disabled: remove.isPending,
                        onSelect: () =>
                            confirm({
                                title: `Delete "${rule.name}"?`,
                                body: "Transactions it already classified keep their category, but the rule itself is gone for good.",
                                confirmLabel: "Delete permanently",
                                danger: true,
                                alternative: rule.active
                                    ? {
                                          label: "Disable instead",
                                          hint: "Disabling keeps the rule and stops it running.",
                                          onSelect: () =>
                                              update.mutate({
                                                  id: rule.id,
                                                  patch: { active: false },
                                              }),
                                      }
                                    : undefined,
                                onConfirm: () => remove.mutate(rule.id),
                            }),
                    },
                ]}
                emptyTitle="No rules yet"
                emptyBody={'Tip: use "+ Rule" on an inbox card to pre-fill one from a transaction.'}
            />

            <ApplyRulesDialog
                open={applyTarget !== null}
                onClose={() => setApplyTarget(null)}
                ruleIds={applyTarget?.ruleIds}
                subject={applyTarget?.subject ?? ""}
            />
        </>
    );
}

function CreateRuleForm() {
    const qc = useQueryClient();
    const [params] = useSearchParams();
    const prefillPayee = params.get("payee") ?? "";
    const prefillCategory = params.get("category") ?? "";

    const [name, setName] = useState(prefillPayee ? `Auto: ${prefillPayee}` : "");
    const [matchField, setMatchField] = useState<Rule["match_field"]>("payee");
    const [matchOp, setMatchOp] = useState<Rule["match_op"]>("contains");
    const [matchValue, setMatchValue] = useState(prefillPayee);
    const [categoryName, setCategoryName] = useState(prefillCategory);
    const [tags, setTags] = useState("");
    const [priority, setPriority] = useState("0");

    const categoryOpts = useCategoryNameOptions();

    const create = useMutation({
        mutationFn: async () => {
            const sb = requireSupabase();
            const { data: userData, error: userErr } = await sb.auth.getUser();
            if (userErr || !userData.user) throw new Error("not signed in");
            const { error } = await sb.from("rules").insert({
                user_id: userData.user.id,
                name: name.trim(),
                match_field: matchField,
                match_op: matchOp,
                match_value: matchValue.trim(),
                set_category_name: categoryName || null,
                set_tags: tags
                    .split(",")
                    .map((t) => t.trim())
                    .filter(Boolean),
                priority: Number(priority) || 0,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setName("");
            setMatchValue("");
            setCategoryName("");
            setTags("");
            setPriority("0");
            qc.invalidateQueries({ queryKey: QK.rules });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim() && matchValue.trim()) create.mutate();
    }

    return (
        <form onSubmit={submit} className="sb-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New rule</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <Input
                    placeholder="Rule name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <div className="flex flex-wrap gap-2">
                    <Picker
                        className="w-full sm:w-28"
                        options={MATCH_FIELD_OPTIONS}
                        value={matchField}
                        onChange={setMatchField}
                        title="Match on"
                    />
                    <Picker
                        className="w-full sm:w-32"
                        options={MATCH_OP_OPTIONS}
                        value={matchOp}
                        onChange={setMatchOp}
                        title="Comparison"
                    />
                    <Input
                        className="min-w-0 flex-1"
                        placeholder="value"
                        value={matchValue}
                        onChange={(e) => setMatchValue(e.target.value)}
                        required
                    />
                </div>
                {/* Rules store the category by name, not id — see the adapter. */}
                <Picker
                    options={categoryOpts}
                    value={categoryName}
                    onChange={setCategoryName}
                    placeholder="— set no category —"
                    title="Set category"
                    clearable
                />
                <div className="flex gap-2">
                    <Input
                        className="min-w-0 flex-1"
                        placeholder="tags, comma-separated"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                    />
                    <Input
                        className="w-24"
                        type="number"
                        title="priority (higher wins)"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                    />
                </div>
            </div>
            <button
                className="sb-btn sb-btn-primary mt-3"
                disabled={create.isPending || !name.trim() || !matchValue.trim()}
            >
                {create.isPending ? "Creating…" : "Create rule"}
            </button>
            <div className="mt-2">
                <QueryError error={create.error} />
            </div>
        </form>
    );
}
