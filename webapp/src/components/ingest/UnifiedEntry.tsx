import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { classifyFile, runProcessMedia } from "../../lib/ingest";
import { logEvent } from "../../lib/logger";
import type { ProcessMediaResult } from "../../lib/types";
import IngestionResult from "./IngestionResult";
import VoiceRecorder from "./VoiceRecorder";

/**
 * The single ingestion surface: type a note, attach/drop any file, or record a
 * voice note. Structured files (CSV/Excel/OFX) hand off to the import flow;
 * everything else (text, receipts, photos, audio, PDFs) runs AI extraction.
 */
export default function UnifiedEntry({
    initialText = "",
    onStructuredFile,
    onClose,
}: {
    initialText?: string;
    onStructuredFile: (file: File) => void;
    onClose: () => void;
}) {
    const qc = useQueryClient();
    const [text, setText] = useState(initialText);
    const [hint, setHint] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const capture = useMutation({
        mutationFn: (input: { text: string; hint: string; file: File | null }) =>
            runProcessMedia({ text: input.text, hint: input.hint, file: input.file }),
        onSuccess: (result, input) => {
            qc.invalidateQueries({ queryKey: ["pending-review"] });
            const failures = result.insertErrors ?? [];
            logEvent(
                failures.length ? "warn" : "info",
                "capture",
                `Capture: ${result.parsed.transactions.length} found, ${result.committed} saved to inbox`,
                {
                    ingestionId: result.ingestionId,
                    model: result.model,
                    file: input.file
                        ? { name: input.file.name, size: input.file.size, type: input.file.type }
                        : null,
                    committed: result.committed,
                    duplicates: result.duplicates,
                    insertErrors: failures,
                },
            );
        },
        onError: (error, input) => {
            logEvent("error", "capture", `Capture failed: ${(error as Error).message}`, {
                file: input.file
                    ? { name: input.file.name, size: input.file.size, type: input.file.type }
                    : null,
                hadText: !!input.text.trim(),
            });
        },
    });

    /** Route a chosen file: structured → import flow; otherwise attach for AI. */
    function chooseFile(f: File | null) {
        if (!f) {
            setFile(null);
            return;
        }
        if (classifyFile(f) === "structured") {
            onStructuredFile(f);
            return;
        }
        setFile(f);
    }

    function onDrop(e: DragEvent) {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) chooseFile(f);
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        if (!text.trim() && !file) return;
        capture.mutate({ text, hint, file });
    }

    function reset() {
        capture.reset();
        setText("");
        setHint("");
        setFile(null);
        if (fileInput.current) fileInput.current.value = "";
    }

    if (capture.isSuccess) {
        return (
            <IngestionResult result={capture.data as ProcessMediaResult} onAddAnother={reset} onClose={onClose} />
        );
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                className={`rounded-xl border-2 border-dashed transition-colors ${
                    dragOver ? "border-emerald-500 bg-emerald-500/5" : "border-slate-700"
                }`}
            >
                <textarea
                    className="min-h-28 w-full rounded-xl bg-transparent p-3 text-sm outline-none"
                    placeholder={'Type what happened, or drop a receipt / statement / voice note here…\ne.g. "Paid 2.5m deposit for the Ibeju-Lekki plot yesterday, plus 150k to the surveyor"'}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-3 border-t border-slate-800 px-3 py-2.5">
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/*,application/pdf,audio/*,video/*,text/*,.csv,.ofx,.qfx,.xlsx,.xls"
                        onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
                        className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:text-slate-200 hover:file:bg-slate-700"
                    />
                    <VoiceRecorder
                        onRecorded={(f) => {
                            setFile(f);
                            if (fileInput.current) fileInput.current.value = "";
                        }}
                    />
                    {file && (
                        <span className="text-xs text-slate-500">
                            {file.name} · {(file.size / 1024).toFixed(0)} KB
                        </span>
                    )}
                </div>
            </div>

            <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                placeholder="Optional hint, e.g. 'amounts are in NGN'"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
            />

            <p className="text-xs text-slate-500">
                Receipts, photos, audio, and PDFs are read by AI. CSV, Excel, and OFX/QFX
                statements open the column mapper instead — all land in your inbox for review.
            </p>

            <button
                className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={capture.isPending || (!text.trim() && !file)}
            >
                {capture.isPending ? "Extracting…" : "Capture"}
            </button>

            {capture.isError && (
                <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
                    {(capture.error as Error).message}
                </div>
            )}
        </form>
    );
}
