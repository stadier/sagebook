import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { requireSupabase } from "../lib/supabase";
import { fetchTaxonomy, type GroupWithCategories } from "./Inbox";

export default function Categories() {
    const taxonomy = useQuery({ queryKey: ["taxonomy"], queryFn: fetchTaxonomy });

    if (taxonomy.isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
    if (taxonomy.isError) {
        return <p className="text-sm text-rose-400">{(taxonomy.error as Error).message}</p>;
    }

    return (
        <div className="mx-auto max-w-4xl">
            <h1 className="mb-1 text-xl font-semibold">Categories</h1>
            <p className="mb-6 text-sm text-slate-400">
                Your custom taxonomy. AI extraction classifies into these groups and
                categories — e.g. land receipts land under Real Estate Investment.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
                {(taxonomy.data ?? []).map((group) => (
                    <GroupCard key={group.id} group={group} />
                ))}
            </div>
        </div>
    );
}

function GroupCard({ group }: { group: GroupWithCategories }) {
    const qc = useQueryClient();
    const [name, setName] = useState("");

    const addCategory = useMutation({
        mutationFn: async (categoryName: string) => {
            const sb = requireSupabase();
            const { data: userData, error: userErr } = await sb.auth.getUser();
            if (userErr || !userData.user) throw new Error("not signed in");
            const { error } = await sb.from("categories").insert({
                user_id: userData.user.id,
                name: categoryName,
                group_id: group.id === "__ungrouped__" ? null : group.id,
            });
            if (error) throw new Error(error.message);
        },
        onSuccess: () => {
            setName("");
            qc.invalidateQueries({ queryKey: ["taxonomy"] });
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (name.trim()) addCategory.mutate(name.trim());
    }

    return (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
                <span aria-hidden>{group.icon}</span>
                {group.name}
                <span className="ml-auto text-xs font-normal text-slate-500">
                    {group.categories.length}
                </span>
            </h2>
            <ul className="mb-3 flex flex-col gap-1 text-sm">
                {group.categories.map((c) => (
                    <li
                        key={c.id}
                        className={`flex items-center gap-2 ${c.parent_id ? "pl-5 text-slate-400" : "text-slate-200"}`}
                    >
                        <span aria-hidden>{c.icon}</span>
                        {c.name}
                    </li>
                ))}
                {group.categories.length === 0 && (
                    <li className="text-xs text-slate-600">No categories yet.</li>
                )}
            </ul>
            <form onSubmit={submit} className="flex gap-2">
                <input
                    className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm outline-none focus:border-emerald-500"
                    placeholder="New category…"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
                <button
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    disabled={addCategory.isPending || !name.trim()}
                >
                    Add
                </button>
            </form>
            {addCategory.isError && (
                <p className="mt-2 text-xs text-rose-400">{(addCategory.error as Error).message}</p>
            )}
        </div>
    );
}
