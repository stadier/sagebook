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
}

export interface Rule {
    id: string;
    name: string;
    priority: number;
    active: boolean;
    match_field: "payee" | "memo" | "kind";
    match_op: "contains" | "equals" | "starts_with" | "regex";
    match_value: string;
    set_category_name: string | null;
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
    tags: string[];
    category_id: string | null;
    account_id: string | null;
    review_status: "pending_review" | "accepted" | "rejected";
    duplicate_group_id: string | null;
    ingestion_id: string | null;
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

export interface InferredAccount {
    name?: string;
    institution?: string;
    number_masked?: string;
}

export interface ParsedTransaction {
    occurred_at: string;
    amount: number;
    currency: string;
    kind: string;
    payee?: string;
    memo?: string;
    category?: string;
    tags?: string[];
    account?: InferredAccount;
    reference?: string;
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
