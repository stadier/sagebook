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
- Copy names letter for letter. You may change capitalisation and drop trailing
  words, never spelling: "EMEKOBA" → "Emekoba", never "Emekooba". A name you
  cannot read confidently is better left out than guessed at.
- Put the purpose after the counterparty, not before: "Sent ₦200k to Precious
  Effiom Eyo for event planning", not "Sent ₦200k for event planning to Precious
  Effiom Eyo".
- Bank deductions (charges, VAT, stamp duty, SMS alerts, card and maintenance
  fees) have no counterparty at all. Describe the charge itself — "Transfer
  charge and VAT", "SMS alert charge for June" — and never attach a name to it
  unless the narration quotes the transaction it was levied on.
- Keep the purpose when the narration states one — it is the most useful part.
  It usually sits after the last "/" or "//".
- Include the amount only when it genuinely helps the sentence read naturally;
  the list already shows it. Prefer short forms (₦1.2m, ₦50k) if you do.
- Any figure you write must be THIS transaction's amount. Narration often
  quotes running totals and balances owed — "Wtrfrnt 4m 15k agent, total 48m,
  REM 12m" — and those are somebody else's arithmetic, not what moved here.
  Quote them only as context after the amount, never in its place.
- The direction comes from the transaction's kind, not from the wording of the
  narration. A row marked income was money in, even if the narration reads
  "TRF TO ..." — describe what the ledger records.
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
    // The owning account is deliberately withheld. It is the holder's own side
    // of the movement, and given it the model reaches for it as the
    // counterparty — "Paid Vycount Estates charge and VAT" for a bank fee that
    // has no counterparty at all. The ledger already knows which account a row
    // belongs to, so the summary gains nothing from repeating it.
    if (tx.category) bits.push(`category="${tx.category}"`);
    if (tx.payee)    bits.push(`payee="${tx.payee}"`);
    // The memo carries the raw narration and is the main signal; keep it last
    // and untruncated unless it is pathological.
    if (tx.memo && tx.memo !== tx.payee) bits.push(`narration="${tx.memo.slice(0, 400)}"`);
    return bits.join(" ");
}

/**
 * Vocabulary a summary is allowed to use without the word appearing in the
 * source: the sentence frame itself (direction verbs, fee nouns, connectives,
 * dates). Everything else — names, purposes, places — has to come from the
 * transaction, or it was invented.
 */
const SUMMARY_VOCABULARY = new Set([
    // direction and framing
    "sent", "paid", "received", "refund", "refunded", "bought", "spent",
    "transfer", "transferred", "deposit", "deposited", "withdrawal", "withdrew",
    "payment", "repayment", "from", "into", "with", "this", "that", "their",
    "self", "own", "back", "each", "over", "under", "about", "plus",
    // fees and bank furniture
    "charge", "charges", "fee", "fees", "duty", "stamp", "levy", "alert",
    "alerts", "maintenance", "commission", "interest", "reversal", "reversed",
    "bank", "card", "cash", "account", "balance", "opening", "closing",
    "value", "added", "withholding",
    // time
    "january", "february", "march", "april", "june", "july", "august",
    "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "week", "month", "year", "daily", "monthly", "yearly", "annual",
]);

/** Money figures in a summary: "₦4m", "₦200k", "₦23,000", "4.5m". */
const FIGURE_RE = /₦\s*([\d][\d,]*(?:\.\d+)?)\s*([mkb])?/gi;

function figureValue(digits: string, suffix?: string): number {
    const n = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(n)) return Number.NaN;
    const scale = suffix?.toLowerCase() === "b" ? 1e9
                : suffix?.toLowerCase() === "m" ? 1e6
                : suffix?.toLowerCase() === "k" ? 1e3
                : 1;
    return n * scale;
}

/**
 * If a summary quotes a money figure, one of them has to be this transaction's
 * own amount.
 *
 * Statement narration is full of other people's numbers — "Wtrfrnt 4m 15k
 * agent, total 48m, REM 12m" — and a model handed that will confidently open
 * with "Sent ₦48m" on a ₦4,015,000 row. The figure is real, it is in the
 * source, and it is not what moved. Rounding is allowed (₦4.02m for
 * ₦4,015,000); picking the wrong number is not.
 */
export function amountIsFaithful(summary: string, amount: number): boolean {
    const figures: number[] = [];
    for (const m of summary.matchAll(FIGURE_RE)) {
        const v = figureValue(m[1], m[2]);
        if (Number.isFinite(v)) figures.push(v);
    }
    if (!figures.length) return true; // no claim made, nothing to contradict

    // 1.5% covers "₦4.02m" for 4,015,000 and "₦1.2m" for 1,200,000 without
    // letting a genuinely different figure through.
    return figures.some((v) => Math.abs(v - amount) <= Math.max(amount * 0.015, 1));
}

/**
 * Reject a summary that asserts something the transaction does not say.
 *
 * A weaker model will happily turn a bare "NIP CR/MOB/RUSSELL EMEKOBA/ABN /"
 * into "Sent ₦600k to Russell Emekoba for rent" — the direction and name are
 * right and the purpose is fiction. Every content word therefore has to be
 * traceable to the row it describes; anything else and we keep the summary null
 * so the list falls back to the raw narration. A missing summary is recoverable,
 * a confident wrong one is not.
 */
export function summaryIsGrounded(summary: string, tx: SummarizableTx): boolean {
    const source = [tx.payee, tx.memo, tx.category, tx.currency, tx.kind]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    // Words of four letters or more carry the meaning; shorter ones are
    // articles and prepositions that cannot smuggle in a claim.
    const words = summary.toLowerCase().match(/[a-z][a-z']{3,}/g) ?? [];
    return words.every(
        (w) =>
            SUMMARY_VOCABULARY.has(w) ||
            source.includes(w) ||
            // Tolerate an inflection of a source word ("planning" → "planned").
            source.includes(w.slice(0, Math.max(4, w.length - 3))),
    );
}

/**
 * Summarize one batch. Returns only the rows the model answered for and whose
 * summary is grounded in the transaction — anything dropped stays unsummarized
 * so a later run can retry it.
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
    let rejected = 0;
    for (const entry of parsed.summaries) {
        const tx = txs[Math.round(entry.i) - 1];
        const summary = (entry.summary ?? "").trim().replace(/\s+/g, " ");
        if (!tx || !summary) continue;
        if (!summaryIsGrounded(summary, tx)) {
            rejected++;
            console.warn(`[summarize] ungrounded, dropped: "${summary}" for "${tx.payee ?? tx.memo}"`);
            continue;
        }
        if (!amountIsFaithful(summary, tx.amount)) {
            rejected++;
            console.warn(`[summarize] wrong figure, dropped: "${summary}" for amount ${tx.amount}`);
            continue;
        }
        results.push({ id: tx.id, summary: summary.slice(0, 200) });
    }
    if (rejected) {
        console.warn(`[summarize] dropped ${rejected}/${parsed.summaries.length} ungrounded summaries`);
    }
    return { results, model };
}
