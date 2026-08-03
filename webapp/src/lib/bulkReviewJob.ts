// Module-level bulk review progress so large inbox actions can show a
// persistent loading bar while chunked requests run in the background.

import { useSyncExternalStore } from "react";

export interface BulkReviewJobState {
	status: "idle" | "running" | "done" | "error";
	action: "accept" | "reject" | "";
	total: number;
	processed: number;
	error?: string;
}

const IDLE: BulkReviewJobState = {
	status: "idle",
	action: "",
	total: 0,
	processed: 0,
};

let state: BulkReviewJobState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<BulkReviewJobState>) {
	state = { ...state, ...patch };
	listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
	listeners.add(l);
	return () => listeners.delete(l);
}

export function useBulkReviewJob(): BulkReviewJobState {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => state,
	);
}

export function bulkReviewRunning(): boolean {
	return state.status === "running";
}

export function startBulkReview(opts: {
	total: number;
	action: "accept" | "reject";
}) {
	if (state.status === "running") {
		throw new Error("a bulk review is already running");
	}
	set({
		status: "running",
		action: opts.action,
		total: opts.total,
		processed: 0,
		error: undefined,
	});
}

export function advanceBulkReview(processed: number) {
	if (state.status !== "running") return;
	set({ processed });
}

/**
 * Mark the job done. `processed` is the server-confirmed count when known, so
 * the final card shows what actually changed rather than assuming every
 * requested row was touched.
 */
export function finishBulkReview(processed?: number) {
	if (state.status !== "running") return;
	set({ status: "done", processed: processed ?? state.total });
}

export function failBulkReview(error: string) {
	set({ status: "error", error });
}

export function dismissBulkReview() {
	if (state.status !== "running") set(IDLE);
}
