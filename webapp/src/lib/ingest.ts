// Shared ingestion helpers — the single source of truth for the AI extraction
// path (previously duplicated across the Capture and Import pages). Structured
// statement parsing still lives in ./importer; this module owns the media/AI
// path plus the file classification that decides which flow a dropped file
// takes.

import { fileToBase64, uploadToIngest } from "./storage";
import { invokeFn } from "./supabase";
import type { ProcessMediaResult } from "./types";

/** Hard cap before upload; process-media inlines at most 15 MB to the model. */
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** If the storage upload fails (e.g. bucket missing), small files go inline. */
export const INLINE_FALLBACK_MAX = 4 * 1024 * 1024;

/** Extensions that go through deterministic statement parsing (./importer). */
const STRUCTURED_EXTS = ["csv", "txt", "ofx", "qfx", "xls", "xlsx"];

/**
 * Decide how a dropped file should be ingested:
 * - "structured": CSV / Excel / OFX exports → the column-mapping import flow.
 * - "ai": receipts, photos, audio, video, and PDFs → process-media extraction.
 *
 * PDFs are unstructured, so they take the AI path — matching the prior Import
 * page behaviour.
 */
export function classifyFile(file: File): "structured" | "ai" {
    const ext = file.name.toLowerCase().split(".").pop() ?? "";
    // A .txt could be a CSV export; treat it as structured and let the parser
    // decide (it falls back to an OFX check first).
    return STRUCTURED_EXTS.includes(ext) ? "structured" : "ai";
}

export interface ProcessMediaInput {
    /** Freeform note describing what happened. */
    text?: string;
    /** A receipt / photo / voice note / PDF to extract from. */
    file?: File | null;
    /** Optional prompt hint, e.g. "amounts are in NGN". */
    hint?: string;
    /** Nudges the model toward an account, e.g. a statement's owning account. */
    accountHint?: string;
}

/**
 * Run the AI extraction path: upload the file (falling back to inline base64
 * for small files when storage is unavailable), then invoke process-media.
 * Callers pass text and/or a file; at least one should be present.
 */
export async function runProcessMedia(
    input: ProcessMediaInput,
): Promise<ProcessMediaResult> {
    const { text, file, hint, accountHint } = input;

    const payload: Record<string, unknown> = {
        clientTime: new Date().toISOString(),
    };
    const promptHint = [hint?.trim(), accountHint?.trim()].filter(Boolean).join(" · ");
    if (promptHint) payload.promptHint = promptHint;
    if (text?.trim()) payload.text = text.trim();

    if (file) {
        if (file.size > MAX_FILE_BYTES) {
            throw new Error(
                `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${
                    MAX_FILE_BYTES / 1024 / 1024
                } MB.`,
            );
        }
        const storagePath = await uploadToIngest(file);
        if (storagePath) {
            payload.storagePath = storagePath;
        } else if (file.size <= INLINE_FALLBACK_MAX) {
            payload.inlineMedia = {
                mimeType: file.type || "application/octet-stream",
                data: await fileToBase64(file),
            };
        } else {
            throw new Error(
                "Storage upload failed and the file is too large to send inline. Is the 'ingest' bucket migration applied?",
            );
        }
    }

    return invokeFn<ProcessMediaResult>("process-media", payload);
}
