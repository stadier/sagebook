// Background summary generation. Like importJob, the loop lives at module level
// so it survives navigation and modal closes — a 263-row statement takes several
// round trips and the user should not have to sit on one screen for them.
//
// The endpoint drains a backlog rather than summarizing a named set, so this is
// safe to call at any time from anywhere: a second call while one is running is
// a no-op, and an interrupted run is picked up by the next one.

import { useSyncExternalStore } from "react";
import { logEvent } from "./logger";
import { invokeFn } from "./supabase";

export interface SummaryJobState {
	status: "idle" | "running" | "done" | "error";
	/** Rows summarized during this run. */
	summarized: number;
	/** Rows still without a summary, as of the last response. */
	remaining: number;
	error?: string;
}

const IDLE: SummaryJobState = { status: "idle", summarized: 0, remaining: 0 };

let state: SummaryJobState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<SummaryJobState>) {
	state = { ...state, ...patch };
	listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function useSummaryJob(): SummaryJobState {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => state,
	);
}

export function summaryJobRunning(): boolean {
	return state.status === "running";
}

export function dismissSummaryJob() {
	if (state.status !== "running") set(IDLE);
}

interface SummarizeResponse {
	summarized: number;
	failed: number;
	remaining: number;
	model: string | null;
	errors?: string[];
}

/** Progress made so far, so a partial run can report what it did achieve. */
function partial(summarized: number): string {
	return summarized ? ` (${summarized} summarized before this)` : "";
}

/** Rows per request — matches the function's default page size. */
const PAGE = 100;
/** Stop after this many round trips so a runaway backlog cannot loop forever. */
const MAX_CALLS = 30;

/**
 * Drain the un-summarized backlog. Resolves when the backlog is empty, the call
 * budget is spent, or a call fails. Safe to fire and forget.
 */
export async function runSummaryBacklog(): Promise<void> {
	if (state.status === "running") return;
	set({ status: "running", summarized: 0, remaining: 0, error: undefined });

	let summarized = 0;
	try {
		for (let call = 0; call < MAX_CALLS; call++) {
			const r = await invokeFn<SummarizeResponse>("summarize-transactions", {
				limit: PAGE,
			});
			summarized += r.summarized ?? 0;
			set({ summarized, remaining: r.remaining ?? 0 });

			// Backlog empty: the only genuinely successful exit.
			if (!r.remaining) break;

			// Nothing moved. Two very different reasons, and reporting them the
			// same way is how a provider outage masqueraded as a finished run:
			//   - rows failed  → the provider is down or refusing; that is an
			//                    error and the user needs to see it.
			//   - nothing failed → the model declined to answer for rows it
			//                    keeps skipping; stop rather than spin.
			if (!r.summarized) {
				if (r.failed) {
					const why = r.errors?.[0]
						? `${r.errors[0]}.`
						: "The AI provider returned no usable response.";
					throw new Error(
						`${r.failed} transactions could not be summarized${partial(summarized)}. ${why}`,
					);
				}
				break;
			}
		}
		set({ status: "done" });
		if (summarized) {
			logEvent("info", "summaries", `Summarized ${summarized} transactions`, {
				summarized,
				remaining: state.remaining,
			});
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		set({ status: "error", error: message });
		logEvent("error", "summaries", `Summary generation failed: ${message}`, {
			summarized,
		});
	}
}

/** Regenerate specific rows (ignored for summaries the user edited by hand). */
export async function regenerateSummaries(
	ids: string[],
): Promise<SummarizeResponse> {
	return invokeFn<SummarizeResponse>("summarize-transactions", {
		ids,
		force: true,
	});
}
