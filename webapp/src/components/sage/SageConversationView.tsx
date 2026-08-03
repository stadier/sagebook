/* One conversation, whichever window you are looking at it through.

   The dock and the full-screen console differ in chrome and in how much room
   they have — not in what a conversation *is*. So the thread, the composer, the
   empty state and every rule about what happens when you send something live
   here once, and the two surfaces pass a `variant` in.

   The thread on screen is derived, never fetched: `threadOf` walks from the
   conversation's leaf back to the root. `localLeaf` is that leaf held locally
   for the moment between a turn landing and the conversation list catching up,
   so an answer never blinks in and out while the cache settles. */

import { useEffect, useMemo, useRef, useState } from "react";
import { classifyPrompt, SUGGESTIONS } from "../../lib/console/intents";
import {
    threadOf,
    useAskSage,
    useConversationMessages,
    useConversations,
    useSetActiveLeaf,
    type SageMessage,
} from "../../lib/sage";
import GeneratedView from "../console/ConsolePanels";
import { SparkIcon } from "../icons";
import { SageComposer, SuggestionChips } from "./SageComposer";
import { useSageSession } from "./SageProvider";
import { SageThread } from "./SageThread";

export interface SageConversationViewProps {
    variant: "dock" | "focus";
    /** Hands a typed event off to ingestion — the capture half of the one box. */
    onCapture: (text: string) => void;
    /** The screen this was asked from, so Sage knows what "this" means. */
    viewing?: string;
}

/** Everything up to and including `parentId` — the thread as an edit rewrites it. */
function upTo(thread: SageMessage[], parentId: string | null | undefined): SageMessage[] {
    if (!parentId) return [];
    const index = thread.findIndex((m) => m.id === parentId);
    return index === -1 ? thread : thread.slice(0, index + 1);
}

export function SageConversationView({
    variant,
    onCapture,
    viewing,
}: SageConversationViewProps) {
    const { conversationId, setConversationId, draft, setDraft } = useSageSession();
    const conversations = useConversations();
    const messagesQuery = useConversationMessages(conversationId);
    const ask = useAskSage();
    const setActiveLeaf = useSetActiveLeaf();

    const [input, setInput] = useState("");
    // Held only until the conversations query reports the same leaf.
    const [localLeaf, setLocalLeaf] = useState<string | null>(null);
    const bottom = useRef<HTMLDivElement>(null);

    const conversation =
        conversations.data?.find((c) => c.id === conversationId) ?? null;
    const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
    const leafId = localLeaf ?? conversation?.active_leaf_id ?? null;
    const thread = useMemo(() => threadOf(messages, leafId), [messages, leafId]);

    // A prompt handed in from elsewhere — a chip, a page's "ask Sage" link.
    useEffect(() => {
        if (!draft) return;
        setInput(draft);
        setDraft("");
    }, [draft, setDraft]);

    useEffect(() => {
        setLocalLeaf(null);
        setInput("");
    }, [conversationId]);

    // While a turn is in flight the thread is shown as that turn will leave it:
    // for an edit, that means cut back to the point being re-asked.
    const pending = ask.isPending ? ask.variables : null;
    const visible = pending ? upTo(thread, pending.parentMessageId) : thread;

    useEffect(() => {
        bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, [visible.length, pending?.question]);

    /** Send a prompt: an event goes to capture, a question goes to Sage. */
    function run(question: string, parentId: string | null = leafId) {
        const text = question.trim();
        if (!text || ask.isPending) return;
        if (classifyPrompt(text).kind === "capture") {
            setInput("");
            onCapture(text);
            return;
        }
        setInput("");
        ask.mutate(
            {
                question: text,
                conversationId: conversationId ?? undefined,
                parentMessageId: parentId,
                context: viewing,
            },
            {
                onSuccess: (result) => {
                    setConversationId(result.conversationId);
                    setLocalLeaf(result.sageMessage.id);
                },
            },
        );
    }

    const focus = variant === "focus";
    const empty = visible.length === 0 && !pending;

    // The panels are a backdrop for the latest question, and only the console
    // canvas has the room for them.
    const backdrop = useMemo(() => {
        if (!focus || empty) return null;
        const lastQuestion = [...visible].reverse().find((m) => m.role === "user");
        if (!lastQuestion) return null;
        const result = classifyPrompt(lastQuestion.content);
        return result.kind === "query" ? result.intent : null;
    }, [focus, empty, visible]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div
                    className={
                        focus
                            ? "mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:px-8"
                            : "flex flex-col px-3 py-4"
                    }
                >
                    {empty ? (
                        <EmptyCanvas focus={focus} onPick={(prompt) => run(prompt)} />
                    ) : (
                        <>
                            <SageThread
                                messages={messages}
                                thread={visible}
                                onAsk={run}
                                onSwitchVersion={(leaf) => {
                                    setLocalLeaf(leaf);
                                    if (conversationId) {
                                        setActiveLeaf.mutate({ conversationId, leafId: leaf });
                                    }
                                }}
                                pendingQuestion={pending?.question ?? null}
                                variant={variant}
                            />
                            {backdrop && (
                                <div className="mt-8">
                                    <GeneratedView panels={backdrop.panels} />
                                </div>
                            )}
                        </>
                    )}
                    <div ref={bottom} />
                </div>
            </div>

            <div
                className={`shrink-0 border-t border-slate-800 bg-paper ${
                    focus ? "px-4 py-4 sm:px-8" : "px-3 py-3"
                }`}
            >
                <div className={focus ? "mx-auto w-full max-w-3xl" : ""}>
                    <SageComposer
                        value={input}
                        onChange={setInput}
                        onSubmit={() => run(input)}
                        onCapture={() => onCapture(input)}
                        compact={!focus}
                        busy={ask.isPending}
                        placeholder={
                            focus
                                ? "Tell Sage what happened, or ask about your money…"
                                : "Ask Sage, or tell it what happened…"
                        }
                    />
                    {ask.isError && (
                        <p className="mt-2 text-xs text-rose-300">
                            {(ask.error as Error).message}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function EmptyCanvas({
    focus,
    onPick,
}: {
    focus: boolean;
    onPick: (prompt: string) => void;
}) {
    if (focus) {
        return (
            <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
                <span className="mb-5 inline-grid h-12 w-12 place-items-center rounded-2xl bg-coral-soft text-coral">
                    <SparkIcon size={24} />
                </span>
                <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
                    What's on your mind, money-wise?
                </h1>
                <p className="mx-auto mt-3 max-w-md text-sm text-slate-500 sm:text-base">
                    Tell Sage what happened, or ask a question — it'll capture the event
                    or answer from your real ledger.
                </p>
                <SuggestionChips
                    suggestions={SUGGESTIONS}
                    onPick={onPick}
                    className="mt-7 justify-center"
                />
            </div>
        );
    }

    return (
        <div className="py-6">
            <span className="inline-grid h-9 w-9 place-items-center rounded-xl bg-coral-soft text-coral">
                <SparkIcon size={18} />
            </span>
            <h2 className="mt-3 text-base font-bold text-slate-100">
                Ask Sage anything about your money
            </h2>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-slate-500">
                It reads your real ledger to answer — and if you tell it something that
                happened instead, it'll capture that.
            </p>
            <SuggestionChips
                suggestions={SUGGESTIONS.slice(0, 4)}
                onPick={onPick}
                className="mt-4"
            />
        </div>
    );
}
