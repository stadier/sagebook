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
    created_at: string;
}

/** Row shape of v_pending_review (transaction + category + ingestion joins). */
export interface PendingTransaction extends Transaction {
    category_name: string | null;
    category_color: string | null;
    category_icon: string | null;
    media_kind: string | null;
    ingestion_model: string | null;
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
}

export interface ProcessMediaResult {
    ingestionId: string;
    provider: string;
    model: string;
    parsed: {
        summary: string;
        confidence: number;
        transactions: ParsedTransaction[];
    };
    committed: number;
    duplicates: number;
    rulesApplied: number;
    inbox: Array<{
        id: string;
        payee: string | null;
        amount: number;
        currency: string;
        occurred_at: string;
        duplicate_group_id: string | null;
    }>;
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
