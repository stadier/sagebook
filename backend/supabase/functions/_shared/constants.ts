// =============================================================================
// Sagebook · Shared edge-function constants
// -----------------------------------------------------------------------------
// Enum values and size caps that more than one function enforces. Keeping the
// ledger's kinds in one place means a new kind is added once, not in whichever
// validator happened to list them.
// =============================================================================

/** Every kind a ledger row may take. Mirrors the transactions.kind enum. */
export const TRANSACTION_KINDS = ["income", "expense", "transfer", "adjustment"] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(TRANSACTION_KINDS);

export function isTransactionKind(value: unknown): value is TransactionKind {
  return typeof value === "string" && KIND_SET.has(value);
}

/** Review outcomes a reviewer may apply to a pending row. */
export const REVIEW_ACTIONS = ["accept", "reject", "edit", "merge", "unlink"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** The subset valid for the bulk endpoint — merge and edit need per-row input. */
export const BULK_REVIEW_ACTIONS = ["accept", "reject"] as const;

/** Fields a reviewer is allowed to patch on a pending transaction. */
export const PATCHABLE_FIELDS: ReadonlySet<string> = new Set([
  "amount",
  "currency",
  "occurred_at",
  "payee",
  "memo",
  "category_id",
  "account_id",
  "tags",
  "kind",
]);

/** Rows accepted in one statement-import request; the client batches above it. */
export const IMPORT_MAX_ROWS = 1000;

/** Largest object we will inline into a model request (base64 adds ~33%). */
export const MAX_INLINE_BYTES = 15 * 1024 * 1024;

/** Largest upload the storage proxy will accept. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Lifetime of a signed download URL, in seconds. */
export const SIGNED_URL_TTL_SECONDS = 3600;
