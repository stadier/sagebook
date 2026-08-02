import { requireSupabase } from "./supabase";
import type { Account, Category, CategoryGroup } from "./types";

export interface GroupWithCategories extends CategoryGroup {
    categories: Category[];
}

/** Groups (sorted) with their categories; parents listed before children. */
export async function fetchTaxonomy(): Promise<GroupWithCategories[]> {
    const sb = requireSupabase();
    const [groupsRes, catsRes] = await Promise.all([
        sb.from("category_groups").select("*").order("sort_order"),
        sb.from("categories").select("*").order("name"),
    ]);
    if (groupsRes.error) throw new Error(groupsRes.error.message);
    if (catsRes.error) throw new Error(catsRes.error.message);

    const groups = (groupsRes.data ?? []) as CategoryGroup[];
    const cats = (catsRes.data ?? []) as Category[];

    /* The board's drag writes `sort_order`, so that leads; the name breaks ties
       and carries lists on a database that predates the column. Sorting happens
       here rather than in the query because a `.order("sort_order")` would be a
       hard error against that older schema, not a graceful fallback. */
    const byPosition = (a: Category, b: Category) =>
        (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name);

    const orderWithinGroup = (input: Category[]) => {
        const list = [...input].sort(byPosition);
        const parents = list.filter((c) => !c.parent_id);
        const ordered: Category[] = [];
        for (const p of parents) {
            ordered.push(p, ...list.filter((c) => c.parent_id === p.id));
        }
        // Children whose parent sits in another group still need listing.
        ordered.push(...list.filter((c) => c.parent_id && !ordered.includes(c)));
        return ordered;
    };

    const result: GroupWithCategories[] = groups.map((g) => ({
        ...g,
        categories: orderWithinGroup(cats.filter((c) => c.group_id === g.id)),
    }));

    const ungrouped = cats.filter((c) => !c.group_id);
    if (ungrouped.length) {
        result.push({
            id: "__ungrouped__",
            name: "Ungrouped",
            icon: null,
            color: null,
            sort_order: 999,
            categories: orderWithinGroup(ungrouped),
        });
    }
    return result;
}

export async function fetchAccounts(): Promise<Account[]> {
    const { data, error } = await requireSupabase()
        .from("accounts")
        .select("id, name, type, currency, institution, opening_balance, is_archived, metadata")
        .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []) as Account[];
}
