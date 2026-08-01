// =============================================================================
// Sagebook · apply-rules Edge Function
// -----------------------------------------------------------------------------
// Runs rules over transactions that already exist. Ingestion applies rules at
// commit time (see _shared/commit.ts); this is the retroactive pass for a rule
// written after the fact — "I've been filing this payee wrong for a year".
//
// Matching is `ruleMatches` from _shared/commit.ts, the same function the three
// ingest paths use, so a backfill and an import can never disagree about what a
// rule means.
//
// The endpoint is dry-run by default: a caller must pass `dryRun: false` to
// write. The UI uses that to show the damage before anyone commits to it.
// =============================================================================

import { type ParsedTx, type Rule, ruleMatches } from "../_shared/commit.ts";
import { createApp, readJson, requireUser, serve } from "../_shared/http.ts";

/** Which existing rows a backfill is allowed to touch. */
const SCOPES = ["uncategorized", "all"] as const;
type Scope = (typeof SCOPES)[number];

interface ApplyRequest {
  /** Restrict to these rules. Omitted, every *active* rule runs. */
  ruleIds?: string[];
  /** `uncategorized` (default) never overwrites a category already set. */
  scope?: Scope;
  /** Must be explicitly false to write. */
  dryRun?: boolean;
}

/** A rule plus the fields the backfill reports on but matching doesn't need. */
interface StoredRule extends Rule {
  name: string;
  priority: number;
  active: boolean;
}

const RULE_COLUMNS =
  "id, name, priority, active, match_field, match_op, match_value, " +
  "set_category_name, set_tags, set_memo";

/** The row shape the scan reads. `occurred_at` is for the preview only. */
interface LedgerRow {
  id: string;
  payee: string | null;
  memo: string | null;
  kind: string;
  tags: string[] | null;
  category_id: string | null;
  occurred_at: string;
}

const TX_COLUMNS = "id, payee, memo, kind, tags, category_id, occurred_at";

/** Rows read per scan page. */
const PAGE = 1000;
/** Ids per update statement — keeps the `in (…)` list off the URL length limit. */
const UPDATE_CHUNK = 200;
/** Changes returned to the caller so a dry run can show its work. */
const SAMPLE_SIZE = 12;

/** One row the caller can eyeball before committing. */
interface SampleChange {
  id: string;
  payee: string | null;
  occurred_at: string;
  rule: string;
  fromCategory: string | null;
  toCategory: string | null;
  addedTags: string[];
}

const app = createApp("apply-rules");

app.post("/apply-rules", async (c) => {
  const auth = await requireUser(c);
  if (!auth.ok) return auth.response;

  const parsed = await readJson<ApplyRequest>(c, {});
  if (!parsed.ok) return parsed.response;
  const body = parsed.body ?? {};

  const scope = body.scope ?? "uncategorized";
  if (!SCOPES.includes(scope)) {
    return c.json({ error: `scope must be ${SCOPES.join(" | ")}` }, 400);
  }
  // Default-safe: only an explicit `false` writes.
  const dryRun = body.dryRun !== false;

  // --- rules ---------------------------------------------------------------
  // Named ids run even when paused: asking for a specific rule by id is an
  // explicit act, and "apply this to the past" is a reasonable thing to want
  // from a rule you have since switched off.
  let ruleQuery = auth.admin
    .from("rules")
    .select(RULE_COLUMNS)
    .eq("user_id", auth.userId)
    .order("priority", { ascending: false });

  ruleQuery = body.ruleIds?.length
    ? ruleQuery.in("id", body.ruleIds)
    : ruleQuery.eq("active", true);

  const { data: ruleData, error: ruleErr } = await ruleQuery;
  if (ruleErr) {
    return c.json({ error: "could not read rules", detail: ruleErr.message }, 500);
  }
  const rules = (ruleData ?? []) as StoredRule[];
  if (!rules.length) {
    return c.json({ error: "no rules to apply" }, 400);
  }

  // --- categories ----------------------------------------------------------
  // Rules store a category *name*; the ledger stores an id.
  const { data: cats } = await auth.admin
    .from("categories")
    .select("id, name")
    .eq("user_id", auth.userId);

  const idByName = new Map<string, string>();
  const nameById = new Map<string, string>();
  for (const cat of (cats ?? []) as Array<{ id: string; name: string }>) {
    idByName.set(cat.name.toLowerCase(), cat.id);
    nameById.set(cat.id, cat.name);
  }

  // A rule pointing at a category the user has since renamed or deleted can
  // never fire — worth saying so rather than silently matching nothing.
  const unresolved = [
    ...new Set(
      rules
        .map((r) => r.set_category_name)
        .filter((n): n is string => !!n && !idByName.has(n.toLowerCase())),
    ),
  ];

  // --- scan ----------------------------------------------------------------
  const perRule = new Map<string, { name: string; matched: number; changed: number }>();
  for (const rule of rules) perRule.set(rule.id, { name: rule.name, matched: 0, changed: 0 });

  // Rows sharing an identical patch update in one statement, so a backfill is
  // a handful of writes rather than one per row.
  const groups = new Map<string, { patch: Record<string, unknown>; ids: string[] }>();
  const sample: SampleChange[] = [];

  let scanned = 0;
  let matched = 0;
  let changed = 0;

  for (let from = 0; ; from += PAGE) {
    let scan = auth.admin
      .from("transactions")
      .select(TX_COLUMNS)
      .eq("user_id", auth.userId)
      // Rejected rows are out of the ledger; leave them as the record they are.
      .neq("review_status", "rejected")
      .order("id")
      .range(from, from + PAGE - 1);

    if (scope === "uncategorized") scan = scan.is("category_id", null);

    const { data: page, error: scanErr } = await scan;
    if (scanErr) {
      return c.json({ error: "could not read transactions", detail: scanErr.message }, 500);
    }
    const rows = (page ?? []) as LedgerRow[];
    if (!rows.length) break;
    scanned += rows.length;

    for (const tx of rows) {
      // `ruleMatches` reads only these three fields; the rest of ParsedTx is
      // filled to satisfy the shared type.
      const probe: ParsedTx = {
        occurred_at: tx.occurred_at,
        amount: 0,
        currency: "",
        kind: tx.kind,
        payee: tx.payee ?? undefined,
        memo: tx.memo ?? undefined,
      };

      // First match wins, highest priority first — the ingest semantics.
      const hit = rules.find((rule) => ruleMatches(rule, probe));
      if (!hit) continue;

      matched++;
      const stat = perRule.get(hit.id)!;
      stat.matched++;

      const patch: Record<string, unknown> = {};
      let toCategory: string | null = null;

      if (hit.set_category_name) {
        const cid = idByName.get(hit.set_category_name.toLowerCase());
        if (cid && cid !== tx.category_id) {
          patch.category_id = cid;
          toCategory = nameById.get(cid) ?? null;
        }
      }

      const existingTags = tx.tags ?? [];
      let addedTags: string[] = [];
      if (hit.set_tags?.length) {
        addedTags = hit.set_tags.filter((t) => !existingTags.includes(t));
        if (addedTags.length) patch.tags = [...existingTags, ...addedTags];
      }

      if (hit.set_memo && hit.set_memo !== tx.memo) patch.memo = hit.set_memo;

      // A rule that matches but changes nothing is already satisfied.
      if (!Object.keys(patch).length) continue;

      changed++;
      stat.changed++;

      const key = JSON.stringify(patch);
      const group = groups.get(key);
      if (group) group.ids.push(tx.id);
      else groups.set(key, { patch, ids: [tx.id] });

      if (sample.length < SAMPLE_SIZE) {
        sample.push({
          id: tx.id,
          payee: tx.payee,
          occurred_at: tx.occurred_at,
          rule: hit.name,
          fromCategory: tx.category_id ? nameById.get(tx.category_id) ?? null : null,
          toCategory,
          addedTags,
        });
      }
    }

    if (rows.length < PAGE) break;
  }

  // --- write ---------------------------------------------------------------
  if (!dryRun && changed > 0) {
    for (const { patch, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
        const { error: updateErr } = await auth.admin
          .from("transactions")
          .update(patch)
          .in("id", ids.slice(i, i + UPDATE_CHUNK))
          // Belt and braces: `admin` bypasses RLS.
          .eq("user_id", auth.userId);

        if (updateErr) {
          return c.json({ error: "update failed", detail: updateErr.message }, 500);
        }
      }
    }

    await auth.admin.from("app_logs").insert({
      user_id: auth.userId,
      level: "info",
      source: "rules",
      message: `Applied ${rules.length} rule(s) to ${changed} existing transaction(s)`,
      context: {
        scope,
        scanned,
        matched,
        changed,
        rules: rules.map((r) => ({ id: r.id, name: r.name })),
      },
    });
  }

  return c.json({
    dryRun,
    scope,
    scanned,
    matched,
    changed,
    unresolvedCategories: unresolved,
    byRule: [...perRule.entries()]
      .map(([id, s]) => ({ id, ...s }))
      .filter((r) => r.matched > 0)
      .sort((a, b) => b.changed - a.changed),
    sample,
  });
});

serve(app);
