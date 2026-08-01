/* The Console — Sage, Sagebook's financial voice. A calm, full-screen shell:
 * a quiet left rail and a mostly-empty canvas built around a single prompt.
 * Type or paste anything — a question generates a dashboard inline from your
 * real data; an event ("Paid 2.5m for…") hands off to capture. See
 * docs/FINANCIAL_OS.md for the why. */

import { type FormEvent, forwardRef, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import GeneratedView from "../components/console/ConsolePanels";
import IngestModal from "../components/ingest/IngestModal";
import { BrandMark } from "../components/nav";
import { classifyPrompt, type Intent, SUGGESTIONS } from "../lib/console/intents";
import { askSage, type SageAnswer } from "../lib/sage";
import { requireSupabase } from "../lib/supabase";
import { useTheme } from "../lib/useTheme";

interface GenView {
    id: string;
    prompt: string;
    intent: Intent;
    /** Sage's answer, once the query has come back. */
    answer?: SageAnswer;
    error?: string;
    pending?: boolean;
}

export default function Console() {
    const { theme, toggle: toggleTheme } = useTheme();
    const [email, setEmail] = useState<string | null>(null);
    const [views, setViews] = useState<GenView[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [ingestOpen, setIngestOpen] = useState(false);
    const [ingestText, setIngestText] = useState("");
    const inputRef = useRef<HTMLTextAreaElement>(null);

    function patchView(id: string, patch: Partial<GenView>) {
        setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
    }

    useEffect(() => {
        requireSupabase()
            .auth.getUser()
            .then(({ data }) => setEmail(data.user?.email ?? null))
            .catch(() => {});
    }, []);

    const active = views.find((v) => v.id === activeId) ?? null;
    const name = email ? email.split("@")[0] : "there";
    const initial = (email?.[0] ?? "S").toUpperCase();

    /** Send a prompt: either generate a dashboard or open capture. */
    function run(prompt: string) {
        const text = prompt.trim();
        if (!text) return;
        const result = classifyPrompt(text);
        setInput("");
        if (result.kind === "capture") {
            setIngestText(text);
            setIngestOpen(true);
            return;
        }
        // The panels render immediately from cached data; the answer arrives
        // when the ledger query comes back, so the canvas is never blank.
        const view: GenView = { id: makeId(), prompt: text, intent: result.intent, pending: true };
        setViews((prev) => [view, ...prev]);
        setActiveId(view.id);

        askSage(text)
            .then((answer) => patchView(view.id, { answer, pending: false }))
            .catch((err: Error) => patchView(view.id, { error: err.message, pending: false }));
    }

    function onSubmit(e: FormEvent) {
        e.preventDefault();
        run(input);
    }

    function newSession() {
        setActiveId(null);
        setInput("");
        inputRef.current?.focus();
    }

    return (
        <div className="flex h-screen overflow-hidden bg-paper text-slate-200">
            {/* ---- Left rail — quiet, vertical, gets out of the way ---------- */}
            <aside className="hidden w-64 shrink-0 flex-col bg-sidebar px-3 py-4 text-white md:flex">
                <Link to="/console" className="mb-5 flex items-center gap-2.5 px-2">
                    <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-coral text-coral-fg">
                        <BrandMark />
                    </span>
                    <span className="text-[1.0625rem] font-extrabold tracking-tight text-white">
                        Sagebook
                    </span>
                </Link>

                <button
                    onClick={newSession}
                    className="mb-4 flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
                >
                    <PlusIcon />
                    New
                </button>

                <div className="min-h-0 flex-1 overflow-y-auto">
                    <p className="px-2 pb-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-white/40">
                        This session
                    </p>
                    {views.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-white/35">
                            Your questions show up here.
                        </p>
                    ) : (
                        <ul className="flex flex-col gap-0.5">
                            {views.map((v) => (
                                <li key={v.id}>
                                    <button
                                        onClick={() => setActiveId(v.id)}
                                        className={`flex w-full items-center gap-2 truncate rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                                            v.id === activeId
                                                ? "bg-white/12 text-white"
                                                : "text-white/60 hover:bg-white/8 hover:text-white/90"
                                        }`}
                                    >
                                        <SparkIcon />
                                        <span className="truncate">{v.prompt}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Back to the classic, browsable app */}
                <Link
                    to="/"
                    className="mt-2 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-white/55 transition-colors hover:bg-white/8 hover:text-white"
                >
                    <GridIcon />
                    Classic dashboard
                </Link>

                <div className="mt-1 flex items-center gap-2 border-t border-white/10 pt-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ffb443] text-[0.8125rem] font-bold text-[#191d24]">
                        {initial}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium capitalize text-white/80">
                        {name}
                    </span>
                    <button
                        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                        onClick={toggleTheme}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
                    >
                        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
                    </button>
                </div>
            </aside>

            {/* ---- Right canvas --------------------------------------------- */}
            <main className="relative min-w-0 flex-1 overflow-y-auto" style={DOT_BG}>
                {/* Mobile brand + new (no rail below md) */}
                <div className="flex items-center justify-between gap-3 px-4 pt-4 md:hidden">
                    <Link to="/console" className="flex items-center gap-2">
                        <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-coral text-coral-fg">
                            <BrandMark size={14} />
                        </span>
                        <span className="text-[0.9375rem] font-extrabold tracking-tight text-slate-100">
                            Sagebook
                        </span>
                    </Link>
                    <div className="flex items-center gap-2">
                        <button onClick={newSession} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-slate-300 shadow-sm">
                            New
                        </button>
                        <Link to="/" className="rounded-lg px-2 py-1.5 text-sm text-slate-500">
                            Classic
                        </Link>
                    </div>
                </div>

                {active ? (
                    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8">
                        <PromptBar
                            ref={inputRef}
                            value={input}
                            onChange={setInput}
                            onSubmit={onSubmit}
                            onMic={() => {
                                setIngestText("");
                                setIngestOpen(true);
                            }}
                            compact
                            busy={active.pending}
                        />
                        <div className="mt-8">
                            <div className="mb-5">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Sage · {active.prompt}
                                </p>
                                <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
                                    {active.intent.title}
                                </h1>
                                <p className="mt-1 text-sm text-slate-400">{active.intent.caption}</p>
                            </div>

                            <SageAnswerCard
                                pending={active.pending}
                                answer={active.answer}
                                error={active.error}
                                onAsk={run}
                            />

                            <GeneratedView panels={active.intent.panels} />
                        </div>
                    </div>
                ) : (
                    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center px-4 py-16">
                        <div className="mb-8 text-center">
                            <span className="mb-5 inline-grid h-12 w-12 place-items-center rounded-2xl bg-coral-soft text-coral">
                                <SparkIcon large />
                            </span>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
                                What's on your mind, money-wise?
                            </h1>
                            <p className="mx-auto mt-3 max-w-md text-sm text-slate-500 sm:text-base">
                                Tell Sage what happened, or ask a question — it'll capture the
                                event or generate the view, right here.
                            </p>
                        </div>

                        <div className="w-full">
                            <PromptBar
                                ref={inputRef}
                                value={input}
                                onChange={setInput}
                                onSubmit={onSubmit}
                                onMic={() => {
                                    setIngestText("");
                                    setIngestOpen(true);
                                }}
                            />
                        </div>

                        <div className="mt-6 flex flex-wrap justify-center gap-2">
                            {SUGGESTIONS.map((s) => (
                                <button
                                    key={s.label}
                                    onClick={() => run(s.prompt)}
                                    className="rounded-full border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-sm text-slate-300 shadow-sm transition-colors hover:border-coral/40 hover:text-slate-100"
                                >
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </main>

            <IngestModal
                open={ingestOpen}
                onClose={() => setIngestOpen(false)}
                initialText={ingestText}
            />
        </div>
    );
}

/* Subtle scattered-dot ambience for the canvas, matching the calm reference. */
const DOT_BG: React.CSSProperties = {
    backgroundImage:
        "radial-gradient(circle, color-mix(in oklab, var(--color-slate-600) 22%, transparent) 1px, transparent 1px)",
    backgroundSize: "26px 26px",
};

/* --- Sage's answer ---------------------------------------------------------
   The prose the model wrote from real query results, the figures behind it,
   and the questions it suggests next. The panels below stay as context; this
   is the part that actually answers what was asked. */

function SageAnswerCard({
    pending,
    answer,
    error,
    onAsk,
}: {
    pending?: boolean;
    answer?: SageAnswer;
    error?: string;
    onAsk: (prompt: string) => void;
}) {
    if (pending) {
        return (
            <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex items-center gap-2.5 text-sm text-slate-500">
                    <span className="text-coral">
                        <SparkIcon />
                    </span>
                    Reading your ledger…
                </div>
                <div className="mt-3 flex flex-col gap-2">
                    <div className="sb-skeleton h-3 w-3/4" />
                    <div className="sb-skeleton h-3 w-1/2" />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="mb-5 rounded-2xl border border-rose-900/50 bg-rose-950/20 p-4 text-sm">
                <p className="font-medium text-rose-300">Sage couldn't answer that.</p>
                <p className="mt-1 text-slate-400">{error}</p>
            </div>
        );
    }

    if (!answer) return null;

    return (
        <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-card">
            <div className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-coral">
                    <SparkIcon />
                </span>
                <p className="min-w-0 text-[0.9375rem] leading-relaxed text-slate-200">
                    {answer.answer}
                </p>
            </div>

            {answer.highlights && answer.highlights.length > 0 && (
                <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                    {answer.highlights.slice(0, 3).map((h) => (
                        <div key={h.label} className="rounded-xl bg-slate-950 px-4 py-3">
                            <div className="text-xs text-slate-500">{h.label}</div>
                            <div className="mt-1 text-lg font-extrabold tnum text-slate-100 [overflow-wrap:anywhere]">
                                {h.value}
                            </div>
                            {h.hint && <div className="mt-0.5 text-xs text-slate-500">{h.hint}</div>}
                        </div>
                    ))}
                </div>
            )}

            {answer.followups && answer.followups.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {answer.followups.slice(0, 3).map((f) => (
                        <button
                            key={f}
                            onClick={() => onAsk(f)}
                            className="rounded-full border border-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-coral/40 hover:text-slate-200"
                        >
                            {f}
                        </button>
                    ))}
                </div>
            )}

            {/* What it actually looked up — an answer about money should be
                auditable, not taken on trust. */}
            {answer.queries.length > 0 && (
                <details className="mt-4 border-t border-slate-800 pt-3">
                    <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                        Show the {answer.queries.length} quer
                        {answer.queries.length === 1 ? "y" : "ies"} behind this
                    </summary>
                    <div className="mt-2 flex flex-col gap-2">
                        {answer.queries.map((q) => (
                            <div key={q.id} className="rounded-lg bg-slate-950 p-2.5 text-xs">
                                <div className="text-slate-400">
                                    {q.purpose ?? q.select} · {q.matched} row
                                    {q.matched === 1 ? "" : "s"}
                                    {q.truncated && " (capped)"}
                                </div>
                                <pre className="mt-1 max-h-40 overflow-auto text-[0.6875rem] text-slate-500">
                                    {JSON.stringify(q.data, null, 1)}
                                </pre>
                            </div>
                        ))}
                    </div>
                </details>
            )}
        </div>
    );
}

/* --- Prompt bar ----------------------------------------------------------- */

/** Rows the prompt grows to before it starts scrolling instead. */
const MAX_PROMPT_ROWS = 10;

const PromptBar = forwardRef<
    HTMLTextAreaElement,
    {
        value: string;
        onChange: (v: string) => void;
        onSubmit: (e: FormEvent) => void;
        onMic: () => void;
        compact?: boolean;
        busy?: boolean;
    }
>(function PromptBar({ value, onChange, onSubmit, onMic, compact, busy }, ref) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    /* Grow to fit. The height is reset to `auto` first so the box can shrink
       again when text is deleted — `scrollHeight` never reports less than the
       element's current height. */
    useEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        el.style.height = "auto";
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
        const max = lineHeight * MAX_PROMPT_ROWS;
        el.style.height = `${Math.min(el.scrollHeight, max)}px`;
        el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
    }, [value, compact]);

    return (
        <form onSubmit={onSubmit}>
            <div
                className={`flex items-end gap-2 rounded-2xl border border-slate-800 bg-slate-900 shadow-card transition-colors focus-within:border-coral/60 focus-within:ring-2 focus-within:ring-coral/15 ${
                    compact ? "px-3 py-2" : "px-4 py-3"
                }`}
            >
                <span className="pb-1.5 text-coral">
                    <SparkIcon />
                </span>
                <textarea
                    ref={(node) => {
                        innerRef.current = node;
                        if (typeof ref === "function") ref(node);
                        else if (ref) ref.current = node;
                    }}
                    rows={1}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    // Enter sends, because this is a prompt, not a document.
                    // Shift+Enter is the escape hatch for a deliberate newline.
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            onSubmit(e);
                        }
                    }}
                    placeholder="Tell Sage what happened, or ask about your money…"
                    className={`min-w-0 flex-1 resize-none bg-transparent py-1 leading-[1.45] text-slate-100 placeholder:text-slate-500 focus:outline-none ${
                        compact ? "text-sm" : "text-base"
                    }`}
                    autoComplete="off"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus={!compact}
                />
                <button
                    type="button"
                    onClick={onMic}
                    aria-label="Capture with voice or a file"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-950 hover:text-slate-200"
                >
                    <MicIcon />
                </button>
                <button
                    type="submit"
                    aria-label="Send"
                    disabled={!value.trim() || busy}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-coral text-coral-fg transition-colors hover:bg-coral-600 disabled:opacity-40"
                >
                    <SendIcon />
                </button>
            </div>
        </form>
    );
});

/* --- icons ---------------------------------------------------------------- */

function SparkIcon({ large }: { large?: boolean }) {
    const s = large ? 24 : 18;
    return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
            <path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
    );
}

function MicIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 12h13M12 5l7 7-7 7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}

function GridIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0">
            <rect x="4" y="4" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="4" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
            <rect x="4" y="14" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
            <rect x="14" y="14" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

function SunIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
    );
}

function MoonIcon() {
    return (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
        </svg>
    );
}

let idCounter = 0;
function makeId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return `v${Date.now()}-${idCounter++}`;
}
