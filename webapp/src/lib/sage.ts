/* Sage's answering layer.

   `lib/console/intents.ts` decides *which dashboard* a question deserves from
   keywords alone; that stays, because the panels are a useful backdrop. This is
   the other half — the actual answer, computed by the `ask-sage` function from
   real queries against the ledger rather than from anything the client guessed.

   The client sends a question and gets back prose plus the figures behind it.
   Nothing here interprets the numbers; that already happened server-side, where
   the data is. */

import { useMutation } from "@tanstack/react-query";
import { invokeFn } from "./supabase";

export interface SageHighlight {
    label: string;
    value: string;
    hint?: string;
}

/** One query the planner ran, kept so the answer can show its working. */
export interface SageQueryResult {
    id: string;
    purpose?: string;
    select: string;
    matched: number;
    truncated?: boolean;
    data: unknown;
}

/** One transaction from a `list` query. */
export interface SageListRow {
    id: string;
    date: string;
    description: string;
    account: string | null;
    category: string | null;
    kind: string;
    amount: number;
    currency: string;
}

/** One row of a `breakdown` query — a group and its per-currency totals. */
export interface SageBreakdownRow {
    group: string;
    count: number;
    totals: Record<string, number>;
}

/**
 * How Sage composes a reply. A `table` block carries no data — only the id of a
 * query in `queries`, whose rows the client renders itself. That is deliberate:
 * the figures reaching the screen are the ones the ledger returned, never a
 * copy the model retyped on the way past.
 */
export type SageBlock =
    | { type: "prose"; text: string }
    | { type: "stats"; title?: string; items: SageHighlight[] }
    | { type: "table"; title?: string; queryId: string };

export interface SageAnswer {
    answer: string;
    /** Absent on older answers, which fall back to `answer` + `highlights`. */
    blocks?: SageBlock[];
    highlights?: SageHighlight[];
    followups?: string[];
    queries: SageQueryResult[];
    model: string;
}

export function askSage(question: string): Promise<SageAnswer> {
    return invokeFn<SageAnswer>("ask-sage", { question });
}

/**
 * One in-flight question at a time — the console shows a single answer, so a
 * second ask replaces the first rather than racing it.
 */
export function useSage() {
    return useMutation({ mutationFn: askSage });
}
