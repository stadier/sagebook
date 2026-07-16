// =============================================================================
// Sagebook · Shared commit pipeline
// -----------------------------------------------------------------------------
// One implementation of "parsed transactions → rules → dedup → inbox rows",
// imported by process-media, commit-transactions, and ingest-import so the
// three entry points cannot drift. (Folders starting with _ are not deployed
// as functions.)
// =============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export interface Rule {
  id: string;
  match_field: "payee" | "memo" | "kind";
  match_op: "contains" | "equals" | "starts_with" | "regex";
  match_value: string;
  set_category_name: string | null;
  set_tags: string[];
  set_memo: string | null;
}

export interface ParsedTx {
  occurred_at: string;
  amount: number;
  currency: string;
  kind: string;
  payee?: string;
  memo?: string;
  category?: string;
  /** One short sentence explaining why this category was chosen. */
  category_reason?: string;
  tags?: string[];
  /** Source account inferred from the document. */
  account?: { name?: string; institution?: string; number_masked?: string; reason?: string };
  /** Bank reference / session ID — strong dedup signal. */
  reference?: string;
}

export interface CommitOptions {
  /** Pre-assign this account to every inserted row (e.g. statement imports). */
  accountId?: string | null;
  /** Mark the ingestion status 'applied' after committing. */
  markApplied?: boolean;
}

export interface CommitResult {
  committed: number;
  duplicates: number;
  rulesApplied: number;
  transactions: unknown[];
  /** Human-readable reasons for rows that failed to insert (e.g. FK violations). */
  insertErrors: string[];
}

export function ruleMatches(rule: Rule, tx: ParsedTx): boolean {
  const raw =
    rule.match_field === "payee" ? (tx.payee ?? "") :
    rule.match_field === "memo"  ? (tx.memo  ?? "") :
    rule.match_field === "kind"  ? (tx.kind  ?? "") : "";

  const val = raw.toLowerCase();
  const pat = rule.match_value.toLowerCase();

  switch (rule.match_op) {
    case "contains":    return val.includes(pat);
    case "equals":      return val === pat;
    case "starts_with": return val.startsWith(pat);
    case "regex": {
      try { return new RegExp(rule.match_value, "i").test(raw); }
      catch { return false; }
    }
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Keyword-based category inference — fallback when no rule or AI matched.
// Maps common payee/memo keywords to default category names. The lookup is
// case-insensitive; first match wins, so more-specific patterns come first.
// ---------------------------------------------------------------------------
const KEYWORD_RULES: { keywords: string[]; category: string }[] = [
  // Fees & Charges — bank/tax/regulatory deductions
  { keywords: ["value added tax", "vat ", "stamp duty", "sms alert", "account maintenance",
                "bank charge", "bank fee", "service charge", "withholding tax",
                "commission", "atm charge", "card maintenance"],
    category: "Fees & Charges" },

  // Groceries & supermarkets
  { keywords: ["supermarket", "grocery", "groceries", "market", "foodstuff",
                "shoprite", "spar ", "game stores"],
    category: "Groceries" },

  // Food & Dining — restaurants, fast-food, delivery
  { keywords: ["restaurant", "eatery", "kitchen", "chicken republic", "kfc",
                "dominos", "pizza", "cafe", "bakery", "suya", "food"],
    category: "Food & Dining" },

  // Transport
  { keywords: ["uber", "bolt", "taxi", "fuel", "petrol", "filling station",
                "tollgate", "parking", "transport"],
    category: "Transport" },

  // Utilities
  { keywords: ["electricity", "power", "phcn", "ekedc", "ikedc", "dstv",
                "gotv", "startimes", "cable", "internet", "isp", "airtime",
                "mtn", "glo", "airtel", "9mobile", "data bundle", "water board"],
    category: "Utilities" },

  // Health
  { keywords: ["pharmacy", "hospital", "clinic", "medical", "health",
                "diagnostic", "laboratory"],
    category: "Health" },

  // Education
  { keywords: ["school", "university", "college", "tuition", "education",
                "academy", "institute"],
    category: "Education" },

  // Subscriptions
  { keywords: ["netflix", "spotify", "youtube", "apple.com", "google play",
                "amazon prime", "subscription", "icloud"],
    category: "Subscriptions" },

  // Entertainment
  { keywords: ["cinema", "film house", "concert", "event", "tickets",
                "entertainment", "betting", "bet9ja", "sportybet"],
    category: "Entertainment" },

  // Shopping
  { keywords: ["shopping", "mall", "store", "amazon", "jumia", "konga",
                "aliexpress"],
    category: "Shopping" },

  // Travel
  { keywords: ["airline", "flight", "hotel", "booking", "travel", "air peace",
                "dana air", "arik"],
    category: "Travel" },

  // Salary / Income (credits)
  { keywords: ["salary", "payroll", "wage"],
    category: "Salary" },

  // Savings
  { keywords: ["savings", "fixed deposit", "piggyvest", "cowrywise"],
    category: "Savings & Deposits" },

  // Transfer — surname matching handled separately; this catches generic labels
  { keywords: ["transfer", "trf"],
    category: "Transfer" },
];

export function inferCategoryFromKeywords(tx: ParsedTx, userLastName?: string): { name: string; reason: string } | null {
  const text = `${tx.payee ?? ""} ${tx.memo ?? ""}`.toLowerCase();

  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (text.includes(kw)) {
        return { name: rule.category, reason: `keyword "${kw}" in transaction text` };
      }
    }
  }

  // Heuristic: if the user's surname appears in the payee, likely a family transfer
  if (userLastName) {
    const surname = userLastName.toLowerCase();
    const payee = (tx.payee ?? "").toLowerCase();
    if (payee.includes(surname) && tx.kind === "expense") {
      return { name: "Transfer", reason: `payee shares surname "${userLastName}"` };
    }
  }

  return null;
}

export async function commitParsedTransactions(
  admin: SupabaseClient,
  userId: string,
  ingestionId: string,
  parsedTransactions: ParsedTx[],
  opts: CommitOptions = {},
): Promise<CommitResult> {
  // Load user rules (highest priority first)
  const { data: rules } = await admin
    .from("rules")
    .select("id, match_field, match_op, match_value, set_category_name, set_tags, set_memo")
    .eq("user_id", userId)
    .eq("active", true)
    .order("priority", { ascending: false });

  // Build category name → id map
  const { data: cats } = await admin
    .from("categories")
    .select("id, name")
    .eq("user_id", userId);

  const catMap = new Map<string, string>();
  for (const c of cats ?? []) {
    catMap.set(c.name.toLowerCase(), c.id);
  }

  // Account name → id map, for matching AI-inferred source accounts. Unmatched
  // inferences stay in original_ai_data so the inbox can propose creating them.
  const { data: accounts } = await admin
    .from("accounts")
    .select("id, name")
    .eq("user_id", userId)
    .eq("is_archived", false);

  const accountMap = new Map<string, string>();
  for (const a of accounts ?? []) {
    accountMap.set(a.name.toLowerCase(), a.id);
  }

  const committed: unknown[] = [];
  const insertErrors: string[] = [];
  let duplicates = 0;
  let rulesApplied = 0;

  for (const parsed of parsedTransactions) {
    // --- apply rules (first match wins) ---
    let categoryId: string | null = null;
    let finalTags = [...(parsed.tags ?? [])];
    let finalMemo = parsed.memo ?? null;

    for (const rule of (rules ?? []) as Rule[]) {
      if (ruleMatches(rule, parsed)) {
        if (rule.set_category_name) {
          const cid = catMap.get(rule.set_category_name.toLowerCase());
          if (cid) categoryId = cid;
        }
        if (rule.set_tags?.length) {
          finalTags = [...new Set([...finalTags, ...rule.set_tags])];
        }
        if (rule.set_memo) finalMemo = rule.set_memo;
        rulesApplied++;
        break;
      }
    }

    // Fall back to the AI-suggested category when no rule matched
    if (!categoryId && parsed.category) {
      const key = parsed.category.toLowerCase();
      // Tolerate "Group: Parent > Child" style paths from the model.
      const cid = catMap.get(key)
        ?? catMap.get(key.split(">").pop()!.trim())
        ?? catMap.get(key.split(":").pop()!.trim());
      if (cid) categoryId = cid;
    }

    // Fall back to keyword-based inference when no rule or AI matched
    if (!categoryId) {
      const inferred = inferCategoryFromKeywords(parsed);
      if (inferred) {
        const cid = catMap.get(inferred.name.toLowerCase());
        if (cid) {
          categoryId = cid;
          parsed.category_reason = inferred.reason;
        }
      }
    }

    // --- source account: explicit (imports) beats AI-inferred name match ---
    const inferredAccountId = parsed.account?.name
      ? accountMap.get(parsed.account.name.trim().toLowerCase()) ?? null
      : null;
    const accountId = opts.accountId ?? inferredAccountId;

    // --- duplicate detection (reference ID is a strong signal) ---
    let duplicateGroupId: string | null = null;
    const { data: dupId } = await admin.rpc("find_duplicate", {
      p_user_id:     userId,
      p_payee:       parsed.payee ?? null,
      p_amount:      parsed.amount,
      p_occurred_at: parsed.occurred_at,
      p_reference:   parsed.reference?.trim() || null,
    });

    if (dupId) {
      duplicates++;
      const { data: existingTx } = await admin
        .from("transactions")
        .select("duplicate_group_id")
        .eq("id", dupId)
        .single();

      duplicateGroupId = existingTx?.duplicate_group_id ?? crypto.randomUUID();

      if (!existingTx?.duplicate_group_id) {
        await admin
          .from("transactions")
          .update({ duplicate_group_id: duplicateGroupId })
          .eq("id", dupId);
      }
    }

    // --- insert into the review inbox ---
    const { data: tx, error: txErr } = await admin
      .from("transactions")
      .insert({
        user_id:            userId,
        account_id:         accountId,
        category_id:        categoryId,
        kind:               parsed.kind ?? "expense",
        occurred_at:        parsed.occurred_at,
        amount:             parsed.amount,
        currency:           parsed.currency ?? "USD",
        payee:              parsed.payee ?? null,
        memo:               finalMemo,
        tags:               finalTags,
        metadata:           parsed.reference?.trim() ? { reference: parsed.reference.trim() } : {},
        original_ai_data:   parsed,
        review_status:      "pending_review",
        ingestion_id:       ingestionId,
        duplicate_group_id: duplicateGroupId,
      })
      .select("id, review_status, duplicate_group_id, payee, amount, currency, occurred_at")
      .single();

    if (txErr) {
      console.error("[commit] tx insert error", txErr.message, "for parsed", JSON.stringify(parsed));
      insertErrors.push(
        `${parsed.payee ?? "(no payee)"} · ${parsed.amount} ${parsed.currency}: ${txErr.message}`,
      );
    } else if (tx) {
      committed.push(tx);
    }
  }

  if (opts.markApplied) {
    await admin
      .from("media_ingestions")
      .update({ status: "applied" })
      .eq("id", ingestionId);
  }

  // Persist the failure reason on the ingestion so the Activity page shows why
  // an extraction produced fewer (or zero) inbox rows than expected.
  if (insertErrors.length) {
    await admin
      .from("media_ingestions")
      .update({ error: `commit: ${insertErrors.join(" | ")}`.slice(0, 1000) })
      .eq("id", ingestionId);
  }

  return {
    committed: committed.length,
    duplicates,
    rulesApplied,
    transactions: committed,
    insertErrors,
  };
}
