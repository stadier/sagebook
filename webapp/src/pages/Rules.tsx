import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { requireSupabase } from "../lib/supabase";
import { fetchTaxonomy } from "../lib/taxonomy";
import type { Rule } from "../lib/types";

export default function Rules() {
    const qc = useQueryClient();

    const rules = useQuery({
        queryKey: ["rules"],
        queryFn: async () => {
            const { data, error } = await requireSupabase()
                .from("rules")
                .select("*")
                .order("priority", { ascending: false });
            if (error) throw new Error(error.message);
            return (data ?? []) as Rule[];
        },
    });

    const update = useMutation({
        mutationFn: async (args: { id: string; patch: Record<string, unknown> }) => {
            const { error } = await requireSupabase()
                .from("rules")
                .update(args.patch)
                .eq("id", args.id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    });

    const remove = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase().from("rules").delete().eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }),
    });

    return (
        <div className="mx-auto max-w-3xl">
            <h1 className="mb-1 text-xl font-semibold">Rules</h1>
            <p className="mb-6 text-sm text-slate-400">
                Applied to every new extraction, highest priority first — first match wins.
                Use them to pin recurring payees to a category and tags automatically.
            </p>

            <CreateRuleForm />

            {rules.isLoading && <p className="mt-6 text-sm text-slate-400">Loading…</p>}
            {rules.isError && (
                <p className="mt-6 text-sm text-rose-400">{(rules.error as Error).message}</p>
            )}

            <div className="mt-6 flex flex-col gap-2">
                {(rules.data ?? []).map((rule) => (
                    <div
                        key={rule.id}
                        className={`flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 ${
                            rule.active ? "" : "opacity-50"
                        }`}
                    >
                        <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-slate-100">{rule.name}</div>
                            <div className="text-xs text-slate-500">
                                when <span className="text-slate-300">{rule.match_field}</span>{" "}
                                {rule.match_op.replace("_", " ")}{" "}
                                <span className="text-slate-300">"{rule.match_value}"</span>
                                {rule.set_category_name && (
                                    <>
                                        {" "}→ category <span className="text-slate-300">{rule.set_category_name}</span>
                                    </>
                                )}
                                {rule.set_tags.length > 0 && <> · tags: {rule.set_tags.join(", ")}</>}
                            </div>
                        </div>
                        <span className="text-xs text-slate-600">p{rule.priority}</span>
                        <button
                            className="text-xs text-slate-500 hover:text-slate-300"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: rule.id, patch: { active: !rule.active } })}
                        >
                            {rule.active ? "Disable" : "Enable"}
                        </button>
                        <button
                            className="text-xs text-rose-500 hover:text-rose-300"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(rule.id)}
                        >
                            Delete
                        </button>
                    </div>
                ))}
                {rules.isSuccess && (rules.data ?? []).length === 0 && (
                    <p className="text-sm text-slate-500">
                        No rules yet. Tip: use "+ Rule" on an inbox card to pre-fill one.
                    </p>
                )}
            </div>
        </div>
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

    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });

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
            qc.invalidateQueries({ queryKey: ["rules"] });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim() && matchValue.trim()) create.mutate();
    }

    return (
        <form onSubmit={submit} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-200">New rule</h2>
            <div className="grid gap-2 sm:grid-cols-2">
                <input
                    className={inputCls}
                    placeholder="Rule name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
                <div className="flex flex-wrap gap-2">
                    <select
                        className={`${inputCls} w-full sm:w-28`}
                        value={matchField}
                        onChange={(e) => setMatchField(e.target.value as Rule["match_field"])}
                    >
                        <option value="payee">payee</option>
                        <option value="memo">memo</option>
                        <option value="kind">kind</option>
                    </select>
                    <select
                        className={`${inputCls} w-full sm:w-32`}
                        value={matchOp}
                        onChange={(e) => setMatchOp(e.target.value as Rule["match_op"])}
                    >
                        <option value="contains">contains</option>
                        <option value="equals">equals</option>
                        <option value="starts_with">starts with</option>
                        <option value="regex">regex</option>
                    </select>
                    <input
                        className={`${inputCls} min-w-0 flex-1`}
                        placeholder="value"
                        value={matchValue}
                        onChange={(e) => setMatchValue(e.target.value)}
                        required
                    />
                </div>
                <select
                    className={inputCls}
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                >
                    <option value="">— set no category —</option>
                    {(taxonomy.data ?? []).map((group) => (
                        <optgroup key={group.id} label={group.name}>
                            {group.categories.map((c) => (
                                <option key={c.id} value={c.name}>
                                    {c.parent_id ? "· " : ""}
                                    {c.name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <div className="flex gap-2">
                    <input
                        className={`${inputCls} min-w-0 flex-1`}
                        placeholder="tags, comma-separated"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                    />
                    <input
                        className={`${inputCls} w-24`}
                        type="number"
                        title="priority (higher wins)"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                    />
                </div>
            </div>
            <button
                className="mt-3 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={create.isPending || !name.trim() || !matchValue.trim()}
            >
                {create.isPending ? "Creating…" : "Create rule"}
            </button>
            {create.isError && (
                <p className="mt-2 text-xs text-rose-400">{(create.error as Error).message}</p>
            )}
        </form>
    );
}

const inputCls =
    "rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500";
