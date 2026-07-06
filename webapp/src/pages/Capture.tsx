import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { invokeFn } from "../lib/supabase";
import type { ProcessMediaResult } from "../lib/types";

interface CapturePayload {
    text?: string;
    inlineMedia?: { mimeType: string; data: string };
    promptHint?: string;
    baseCurrency?: string;
    /** Anchors relative dates ("yesterday") in the extraction prompt. */
    clientTime?: string;
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? "");
            resolve(result.replace(/^data:[^;]+;base64,/, ""));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export default function Capture() {
    const [text, setText] = useState("");
    const [hint, setHint] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const capture = useMutation({
        mutationFn: async (payload: CapturePayload) =>
            invokeFn<ProcessMediaResult>("process-media", payload),
    });

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (!text.trim() && !file) return;

        const payload: CapturePayload = {
            promptHint: hint.trim() || undefined,
            clientTime: new Date().toISOString(),
        };
        if (file) {
            payload.inlineMedia = {
                mimeType: file.type || "application/octet-stream",
                data: await fileToBase64(file),
            };
        }
        if (text.trim()) payload.text = text.trim();

        capture.mutate(payload, {
            onSuccess: () => {
                setText("");
                setFile(null);
                if (fileInput.current) fileInput.current.value = "";
            },
        });
    }

    return (
        <div className="mx-auto max-w-2xl">
            <h1 className="mb-1 text-xl font-semibold">Capture</h1>
            <p className="mb-6 text-sm text-slate-400">
                Type what happened, or attach a receipt / statement / voice note. The AI
                extracts transactions into your inbox for review.
            </p>

            <form onSubmit={submit} className="flex flex-col gap-3">
                <textarea
                    className="min-h-28 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm outline-none focus:border-emerald-500"
                    placeholder='e.g. "Paid 2.5m deposit for the Ibeju-Lekki plot yesterday, plus 150k to the surveyor"'
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                />
                <div className="flex flex-wrap items-center gap-3">
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/*,application/pdf,audio/*,video/*,text/*"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:text-slate-200 hover:file:bg-slate-700"
                    />
                    {file && (
                        <span className="text-xs text-slate-500">
                            {file.name} · {(file.size / 1024).toFixed(0)} KB
                        </span>
                    )}
                </div>
                <input
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                    placeholder="Optional hint, e.g. 'amounts are in NGN'"
                    value={hint}
                    onChange={(e) => setHint(e.target.value)}
                />
                <button
                    className="self-start rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                    disabled={capture.isPending || (!text.trim() && !file)}
                >
                    {capture.isPending ? "Extracting…" : "Capture"}
                </button>
            </form>

            {capture.isError && (
                <div className="mt-6 rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-300">
                    {(capture.error as Error).message}
                </div>
            )}

            {capture.isSuccess && <ExtractionResult result={capture.data} />}
        </div>
    );
}

function ExtractionResult({ result }: { result: ProcessMediaResult }) {
    return (
        <div className="mt-6 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-slate-200">Extraction result</h2>
                <span className="text-xs text-slate-500">
                    {result.model} · confidence {(result.parsed.confidence * 100).toFixed(0)}%
                </span>
            </div>
            <p className="mb-3 text-sm text-slate-400">{result.parsed.summary}</p>

            {result.inbox.length === 0 ? (
                <p className="text-sm text-slate-500">No transactions were extracted.</p>
            ) : (
                <ul className="divide-y divide-slate-800">
                    {result.inbox.map((tx) => (
                        <li key={tx.id} className="flex items-center justify-between py-2 text-sm">
                            <div>
                                <div className="text-slate-200">{tx.payee ?? "(no payee)"}</div>
                                <div className="text-xs text-slate-500">{fmtDateTime(tx.occurred_at)}</div>
                            </div>
                            <div className="flex items-center gap-2">
                                {tx.duplicate_group_id && (
                                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                                        possible duplicate
                                    </span>
                                )}
                                <span className="font-medium">{fmtMoney(tx.amount, tx.currency)}</span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                <span>{result.committed} sent to inbox</span>
                <span>{result.duplicates} duplicate-flagged</span>
                <span>{result.rulesApplied} rules applied</span>
                <Link to="/inbox" className="ml-auto text-emerald-400 hover:text-emerald-300">
                    Review in inbox →
                </Link>
            </div>
        </div>
    );
}
