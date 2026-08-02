export interface CategoryGroup {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    sort_order: number;
}

export interface Category {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
    parent_id: string | null;
    group_id: string | null;
    /** Hand-arranged position within the group — what the board's drag writes.
     *  Optional so the app still renders against a database that predates the
     *  column; ordering then falls back to the name. */
    sort_order?: number;
}

export type AccountType =
    | "cash"
    | "checking"
    | "savings"
    | "credit_card"
    | "loan"
    | "investment"
    | "retirement"
    | "real_estate"
    | "vehicle"
    | "crypto"
    | "other_asset"
    | "other_liability";

export interface Account {
    id: string;
    name: string;
    type: AccountType;
    currency: string;
    institution: string | null;
    opening_balance: number;
    is_archived: boolean;
    metadata?: { number_masked?: string; auto_balance?: boolean } | null;
}

export interface Rule {
    id: string;
    name: string;
    priority: number;
    active: boolean;
    match_field: "payee" | "memo" | "kind";
    match_op: "contains" | "equals" | "starts_with" | "regex";
    match_value: string;
    /** Foreign key, not a name — renaming a category must not break the rule. */
    set_category_id: string | null;
    set_tags: string[];
    set_memo: string | null;
}

export interface Transaction {
    id: string;
    kind: "income" | "expense" | "transfer" | "adjustment";
    occurred_at: string;
    amount: number;
    currency: string;
    payee: string | null;
    memo: string | null;
    /** Generated one-line reading of the row; null until summarized. */
    summary: string | null;
    /** Model that wrote `summary`, or "user" when hand-edited. */
    summary_model: string | null;
    summary_at: string | null;
    tags: string[];
    /** Provenance from the source document — currently the bank reference. */
    metadata: { reference?: string } | null;
    category_id: string | null;
    account_id: string | null;
    review_status: "pending_review" | "accepted" | "rejected";
    duplicate_group_id: string | null;
    ingestion_id: string | null;
    original_ai_data?: ParsedTransaction | null;
    created_at: string;
}

/** Row shape of v_pending_review (transaction + category + ingestion joins). */
export interface PendingTransaction extends Transaction {
    category_name: string | null;
    category_color: string | null;
    category_icon: string | null;
    media_kind: string | null;
    ingestion_model: string | null;
    original_ai_data: ParsedTransaction | null;
}

/** Row shape of v_account_balances. */
export interface AccountWithBalance extends Account {
    current_balance: number;
    metadata: { auto_balance?: boolean; number_masked?: string } | null;
}

export type Recurrence = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";

export interface ScheduledTransaction {
    id: string;
    name: string;
    kind: "income" | "expense" | "transfer" | "adjustment";
    schedule_kind: "recurring" | "one_off";
    recurrence: Recurrence | null;
    amount: number;
    currency: string;
    account_id: string | null;
    category_id: string | null;
    payee: string | null;
    memo: string | null;
    next_due: string;
    active: boolean;
    auto_post: boolean;
    last_posted_at: string | null;
}

export interface InferredAccount {
    name?: string;
    institution?: string;
    number_masked?: string;
    /** One short sentence explaining why this account was chosen/proposed. */
    reason?: string;
}

export interface LineItem {
    description: string;
    quantity?: number;
    amount?: number;
}

export interface ParsedTransaction {
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
    account?: InferredAccount;
    reference?: string;
    line_items?: LineItem[];
}

export interface ProcessMediaResult {
    ingestionId: string;
    provider: string;
    model: string;
    parsed: {
        summary: string;
        confidence: number;
        transactions: ParsedTransaction[];
        transcript?: string;
    };
    committed: number;
    duplicates: number;
    rulesApplied: number;
    insertErrors?: string[];
    inbox: Array<{
        id: string;
        payee: string | null;
        amount: number;
        currency: string;
        occurred_at: string;
        duplicate_group_id: string | null;
    }>;
}

export interface NetWorthBreakdownEntry {
    account_id: string;
    name: string;
    type: string;
    currency: string;
    balance: number;
    base_amount: number | null;
    rate_missing: boolean;
}

export interface NetWorthSnapshot {
    id: string;
    as_of: string;
    base_currency: string;
    assets: number;
    liabilities: number;
    net_worth: number;
    breakdown: NetWorthBreakdownEntry[];
}

export interface MonthlySummaryRow {
    month: string;
    kind: string;
    currency: string;
    total_amount: number;
    tx_count: number;
}

export interface CategorySummaryRow {
    month: string;
    category_group: string;
    category: string;
    color: string | null;
    icon: string | null;
    currency: string;
    total_amount: number;
    tx_count: number;
}

export interface IngestAddress {
    id: string;
    slug: string;
    is_active: boolean;
    created_at: string;
}

export type BudgetPeriod = "monthly" | "quarterly" | "yearly" | "custom";
export type BudgetLineKind = "income" | "expense" | "saving" | "transfer";

export interface Budget {
    id: string;
    name: string;
    period_kind: BudgetPeriod;
    starts_on: string;
    ends_on: string;
    currency: string;
    is_template: boolean;
    cloned_from: string | null;
    notes: string | null;
    created_at: string;
    updated_at: string;
}

export interface BudgetCategory {
    id: string;
    budget_id: string;
    category_id: string | null;
    group_id: string | null;
    label: string | null;
    kind: BudgetLineKind;
    planned_amount: number;
    rollover: boolean;
    sort_order: number;
    notes: string | null;
}

export interface BudgetAllocation {
    id: string;
    budget_category_id: string;
    month: string;
    amount: number;
}

export interface BudgetProgress {
    budget_category_id: string;
    budget_id: string;
    category_id: string | null;
    group_id: string | null;
    label: string;
    kind: BudgetLineKind;
    planned_amount: number;
    rollover: boolean;
    sort_order: number;
    actual_amount: number;
    remaining: number;
    pct_used: number;
    tx_count: number;
}
