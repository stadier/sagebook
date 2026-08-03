/* Earlier conversations.

   Rendered as a popover in the dock and as the rail in full-screen focus mode,
   which is why it takes its chrome from the caller and only owns the list.

   Archive is the primary action and delete is behind it: a conversation holds
   figures Sage worked out from a ledger that has since moved on, and there is
   no way to get those back. Same shape as every other destructive action in the
   app — the reversible thing first, the permanent one after a confirmation. */

import { useState } from "react";
import {
    useArchiveConversation,
    useConversations,
    useDeleteConversation,
    useRenameConversation,
    type SageConversation,
} from "../../lib/sage";
import { useConfirm } from "../Confirm";
import { ArchiveIcon, CheckIcon, EditIcon, TrashIcon, UnarchiveIcon } from "../icons";

export function SageHistory({
    activeId,
    onPick,
    onDeleted,
}: {
    activeId: string | null;
    onPick: (id: string) => void;
    /** The open conversation was archived or deleted — the caller must move on. */
    onDeleted: (id: string) => void;
}) {
    const conversations = useConversations();
    const [showArchived, setShowArchived] = useState(false);
    const [renaming, setRenaming] = useState<string | null>(null);

    const all = conversations.data ?? [];
    const shown = all.filter((c) => (showArchived ? c.archived_at : !c.archived_at));
    const archivedCount = all.filter((c) => c.archived_at).length;

    if (conversations.isLoading) {
        return <p className="px-2 py-3 text-xs text-slate-500">Loading…</p>;
    }

    return (
        <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
                {shown.length === 0 ? (
                    <p className="px-2 py-3 text-xs text-slate-500">
                        {showArchived
                            ? "Nothing archived."
                            : "Ask Sage something and it'll be saved here."}
                    </p>
                ) : (
                    <ul className="flex flex-col gap-0.5">
                        {shown.map((conversation) => (
                            <li key={conversation.id}>
                                <ConversationRow
                                    conversation={conversation}
                                    active={conversation.id === activeId}
                                    renaming={renaming === conversation.id}
                                    onStartRename={() => setRenaming(conversation.id)}
                                    onStopRename={() => setRenaming(null)}
                                    onPick={() => onPick(conversation.id)}
                                    onGone={() => onDeleted(conversation.id)}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {(archivedCount > 0 || showArchived) && (
                <button
                    onClick={() => setShowArchived(!showArchived)}
                    className="mt-1 shrink-0 rounded-lg px-2 py-1.5 text-left text-[0.6875rem] text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
                >
                    {showArchived ? "← Back to recent" : `Archived (${archivedCount})`}
                </button>
            )}
        </div>
    );
}

function ConversationRow({
    conversation,
    active,
    renaming,
    onStartRename,
    onStopRename,
    onPick,
    onGone,
}: {
    conversation: SageConversation;
    active: boolean;
    renaming: boolean;
    onStartRename: () => void;
    onStopRename: () => void;
    onPick: () => void;
    onGone: () => void;
}) {
    const confirm = useConfirm();
    const rename = useRenameConversation();
    const archive = useArchiveConversation();
    const remove = useDeleteConversation();
    const [title, setTitle] = useState(conversation.title);
    const archived = !!conversation.archived_at;

    if (renaming) {
        return (
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    const next = title.trim();
                    if (next && next !== conversation.title) {
                        rename.mutate({ id: conversation.id, title: next });
                    }
                    onStopRename();
                }}
                className="flex items-center gap-1 px-1 py-0.5"
            >
                <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            setTitle(conversation.title);
                            onStopRename();
                        }
                    }}
                    aria-label="Conversation name"
                    className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5 text-[0.8125rem] text-white outline-none ring-1 ring-coral/40"
                />
                <button
                    type="submit"
                    aria-label="Save name"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
                >
                    <CheckIcon size={14} />
                </button>
            </form>
        );
    }

    function askToDelete() {
        confirm({
            title: "Delete this conversation?",
            danger: true,
            body: (
                <>
                    <strong className="text-slate-200">{conversation.title}</strong> and
                    every turn in it go for good — including the figures Sage worked out
                    from a ledger that may have moved on since.
                </>
            ),
            confirmLabel: "Delete permanently",
            alternative: {
                label: "Archive instead",
                hint: "Out of the list, still there if you want it back.",
                onSelect: () => {
                    archive.mutate({ id: conversation.id, archived: true });
                    if (active) onGone();
                },
            },
            onConfirm: () => {
                remove.mutate(conversation.id);
                if (active) onGone();
            },
        });
    }

    return (
        <div
            className={`group flex items-center gap-0.5 rounded-lg pr-1 transition-colors ${
                active ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
            }`}
        >
            <button
                onClick={onPick}
                className={`min-w-0 flex-1 truncate px-2 py-2 text-left text-[0.8125rem] ${
                    active ? "text-white" : "text-white/65"
                }`}
                title={conversation.title}
            >
                {conversation.title}
            </button>
            {/* Quiet, but never hidden — a row you can see is a row you can act on. */}
            <button
                onClick={onStartRename}
                aria-label={`Rename ${conversation.title}`}
                title="Rename"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/30 transition-colors hover:bg-white/10 hover:text-white"
            >
                <EditIcon size={12} />
            </button>
            <button
                onClick={() => {
                    archive.mutate({ id: conversation.id, archived: !archived });
                    if (active && !archived) onGone();
                }}
                aria-label={`${archived ? "Restore" : "Archive"} ${conversation.title}`}
                title={archived ? "Restore" : "Archive"}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/30 transition-colors hover:bg-white/10 hover:text-white"
            >
                {archived ? <UnarchiveIcon size={12} /> : <ArchiveIcon size={12} />}
            </button>
            <button
                onClick={askToDelete}
                aria-label={`Delete ${conversation.title}`}
                title="Delete"
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-white/30 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
            >
                <TrashIcon size={12} />
            </button>
        </div>
    );
}
