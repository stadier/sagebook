import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDateTime, fmtMoney } from "../lib/format";
import { invokeFn, requireSupabase } from "../lib/supabase";
import type { ProcessMediaResult } from "../lib/types";

interface CapturePayload {
    text?: string;
    inlineMedia?: { mimeType: string; data: string };
    /** Key within the private 'ingest' bucket; resolved server-side. */
    storagePath?: string;
    promptHint?: string;
    baseCurrency?: string;
    /** Anchors relative dates ("yesterday") in the extraction prompt. */
    clientTime?: string;
}

interface CaptureInput {
    text: string;
    hint: string;
    file: File | null;
}

/** Hard cap before upload; process-media inlines at most 15 MB to the model. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** If the storage upload fails (e.g. bucket missing), small files go inline. */
const INLINE_FALLBACK_MAX = 4 * 1024 * 1024;

/** Upload to ingest/{userId}/... — the object doubles as the receipt archive. */
async function uploadToIngest(file: File): Promise<string | null> {
    try {
        const sb = requireSupabase();
        const { data: userData } = await sb.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) return null;
        const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80) || "capture";
        const path = `${uid}/${crypto.randomUUID()}-${safeName}`;
        const { error } = await sb.storage.from("ingest").upload(path, file, {
            contentType: file.type || undefined,
        });
        if (error) {
            console.warn("[capture] storage upload failed:", error.message);
            return null;
        }
        return path;
    } catch {
        return null;
    }
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
        mutationFn: async (input: CaptureInput) => {
            const payload: CapturePayload = {
                promptHint: input.hint.trim() || undefined,
                clientTime: new Date().toISOString(),
            };
            if (input.text.trim()) payload.text = input.text.trim();
            if (input.file) {
                if (input.file.size > MAX_FILE_BYTES) {
                    throw new Error(
                        `File is ${(input.file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
                    );
                }
                const storagePath = await uploadToIngest(input.file);
                if (storagePath) {
                    payload.storagePath = storagePath;
                } else if (input.file.size <= INLINE_FALLBACK_MAX) {
                    payload.inlineMedia = {
                        mimeType: input.file.type || "application/octet-stream",
                        data: await fileToBase64(input.file),
                    };
                } else {
                    throw new Error(
                        "Storage upload failed and the file is too large to send inline. Is the 'ingest' bucket migration applied?",
                    );
                }
            }
            return invokeFn<ProcessMediaResult>("process-media", payload);
        },
    });

    function submit(e: FormEvent) {
        e.preventDefault();
        if (!text.trim() && !file) return;
        capture.mutate(
            { text, hint, file },
            {
                onSuccess: () => {
                    setText("");
                    setFile(null);
                    if (fileInput.current) fileInput.current.value = "";
                },
            },
        );
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

function VoiceRecorder({ onRecorded }: { onRecorded: (file: File) => void }) {
    const [recording, setRecording] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState("");
    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        if (!recording) return;
        const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => clearInterval(timer);
    }, [recording]);

    // Stop tracks if the user navigates away mid-recording.
    useEffect(() => {
        return () => {
            recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
        };
    }, []);

    async function start() {
        setError("");
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);
            chunksRef.current = [];
            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };
            recorder.onstop = () => {
                stream.getTracks().forEach((t) => t.stop());
                const type = recorder.mimeType || "audio/webm";
                const blob = new Blob(chunksRef.current, { type });
                // Strip codec params: Gemini wants a plain mime type.
                const mime = type.split(";")[0];
                const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
                onRecorded(
                    new File([blob], `voice-note-${Date.now()}.${ext}`, { type: mime }),
                );
            };
            recorder.start();
            recorderRef.current = recorder;
            setElapsed(0);
            setRecording(true);
        } catch {
            setError("Microphone unavailable or permission denied.");
        }
    }

    function stop() {
        recorderRef.current?.stop();
        recorderRef.current = null;
        setRecording(false);
    }

    return (
        <span className="flex items-center gap-2">
            <button
                type="button"
                onClick={recording ? stop : start}
                className={`rounded-lg px-3 py-2 text-sm ${
                    recording
                        ? "bg-rose-600 text-white hover:bg-rose-500"
                        : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                }`}
            >
                {recording ? `■ Stop (${elapsed}s)` : "🎙 Record"}
            </button>
            {error && <span className="text-xs text-rose-400">{error}</span>}
        </span>
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
