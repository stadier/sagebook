/* Sage's answering layer.

   `lib/console/intents.ts` decides *which dashboard* a question deserves from
   keywords alone; that stays, because the panels are a useful backdrop. This is
   the other half — the actual answer, computed by the `ask-sage` function from
   real queries against the ledger rather than from anything the client guessed.

   The client sends a question and gets back prose plus the figures behind it.
   Nothing here interprets the numbers; that already happened server-side, where
   the data is.

   Conversations live here too. Messages come back as a *tree*, not a list:
   `parent_id` is what a turn replied to, and two turns sharing a parent are two
   versions of the same question. So the thread on screen is a path — from the
   conversation's `active_leaf_id` back to the root — and editing an old message
   forks the path rather than overwriting it. `threadOf` and `versionsOf` are
   the two functions that make that tree read like a conversation. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeFn, requireSupabase } from "./supabase";

export interface SageHighlight {
    label: string;
    value: string;
    hint?: string;
}

/** One query the planner ran, kept so the answer can show its working. */
export interface SageQueryResult {
    id: string;
    purpose?: string;
    select: string;
    matched: number;
    truncated?: boolean;
    data: unknown;
}

/** One transaction from a `list` query. */
export interface SageListRow {
    id: string;
    date: string;
    description: string;
    account: string | null;
    category: string | null;
    kind: string;
    amount: number;
    currency: string;
}

/** One row of a `breakdown` query — a group and its per-currency totals. */
export interface SageBreakdownRow {
    group: string;
    count: number;
    totals: Record<string, number>;
}

/**
 * How Sage composes a reply. A `table` block carries no data — only the id of a
 * query in `queries`, whose rows the client renders itself. That is deliberate:
 * the figures reaching the screen are the ones the ledger returned, never a
 * copy the model retyped on the way past.
 */
export type SageBlock =
    | { type: "prose"; text: string }
    | { type: "stats"; title?: string; items: SageHighlight[] }
    | { type: "table"; title?: string; queryId: string };

export interface SageAnswer {
    answer: string;
    /** Absent on older answers, which fall back to `answer` + `highlights`. */
    blocks?: SageBlock[];
    highlights?: SageHighlight[];
    followups?: string[];
    queries: SageQueryResult[];
    model: string;
}

/* --- Conversations --------------------------------------------------------- */

export interface SageConversation {
    id: string;
    title: string;
    /** Tip of the branch currently on screen; null while the thread is empty. */
    active_leaf_id: string | null;
    /** Set while the conversation is out of the history list but still kept. */
    archived_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SageMessage {
    id: string;
    conversation_id: string;
    parent_id: string | null;
    role: "user" | "sage";
    /** The question as typed, or Sage's one-line gist. */
    content: string;
    /** Sage turns only — the whole answer, replayed rather than re-asked. */
    answer: SageAnswer | null;
    /** Set when the model was unreachable, so the turn can be retried in place. */
    error: string | null;
    created_at: string;
}

export interface AskResult {
    conversationId: string;
    userMessage: SageMessage;
    sageMessage: SageMessage;
}

export interface AskInput {
    question: string;
    conversationId?: string;
    /**
     * The turn this replies to. Left undefined it continues the branch on
     * screen; passing an earlier message's parent asks a *different version* of
     * that turn, which is how editing works — nothing is deleted to make room.
     */
    parentMessageId?: string | null;
    /**
     * What the user is looking at while they ask — "the Ledger", "Budgets". Sent
     * so "why is this uncategorised?" has a referent, and deliberately not
     * stored on the message: it is context for one answer, not part of what was
     * said.
     */
    context?: string;
}

export const SAGE_QK = {
    conversations: ["sage-conversations"] as const,
    messages: (conversationId: string | null) => ["sage-messages", conversationId] as const,
};

const CONVERSATION_COLUMNS =
    "id, title, active_leaf_id, archived_at, created_at, updated_at";

const MESSAGE_COLUMNS =
    "id, conversation_id, parent_id, role, content, answer, error, created_at";

/* --- Reading the tree ------------------------------------------------------
   Pure functions over the message list, so both the dock and the full-screen
   console derive the same thread from the same rows without either owning it. */

/** The path from `leafId` back to the root, oldest first — the thread on screen. */
export function threadOf(messages: SageMessage[], leafId: string | null): SageMessage[] {
    if (!leafId) return [];
    const byId = new Map(messages.map((m) => [m.id, m]));
    const path: SageMessage[] = [];
    const seen = new Set<string>();
    let cursor = byId.get(leafId);
    while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        path.push(cursor);
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    return path.reverse();
}

/**
 * Every version of a turn — the message plus its siblings, oldest first. One
 * entry means the question was only ever asked one way, and the switcher stays
 * out of the way.
 */
export function versionsOf(messages: SageMessage[], message: SageMessage): SageMessage[] {
    return messages
        .filter((m) => m.parent_id === message.parent_id && m.role === message.role)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * The tip of the branch hanging off `messageId`. Where a turn was asked more
 * than once, the newest continuation wins — switching back to an old version
 * should restore the last thing you said under it, not the first.
 */
export function deepestLeaf(messages: SageMessage[], messageId: string): string {
    const children = new Map<string, SageMessage[]>();
    for (const m of messages) {
        if (!m.parent_id) continue;
        const bucket = children.get(m.parent_id);
        if (bucket) bucket.push(m);
        else children.set(m.parent_id, [m]);
    }
    let cursor = messageId;
    const seen = new Set<string>();
    for (;;) {
        if (seen.has(cursor)) return cursor;
        seen.add(cursor);
        const next = children.get(cursor);
        if (!next?.length) return cursor;
        cursor = next.reduce((latest, m) =>
            m.created_at > latest.created_at ? m : latest,
        ).id;
    }
}

/* --- Hooks ----------------------------------------------------------------- */

/**
 * Every conversation, archived ones included. The history panel filters them —
 * one cache entry keeps "Show archived" instant and stops the two lists from
 * disagreeing about a conversation that was just archived.
 */
export function useConversations() {
    return useQuery({
        queryKey: SAGE_QK.conversations,
        queryFn: async (): Promise<SageConversation[]> => {
            const { data, error } = await requireSupabase()
                .from("sage_conversations")
                .select(CONVERSATION_COLUMNS)
                .order("updated_at", { ascending: false })
                .limit(200);
            if (error) throw new Error(error.message);
            return (data ?? []) as SageConversation[];
        },
    });
}

/** Every message in a conversation. The thread is derived, never fetched. */
export function useConversationMessages(conversationId: string | null) {
    return useQuery({
        queryKey: SAGE_QK.messages(conversationId),
        enabled: !!conversationId,
        queryFn: async (): Promise<SageMessage[]> => {
            const { data, error } = await requireSupabase()
                .from("sage_messages")
                .select(MESSAGE_COLUMNS)
                .eq("conversation_id", conversationId!)
                .order("created_at", { ascending: true });
            if (error) throw new Error(error.message);
            return (data ?? []) as SageMessage[];
        },
    });
}

export function askSage(input: AskInput): Promise<AskResult> {
    return invokeFn<AskResult>("ask-sage", input);
}

/**
 * Ask a question and fold the reply into the cache. Both message rows are
 * written straight in rather than refetched, so the answer appears the moment
 * it lands; the conversation list is invalidated because its ordering and a
 * brand-new conversation's title both come from the server.
 */
export function useAskSage() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: askSage,
        onSuccess: (result) => {
            qc.setQueryData<SageMessage[]>(
                SAGE_QK.messages(result.conversationId),
                (prev) => [...(prev ?? []), result.userMessage, result.sageMessage],
            );
            qc.invalidateQueries({ queryKey: SAGE_QK.conversations });
        },
    });
}

/** Move the conversation to a different branch — the version switcher. */
export function useSetActiveLeaf() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            conversationId,
            leafId,
        }: {
            conversationId: string;
            leafId: string;
        }) => {
            const { error } = await requireSupabase()
                .from("sage_conversations")
                .update({ active_leaf_id: leafId })
                .eq("id", conversationId);
            if (error) throw new Error(error.message);
        },
        onMutate: ({ conversationId, leafId }) => {
            // Switching versions should feel like a tab, not a request.
            qc.setQueryData<SageConversation[]>(SAGE_QK.conversations, (prev) =>
                prev?.map((c) =>
                    c.id === conversationId ? { ...c, active_leaf_id: leafId } : c,
                ),
            );
        },
        onSettled: () => qc.invalidateQueries({ queryKey: SAGE_QK.conversations }),
    });
}

export function useRenameConversation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, title }: { id: string; title: string }) => {
            const { error } = await requireSupabase()
                .from("sage_conversations")
                .update({ title })
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: SAGE_QK.conversations }),
    });
}

/** Out of the list, still on record. The reversible answer to "clear this". */
export function useArchiveConversation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
            const { error } = await requireSupabase()
                .from("sage_conversations")
                .update({ archived_at: archived ? new Date().toISOString() : null })
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: SAGE_QK.conversations }),
    });
}

/** Deletes the conversation and, by cascade, every turn in it. */
export function useDeleteConversation() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (id: string) => {
            const { error } = await requireSupabase()
                .from("sage_conversations")
                .delete()
                .eq("id", id);
            if (error) throw new Error(error.message);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: SAGE_QK.conversations }),
    });
}
