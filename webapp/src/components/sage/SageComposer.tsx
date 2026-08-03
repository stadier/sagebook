/* The one box. Sagebook's premise is that telling it what happened and asking
   it what's going on are the same motion (docs/FINANCIAL_OS.md §2), so this
   input does both: `classifyPrompt` reads an event and hands off to capture,
   reads a question and sends it to Sage. The mic and the paperclip are the same
   hand-off by another route.

   Used by the dock, by the full-screen console, and — as the edit box — by a
   message already in the thread. */

import { type FormEvent, forwardRef, useEffect, useRef } from "react";
import { MicIcon, SendIcon, SparkIcon } from "../icons";

/** Rows the prompt grows to before it starts scrolling instead. */
const MAX_PROMPT_ROWS = 10;

export interface SageComposerProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** Opens capture with whatever is typed — the mic/attach hand-off. */
    onCapture?: () => void;
    /** Tighter padding for the dock and for editing in place. */
    compact?: boolean;
    busy?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    /** Shown instead of the mic when this is an edit rather than a new turn. */
    onCancel?: () => void;
    submitLabel?: string;
}

export const SageComposer = forwardRef<HTMLTextAreaElement, SageComposerProps>(
    function SageComposer(
        {
            value,
            onChange,
            onSubmit,
            onCapture,
            compact,
            busy,
            placeholder = "Tell Sage what happened, or ask about your money…",
            autoFocus,
            onCancel,
            submitLabel = "Send",
        },
        ref,
    ) {
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

        function submit(e: FormEvent) {
            e.preventDefault();
            if (!value.trim() || busy) return;
            onSubmit();
        }

        return (
            <form onSubmit={submit}>
                <div
                    className={`flex items-end gap-2 rounded-2xl border border-slate-800 bg-slate-900 shadow-card transition-colors focus-within:border-coral/60 focus-within:ring-2 focus-within:ring-coral/15 ${
                        compact ? "px-2.5 py-1.5" : "px-4 py-3"
                    }`}
                >
                    <span className="pb-1.5 text-coral">
                        <SparkIcon size={compact ? 16 : 18} />
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
                        // Shift+Enter is the escape hatch for a deliberate newline;
                        // Escape backs out of an edit without changing anything.
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                submit(e);
                            } else if (e.key === "Escape" && onCancel) {
                                e.preventDefault();
                                onCancel();
                            }
                        }}
                        placeholder={placeholder}
                        className={`min-w-0 flex-1 resize-none bg-transparent py-1 leading-[1.45] text-slate-100 placeholder:text-slate-500 focus:outline-none ${
                            compact ? "text-sm" : "text-base"
                        }`}
                        autoComplete="off"
                        // eslint-disable-next-line jsx-a11y/no-autofocus
                        autoFocus={autoFocus}
                    />
                    {onCancel ? (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 transition-colors hover:bg-slate-950 hover:text-slate-200"
                        >
                            Cancel
                        </button>
                    ) : (
                        onCapture && (
                            <button
                                type="button"
                                onClick={onCapture}
                                aria-label="Capture a receipt, file or voice note"
                                title="Capture a receipt, file or voice note"
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-slate-950 hover:text-slate-200"
                            >
                                <MicIcon size={17} />
                            </button>
                        )
                    )}
                    <button
                        type="submit"
                        aria-label={submitLabel}
                        title={submitLabel}
                        disabled={!value.trim() || busy}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-coral text-coral-fg transition-colors hover:bg-coral-600 disabled:opacity-40"
                    >
                        <SendIcon size={16} />
                    </button>
                </div>
            </form>
        );
    },
);

/** The chips under an empty canvas, showing what Sage can be asked. */
export function SuggestionChips({
    suggestions,
    onPick,
    className = "",
}: {
    suggestions: Array<{ label: string; prompt: string }>;
    onPick: (prompt: string) => void;
    className?: string;
}) {
    return (
        <div className={`flex flex-wrap gap-2 ${className}`}>
            {suggestions.map((s) => (
                <button
                    key={s.label}
                    onClick={() => onPick(s.prompt)}
                    className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-[0.8125rem] text-slate-300 shadow-sm transition-colors hover:border-coral/40 hover:text-slate-100"
                >
                    {s.label}
                </button>
            ))}
        </div>
    );
}
