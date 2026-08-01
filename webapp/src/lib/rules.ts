/* Retroactive rule application — the client half of the `apply-rules` edge
   function.

   Rules normally fire once, at ingest, on the way into the ledger. This is the
   other direction: run them back over rows that are already there, for the rule
   you only thought to write after seeing the same payee land wrong six times.

   The endpoint is dry-run unless told otherwise, so the flow is always preview
   first, then commit the same request with `dryRun: false`. */

import { invokeFn } from "./supabase";

/** Which existing rows a backfill may touch. */
export type ApplyScope = "uncategorized" | "all";

export interface ApplyRulesRequest {
    /** Restrict to these rules. Omitted, every active rule runs. */
    ruleIds?: string[];
    scope?: ApplyScope;
    dryRun?: boolean;
}

/** One changed row, returned so a preview can show its work. */
export interface ApplySample {
    id: string;
    payee: string | null;
    occurred_at: string;
    rule: string;
    fromCategory: string | null;
    toCategory: string | null;
    addedTags: string[];
}

export interface ApplyRulesResult {
    dryRun: boolean;
    scope: ApplyScope;
    /** Rows considered. */
    scanned: number;
    /** Rows some rule matched. */
    matched: number;
    /** Rows that would actually change — matched, but not already correct. */
    changed: number;
    /** Rules with nothing left to apply — deleted category, no tags, no memo. */
    inertRules: string[];
    byRule: Array<{ id: string; name: string; matched: number; changed: number }>;
    sample: ApplySample[];
}

export function applyRules(request: ApplyRulesRequest): Promise<ApplyRulesResult> {
    return invokeFn<ApplyRulesResult>("apply-rules", request);
}
