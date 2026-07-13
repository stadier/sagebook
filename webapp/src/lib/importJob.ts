// A module-level import job so a long statement import survives the modal
// being minimized (closed) and the user navigating around. The batched loop
// lives here, not in any component, so it runs to completion regardless of
// what is mounted. A persistent progress bar subscribes via useImportJob().

import { useSyncExternalStore } from "react";
import type { ImportTx } from "./importer";
import { logEvent } from "./logger";
import { invokeFn } from "./supabase";

export interface ImportJobState {
    status: "idle" | "running" | "done" | "error";
    filename: string;
    total: number;
    processed: number;
    committed: number;
    duplicates: number;
    error?: string;
}

const IDLE: ImportJobState = {
    status: "idle",
    filename: "",
    total: 0,
    processed: 0,
    committed: 0,
    duplicates: 0,
};

let state: ImportJobState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<ImportJobState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
}

export function useImportJob(): ImportJobState {
    return useSyncExternalStore(subscribe, () => state, () => state);
}

export function importJobRunning(): boolean {
    return state.status === "running";
}

/** Clear a finished/errored job (no-op while running). */
export function dismissImportJob() {
    if (state.status !== "running") set(IDLE);
}

/** Rows per request. Keeps each call well under the function's per-call cap and
 *  gives the progress bar meaningful granularity. */
const BATCH = 100;

interface BatchResult {
    ingestionId: string;
    committed: number;
    duplicates: number;
    insertErrors?: string[];
}

/**
 * Kick off a batched import. Returns immediately-ish; progress is observable
 * via useImportJob(). Only one import runs at a time.
 */
export async function startImport(opts: {
    txs: ImportTx[];
    accountId: string | null;
    storagePath: string | null;
    filename: string;
}): Promise<void> {
    if (state.status === "running") {
        throw new Error("an import is already running");
    }
    const total = opts.txs.length;
    set({
        status: "running",
        filename: opts.filename,
        total,
        processed: 0,
        committed: 0,
        duplicates: 0,
        error: undefined,
    });

    try {
        let ingestionId: string | null = null;
        let committed = 0;
        let duplicates = 0;

        for (let i = 0; i < total; i += BATCH) {
            const chunk = opts.txs.slice(i, i + BATCH);
            const r: BatchResult = await invokeFn<BatchResult>("ingest-import", {
                transactions: chunk,
                accountId: opts.accountId,
                // Archive + create the ingestion on the first batch only.
                storagePath: i === 0 ? opts.storagePath : null,
                filename: opts.filename,
                totalRows: total,
                ingestionId,
            });
            ingestionId = r.ingestionId ?? ingestionId;
            committed += r.committed ?? 0;
            duplicates += r.duplicates ?? 0;
            set({
                processed: Math.min(i + chunk.length, total),
                committed,
                duplicates,
            });
        }

        set({ status: "done" });
        logEvent("info", "import", `Import finished: ${committed}/${total} from ${opts.filename}`, {
            committed,
            duplicates,
            total,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ status: "error", error: message });
        logEvent("error", "import", `Import failed mid-run: ${message}`, {
            filename: opts.filename,
            processed: state.processed,
            total,
        });
    }
}
