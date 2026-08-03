/* The conversation, drawn.

   A thread here is a path through a tree, not a list (see `lib/sage.ts`). That
   shows up in two places: a question you have asked more than one way carries a
   ‹1/2› switcher, and "Edit" does not overwrite anything — it asks a new
   version of the same turn beside the old one. Both readings stay; you choose
   which one the conversation continues from. That is why none of this needs a
   confirmation dialog: there is no destructive path through it.

   Sage's own turns render through `SageBlocks`, so an answer in the dock is the
   same answer, with the same real tables, as the one on the console canvas. */

import { useState } from "react";
import {
    deepestLeaf,
    versionsOf,
    type SageMessage,
    type SageQueryResult,
} from "../../lib/sage";
import { SageBlocks } from "../console/SageAnswer";
import { ChevronLeftIcon, ChevronRightIcon, EditIcon, ReplayIcon, SparkIcon } from "../icons";
import { SageComposer } from "./SageComposer";

export interface SageThreadProps {
    /** Every message in the conversation — the tree the versions come from. */
    messages: SageMessage[];
    /** The branch on screen, oldest first. */
    thread: SageMessage[];
    /** Re-ask a turn: a new question under `parentId`. */
    onAsk: (question: string, parentId: string | null) => void;
    /** Move the conversation to a different branch. */
    onSwitchVersion: (leafId: string) => void;
    /** The question Sage is working on right now, if any. */
    pendingQuestion?: string | null;
    /** Wider gutters and the full query trace on the console canvas. */
    variant: "dock" | "focus";
}

export function SageThread({
    messages,
    thread,
    onAsk,
    onSwitchVersion,
    pendingQuestion,
    variant,
}: SageThreadProps) {
    const [editing, setEditing] = useState<string | null>(null);

    return (
        <div className="flex flex-col gap-5">
            {thread.map((message) =>
                message.role === "user" ? (
                    <UserTurn
                        key={message.id}
                        message={message}
                        messages={messages}
                        editing={editing === message.id}
                        onStartEdit={() => setEditing(message.id)}
                        onCancelEdit={() => setEditing(null)}
                        onSubmitEdit={(text) => {
                            setEditing(null);
                            onAsk(text, message.parent_id);
                        }}
                        onSwitchVersion={onSwitchVersion}
                    />
                ) : (
                    <SageTurn
                        key={message.id}
                        message={message}
                        onAsk={(question) => onAsk(question, message.id)}
                        onRetry={() => {
                            const asked = messages.find((m) => m.id === message.parent_id);
                            if (asked) onAsk(asked.content, asked.parent_id);
                        }}
                        variant={variant}
                    />
                ),
            )}

            {pendingQuestion && (
                <>
                    <Bubble>{pendingQuestion}</Bubble>
                    <Working />
                </>
            )}
        </div>
    );
}

/* --- The user's turn -------------------------------------------------------- */

function UserTurn({
    message,
    messages,
    editing,
    onStartEdit,
    onCancelEdit,
    onSubmitEdit,
    onSwitchVersion,
}: {
    message: SageMessage;
    messages: SageMessage[];
    editing: boolean;
    onStartEdit: () => void;
    onCancelEdit: () => void;
    onSubmitEdit: (text: string) => void;
    onSwitchVersion: (leafId: string) => void;
}) {
    const [text, setText] = useState(message.content);
    const versions = versionsOf(messages, message);
    const index = versions.findIndex((v) => v.id === message.id);

    if (editing) {
        return (
            <div className="flex flex-col gap-1.5">
                <SageComposer
                    value={text}
                    onChange={setText}
                    onSubmit={() => text.trim() && onSubmitEdit(text.trim())}
                    onCancel={() => {
                        setText(message.content);
                        onCancelEdit();
                    }}
                    compact
                    autoFocus
                    submitLabel="Ask this instead"
                    placeholder="Ask it a different way…"
                />
                <p className="px-1 text-[0.6875rem] text-slate-500">
                    Kept as another version of this question — the original stays
                    where it is.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-end gap-1.5">
            <Bubble>{message.content}</Bubble>
            {/* Always visible, never a hover reveal: an action you cannot see is
                an action you cannot find. */}
            <div className="flex items-center gap-1">
                {versions.length > 1 && (
                    <VersionSwitcher
                        versions={versions}
                        index={index}
                        onPick={(target) => onSwitchVersion(deepestLeaf(messages, target.id))}
                    />
                )}
                <button
                    onClick={() => {
                        setText(message.content);
                        onStartEdit();
                    }}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[0.6875rem] text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-300"
                >
                    <EditIcon size={12} />
                    Edit
                </button>
            </div>
        </div>
    );
}

function Bubble({ children }: { children: React.ReactNode }) {
    return (
        <div className="max-w-[88%] self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-slate-800 px-3.5 py-2.5 text-[0.9375rem] leading-relaxed text-slate-100">
            {children}
        </div>
    );
}

function VersionSwitcher({
    versions,
    index,
    onPick,
}: {
    versions: SageMessage[];
    index: number;
    onPick: (message: SageMessage) => void;
}) {
    return (
        <div className="flex items-center gap-0.5 rounded-lg bg-slate-900 px-1 py-0.5 text-[0.6875rem] text-slate-500">
            <button
                onClick={() => onPick(versions[index - 1])}
                disabled={index <= 0}
                aria-label="Previous version"
                className="grid h-5 w-5 place-items-center rounded transition-colors hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500"
            >
                <ChevronLeftIcon size={12} />
            </button>
            <span className="tnum px-0.5">
                {index + 1}/{versions.length}
            </span>
            <button
                onClick={() => onPick(versions[index + 1])}
                disabled={index >= versions.length - 1}
                aria-label="Next version"
                className="grid h-5 w-5 place-items-center rounded transition-colors hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500"
            >
                <ChevronRightIcon size={12} />
            </button>
        </div>
    );
}

/* --- Sage's turn ------------------------------------------------------------ */

function SageTurn({
    message,
    onAsk,
    onRetry,
    variant,
}: {
    message: SageMessage;
    onAsk: (question: string) => void;
    onRetry: () => void;
    variant: "dock" | "focus";
}) {
    if (message.error || !message.answer) {
        return (
            <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-3.5 text-sm">
                <p className="font-medium text-rose-300">Sage couldn't answer that.</p>
                <p className="mt-1 text-slate-400">
                    {message.error ?? "No answer came back."}
                </p>
                <button
                    onClick={onRetry}
                    className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
                >
                    <ReplayIcon size={13} />
                    Ask again
                </button>
            </div>
        );
    }

    const answer = message.answer;

    return (
        <div className="flex min-w-0 gap-2.5">
            <span className="mt-1 shrink-0 text-coral">
                <SparkIcon size={16} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-3">
                <SageBlocks answer={answer} />

                {answer.followups && answer.followups.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {answer.followups.slice(0, 3).map((f) => (
                            <button
                                key={f}
                                onClick={() => onAsk(f)}
                                className="rounded-full border border-slate-800 px-2.5 py-1 text-[0.6875rem] text-slate-400 transition-colors hover:border-coral/40 hover:text-slate-200"
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                )}

                {/* What it actually looked up — an answer about money should be
                    auditable, not taken on trust. */}
                {answer.queries.length > 0 && (
                    <QueryTrace queries={answer.queries} verbose={variant === "focus"} />
                )}
            </div>
        </div>
    );
}

function QueryTrace({
    queries,
    verbose,
}: {
    queries: SageQueryResult[];
    verbose: boolean;
}) {
    return (
        <details className="border-t border-slate-800 pt-2.5">
            <summary className="cursor-pointer text-[0.6875rem] text-slate-500 hover:text-slate-300">
                Show the {queries.length} quer{queries.length === 1 ? "y" : "ies"} behind this
            </summary>
            <div className="mt-2 flex flex-col gap-2">
                {queries.map((q) => (
                    <div key={q.id} className="rounded-lg bg-slate-950 p-2.5 text-[0.6875rem]">
                        <div className="text-slate-400">
                            {q.purpose ?? q.select} · {q.matched} row
                            {q.matched === 1 ? "" : "s"}
                            {q.truncated && " (capped)"}
                        </div>
                        {verbose && (
                            <pre className="mt-1 max-h-40 overflow-auto text-[0.625rem] text-slate-500">
                                {JSON.stringify(q.data, null, 1)}
                            </pre>
                        )}
                    </div>
                ))}
            </div>
        </details>
    );
}

function Working() {
    return (
        <div className="flex gap-2.5">
            <span className="mt-1 shrink-0 text-coral">
                <SparkIcon size={16} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm text-slate-500">Reading your ledger…</p>
                <div className="sb-skeleton h-3 w-3/4" />
                <div className="sb-skeleton h-3 w-1/2" />
            </div>
        </div>
    );
}
