/* Values that more than one screen depends on. Anything a page would otherwise
   hard-code — a storage key, a page size, an enum's display labels — belongs
   here so the two places that use it can never drift apart. */

import type { AccountType, BudgetLineKind, BudgetPeriod, Transaction } from "./types";

/* --- Browser storage -------------------------------------------------------
   One namespace so a stray key is obvious in devtools, and clearing Sagebook's
   state is a single prefix scan. */

export const STORAGE_KEYS = {
    /** Supabase URL + anon key from the one-time connect screen. */
    config: "sagebook.webapp.config",
    /** "light" | "dark" — read before first paint in useTheme. */
    theme: "sb-theme",
    /** Account id the last accepted capture was filed under. */
    lastAccount: "sagebook.webapp.lastAccount",
    /** Saved column mappings, keyed by statement header signature. */
    importTemplates: "sagebook.webapp.importTemplates",
    /** "1" while the desktop sidebar is collapsed to its icon rail. */
    sidebarCollapsed: "sagebook.webapp.sidebarCollapsed",
} as const;

/* --- Money -----------------------------------------------------------------
   Sagebook is multi-currency; this is only the fallback for a brand-new form or
   an empty ledger with nothing to infer from. */

export const DEFAULT_CURRENCY = "USD";

/* --- Paging + limits ------------------------------------------------------- */

/** Ledger rows fetched per page. */
export const TRANSACTION_PAGE_SIZE = 200;
/** Rows the export endpoint will pull in one go. */
export const EXPORT_ROW_LIMIT = 10_000;
/** Sanity ceiling on a single statement import (the backend batches beneath it). */
export const IMPORT_MAX_ROWS = 10_000;
/** Net-worth snapshots loaded for a trend line — roughly a year of dailies. */
export const SNAPSHOT_LIMIT = 365;
/** Rows in the dashboard's "recent activity" list. */
export const RECENT_TRANSACTION_LIMIT = 6;

/* --- Email ingestion -------------------------------------------------------- */

export const INGEST_DOMAIN = "ingest.sagebook.app";

/* --- Enum display labels ---------------------------------------------------
   The database stores snake_case; these are the only place it becomes prose. */

export type TransactionKind = Transaction["kind"];

export const TRANSACTION_KINDS: TransactionKind[] = [
    "income",
    "expense",
    "transfer",
    "adjustment",
];

export const ACCOUNT_TYPES: Array<{ value: AccountType; label: string }> = [
    { value: "cash", label: "Cash" },
    { value: "checking", label: "Checking" },
    { value: "savings", label: "Savings" },
    { value: "credit_card", label: "Credit card" },
    { value: "loan", label: "Loan" },
    { value: "investment", label: "Investment" },
    { value: "retirement", label: "Retirement" },
    { value: "real_estate", label: "Real estate" },
    { value: "vehicle", label: "Vehicle" },
    { value: "crypto", label: "Crypto" },
    { value: "other_asset", label: "Other asset" },
    { value: "other_liability", label: "Other liability" },
];

export function accountTypeLabel(type: AccountType | string): string {
    return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? String(type).replace(/_/g, " ");
}

/** Asset classes, in the order Accounts and the dashboard stack them. */
export const ACCOUNT_SECTIONS: Array<{ label: string; types: AccountType[] }> = [
    { label: "Cash", types: ["cash", "checking", "savings"] },
    { label: "Investments", types: ["investment", "retirement", "crypto"] },
    { label: "Property", types: ["real_estate", "vehicle"] },
    { label: "Credit", types: ["credit_card"] },
    { label: "Loans", types: ["loan", "other_liability"] },
    { label: "Other", types: ["other_asset"] },
];

export const BUDGET_KIND_LABELS: Record<BudgetLineKind, string> = {
    income: "Income",
    expense: "Expense",
    saving: "Saving",
    transfer: "Transfer",
};

export const BUDGET_PERIODS: Array<{ value: BudgetPeriod; label: string }> = [
    { value: "monthly", label: "Monthly" },
    { value: "quarterly", label: "Quarterly" },
    { value: "yearly", label: "Yearly" },
    { value: "custom", label: "Custom" },
];
