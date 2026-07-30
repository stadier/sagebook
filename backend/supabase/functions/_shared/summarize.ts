// =============================================================================
// Sagebook · Transaction summaries
// -----------------------------------------------------------------------------
// Turns bank narration into one line a person can skim. The narration on a
// Nigerian statement row reads like this:
//
//   "NIP CR/MOB/ZAMBABAY HOMES AND PROPERTIES INVESTMENT LIMITED/TAJ /
//    Family land development payment"
//
// and should read like this:
//
//   "Sent ₦1m to Zambabay Homes for family land development"
//
// Rows are summarized in batches: one model call covers many transactions, so
// importing a few hundred statement rows costs a handful of calls rather than
// one per row.
// =============================================================================

import { generateJson, safeParse } from "./extract.ts";

/** Transactions per model call. Small enough that a batch never truncates. */
export const SUMMARY_BATCH = 25;

export interface SummarizableTx {
    id: string;
    kind: string;
    amount: number;
    currency: string;
    occurred_at: string;
    payee: string | null;
    memo: string | null;
    reference?: string | null;
    category?: string | null;
    account?: string | null;
}

export interface SummaryResult {
    id: string;
    summary: string;
}

const SUMMARY_SCHEMA = {
    type: "object",
    properties: {
        summaries: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    i:       { type: "number" },
                    summary: { type: "string" },
                },
                required: ["i", "summary"],
            },
        },
    },
    required: ["summaries"],
} as const;

export const SUMMARY_SYSTEM = `You write one-line plain-language summaries of ledger transactions.

You are given a numbered list of transactions taken from bank statements,
receipts, and notes. For each one, return a single sentence that says what
actually happened, as the account holder would describe it to someone else.

Rules:
- One sentence, at most 100 characters. No trailing period.
- Say the direction in plain words: money leaving is "Sent"/"Paid"/"Bought",
  money arriving is "Received"/"Refund from". Bank deductions are "charge",
  "fee", "duty", or "tax" — not "sent".
- Name the counterparty as a person or company would be named, not as the bank
  wrote it: strip channel prefixes and routing codes (NIP, NIP CR, MOB, TRF,
  ETI, NXG, ZIB, ISW, FRM, session/reference strings, trailing slash codes) and
  convert SHOUTING to normal capitalisation. "ZAMBABAY HOMES AND PROPERTIES
  INVESTMENT LIMITED" → "Zambabay Homes".
- Keep the purpose when the narration states one — it is the most useful part.
  It usually sits after the last "/" or "//".
- Include the amount only when it genuinely helps the sentence read naturally;
  the list already shows it. Prefer short forms (₦1.2m, ₦50k) if you do.
- For a charge whose narration quotes the transaction it came from, say what it
  was on: "Stamp duty on the transfer to Zambabay Homes".
- Never invent a counterparty, purpose, or figure that is not in the input. If
  the narration says nothing useful, describe only what is certain
  (e.g. "Transfer out" / "Cash deposit").
- Write in the account holder's voice without saying "I" or "you".

Return one entry per input transaction, keyed by its number 'i'.`;

/** Compact one transaction into the prompt line the model reads. */
function promptLine(tx: SummarizableTx, i: number): string {
    const date = tx.occurred_at.slice(0, 10);
    const bits = [
        `${i}.`,
        `[${tx.kind}]`,
        `${tx.amount} ${tx.currency}`,
        date,
    ];
    if (tx.account)  bits.push(`account="${tx.account}"`);
    if (tx.category) bits.push(`category="${tx.category}"`);
    if (tx.payee)    bits.push(`payee="${tx.payee}"`);
    // The memo carries the raw narration and is the main signal; keep it last
    // and untruncated unless it is pathological.
    if (tx.memo && tx.memo !== tx.payee) bits.push(`narration="${tx.memo.slice(0, 400)}"`);
    return bits.join(" ");
}

/**
 * Summarize one batch. Returns only the rows the model answered for — a missing
 * entry leaves that transaction unsummarized so the next run retries it.
 */
export async function summarizeBatch(
    txs: SummarizableTx[],
): Promise<{ results: SummaryResult[]; model: string }> {
    if (!txs.length) return { results: [], model: "" };

    const user = txs.map((tx, i) => promptLine(tx, i + 1)).join("\n");
    const { raw, model } = await generateJson({
        system: SUMMARY_SYSTEM,
        user,
        schema: SUMMARY_SCHEMA as unknown as Record<string, unknown>,
        schemaName: "sagebook_transaction_summaries",
    });

    const parsed = safeParse<{ summaries?: Array<{ i: number; summary: string }> }>(raw);
    if (!parsed?.summaries) {
        throw new Error("summary model returned no 'summaries' array");
    }

    const results: SummaryResult[] = [];
    for (const entry of parsed.summaries) {
        const tx = txs[Math.round(entry.i) - 1];
        const summary = (entry.summary ?? "").trim().replace(/\s+/g, " ");
        if (!tx || !summary) continue;
        results.push({ id: tx.id, summary: summary.slice(0, 200) });
    }
    return { results, model };
}
