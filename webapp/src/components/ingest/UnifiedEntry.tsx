import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, type FormEvent, useRef, useState } from "react";
import { classifyFile, classifyFileAsync, runProcessMedia } from "../../lib/ingest";
import { logEvent } from "../../lib/logger";
import { runSummaryBacklog } from "../../lib/summaryJob";
import type { ProcessMediaResult } from "../../lib/types";
import IngestionResult from "./IngestionResult";
import VoiceRecorder from "./VoiceRecorder";

interface MultiResult {
    results: ProcessMediaResult[];
    errors: string[];
}

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
    const [files, setFiles] = useState<File[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [classifying, setClassifying] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);

    const capture = useMutation({
        mutationFn: async (input: { text: string; hint: string; files: File[] }): Promise<MultiResult> => {
            const aiFiles = input.files.filter((f) => classifyFile(f) === "ai");

            if (aiFiles.length === 0 && input.text.trim()) {
                const r = await runProcessMedia({ text: input.text, hint: input.hint });
                return { results: [r], errors: [] };
            }

            if (aiFiles.length === 1) {
                const r = await runProcessMedia({ text: input.text, hint: input.hint, file: aiFiles[0] });
                return { results: [r], errors: [] };
            }

            // Multiple files: process in parallel, first call gets the text context
            const settled = await Promise.allSettled(
                aiFiles.map((f, i) =>
                    runProcessMedia({
                        text: i === 0 ? input.text : undefined,
                        hint: input.hint,
                        file: f,
                    }),
                ),
            );

            const results: ProcessMediaResult[] = [];
            const errors: string[] = [];
            for (let i = 0; i < settled.length; i++) {
                const s = settled[i];
                if (s.status === "fulfilled") {
                    results.push(s.value);
                } else {
                    errors.push(`${aiFiles[i].name}: ${(s.reason as Error).message}`);
                }
            }
            return { results, errors };
        },
        onSuccess: (data, input) => {
            qc.invalidateQueries({ queryKey: ["pending-review"] });
            // Captured rows arrive without a summary; fill them in the
            // background and refresh the inbox once they land.
            void runSummaryBacklog().then(() =>
                qc.invalidateQueries({ queryKey: ["pending-review"] }),
            );
            for (const result of data.results) {
                const failures = result.insertErrors ?? [];
                logEvent(
                    failures.length ? "warn" : "info",
                    "capture",
                    `Capture: ${result.parsed.transactions.length} found, ${result.committed} saved to inbox`,
                    {
                        ingestionId: result.ingestionId,
                        model: result.model,
                        fileCount: input.files.length,
                        committed: result.committed,
                        duplicates: result.duplicates,
                        insertErrors: failures,
                    },
                );
            }
        },
        onError: (error) => {
            logEvent("error", "capture", `Capture failed: ${(error as Error).message}`);
        },
    });

    async function addFiles(incoming: File[]) {
        setClassifying(true);
        const structured: File[] = [];
        const ai: File[] = [];
        try {
            for (const f of incoming) {
                // Async because a PDF has to be sniffed for a transaction table.
                if ((await classifyFileAsync(f)) === "structured") structured.push(f);
                else ai.push(f);
            }
        } finally {
            setClassifying(false);
        }
        // If there's exactly one structured file and nothing else, go to import flow
        if (structured.length === 1 && ai.length === 0 && files.length === 0) {
            onStructuredFile(structured[0]);
            return;
        }
        // Otherwise add AI files (ignore structured in a mixed batch)
        if (ai.length > 0) {
            setFiles((prev) => [...prev, ...ai]);
        }
    }

    function removeFile(index: number) {
        setFiles((prev) => prev.filter((_, i) => i !== index));
        if (fileInput.current) fileInput.current.value = "";
    }

    function onDrop(e: DragEvent) {
        e.preventDefault();
        setDragOver(false);
        const dropped = Array.from(e.dataTransfer.files ?? []);
        if (dropped.length > 0) void addFiles(dropped);
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        if (!text.trim() && files.length === 0) return;
        capture.mutate({ text, hint, files });
    }

    function reset() {
        capture.reset();
        setText("");
        setHint("");
        setFiles([]);
        if (fileInput.current) fileInput.current.value = "";
    }

    if (capture.isSuccess) {
        const data = capture.data as MultiResult;
        // Merge all results into a single combined result for display
        const combined: ProcessMediaResult = {
            ingestionId: data.results[0]?.ingestionId ?? "",
            provider: data.results[0]?.provider ?? "",
            model: data.results[0]?.model ?? "",
            parsed: {
                summary: data.results.map((r) => r.parsed.summary).join(" · "),
                confidence: data.results.length
                    ? data.results.reduce((s, r) => s + r.parsed.confidence, 0) / data.results.length
                    : 0,
                transactions: data.results.flatMap((r) => r.parsed.transactions),
            },
            committed: data.results.reduce((s, r) => s + r.committed, 0),
            duplicates: data.results.reduce((s, r) => s + r.duplicates, 0),
            rulesApplied: data.results.reduce((s, r) => s + r.rulesApplied, 0),
            insertErrors: [
                ...data.results.flatMap((r) => r.insertErrors ?? []),
                ...data.errors,
            ],
            inbox: data.results.flatMap((r) => r.inbox),
        };
        return <IngestionResult result={combined} onAddAnother={reset} onClose={onClose} />;
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
                        multiple
                        accept="image/*,application/pdf,audio/*,video/*,text/*,.csv,.ofx,.qfx,.xlsx,.xls"
                        onChange={(e) => {
                            const selected = Array.from(e.target.files ?? []);
                            if (selected.length > 0) void addFiles(selected);
                        }}
                        className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:text-slate-200 hover:file:bg-slate-700"
                    />
                    <VoiceRecorder
                        onRecorded={(f) => {
                            setFiles((prev) => [...prev, f]);
                            if (fileInput.current) fileInput.current.value = "";
                        }}
                    />
                </div>
            </div>

            {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {files.map((f, i) => (
                        <span
                            key={`${f.name}-${i}`}
                            className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
                        >
                            {f.name} · {(f.size / 1024).toFixed(0)} KB
                            <button
                                type="button"
                                onClick={() => removeFile(i)}
                                className="text-slate-500 hover:text-slate-200"
                                aria-label={`Remove ${f.name}`}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            <input
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                placeholder="Optional hint, e.g. 'amounts are in NGN'"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
            />

            <p className="text-xs text-slate-500">
                Receipts, photos, and audio are read by AI. CSV, Excel, OFX/QFX, and PDF
                statements open the column mapper instead — all land in your inbox for review.
                {files.length > 1 && " Each file is extracted separately; duplicates are auto-detected."}
            </p>

            {classifying && (
                <p className="text-xs text-slate-400">Reading file…</p>
            )}

            <button
                className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={capture.isPending || (!text.trim() && files.length === 0)}
            >
                {capture.isPending
                    ? `Extracting${files.length > 1 ? ` ${files.length} files…` : "…"}`
                    : files.length > 1
                      ? `Capture ${files.length} files`
                      : "Capture"}
            </button>

            {capture.isError && (
                <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
                    {(capture.error as Error).message}
                </div>
            )}
        </form>
    );
}
