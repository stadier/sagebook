// =============================================================================
// Sagebook · Extraction context
// -----------------------------------------------------------------------------
// Both AI capture paths (process-media for uploads, ingest-email for forwarded
// mail) prime the model with the same thing: the user's own category taxonomy
// and their account names, so an extraction classifies into categories that
// actually exist and recognises "GTBank Current" as an account rather than a
// payee. That fetch-and-format lived twice, verbatim; it lives here now.
// =============================================================================

import type { SupabaseClient } from "./deps.ts";
import { buildCategoryHint } from "./extract.ts";

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  group_id: string | null;
}

interface GroupRow {
  id: string;
  name: string;
}

interface AccountRow {
  name: string;
  institution: string | null;
  type: string;
}

/**
 * Build the prompt hint describing this user's taxonomy and accounts.
 *
 * Never throws: a missing hint degrades extraction quality but must not fail
 * the capture, so any error is logged and null is returned.
 */
export async function loadUserContextHint(
  admin: SupabaseClient,
  userId: string,
  fnName: string,
): Promise<string | null> {
  try {
    const [{ data: cats }, { data: groups }, { data: accounts }] = await Promise.all([
      admin.from("categories").select("id, name, parent_id, group_id").eq("user_id", userId),
      admin.from("category_groups").select("id, name").eq("user_id", userId),
      admin
        .from("accounts")
        .select("name, institution, type")
        .eq("user_id", userId)
        .eq("is_archived", false),
    ]);

    const catById = new Map((cats ?? []).map((c: CategoryRow) => [c.id, c]));
    const groupById = new Map((groups ?? []).map((g: GroupRow) => [g.id, g]));

    let hint = buildCategoryHint(
      (cats ?? []).map((c: CategoryRow) => ({
        name: c.name,
        parent: c.parent_id ? catById.get(c.parent_id) ?? null : null,
        group: c.group_id ? groupById.get(c.group_id) ?? null : null,
      })),
    );

    if (accounts?.length) {
      const lines = (accounts as AccountRow[]).map(
        (a) => `- ${a.name}${a.institution ? ` (${a.institution})` : ""} [${a.type}]`,
      );
      hint = `${hint ?? ""}\n\nUser's accounts:\n${lines.join("\n")}`;
    }

    return hint;
  } catch (err) {
    console.warn(`[${fnName}] context hint fetch failed`, err);
    return null;
  }
}
