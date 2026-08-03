// =============================================================================
// Sagebook · ask-sage
// -----------------------------------------------------------------------------
// Answers a question about the caller's ledger, as a turn in a conversation.
// The reasoning is in _shared/ask.ts; this file owns the thread: which turns
// came before, where the new one hangs, and what gets written down.
//
// Messages form a tree (see the sage_conversations migration). That makes
// editing an earlier question the same operation as asking a new one — pass the
// *parent of the message being edited* and the new turn lands beside the old
// one instead of on top of it. Nothing is deleted to make room, which is why
// there is no "edit" endpoint here and no destructive path to guard.
// =============================================================================

import { askLedger, type HistoryTurn, type SageAnswer } from "../_shared/ask.ts";
import { createApp, errorMessage, readJson, requireUser, serve } from "../_shared/http.ts";
import type { SupabaseClient } from "../_shared/deps.ts";

/** Long enough for any real question, short enough to reject a pasted essay. */
const MAX_QUESTION = 500;
/** Characters of the opening question kept as the conversation's name. */
const MAX_TITLE = 70;

interface AskRequest {
    question?: string;
    /** Omitted for the first question, which opens a new conversation. */
    conversationId?: string;
    /**
     * The turn this replies to. Omitted continues the branch on screen; set to
     * an earlier message's parent to ask a different version of that turn.
     */
    parentMessageId?: string | null;
    /** The screen the question was asked from. Used, not stored. */
    context?: string;
}

/** Characters of caller-supplied screen context trusted into the prompt. */
const MAX_CONTEXT = 60;

interface MessageRow {
    id: string;
    parent_id: string | null;
    role: "user" | "sage";
    content: string;
    created_at: string;
}

const app = createApp("ask-sage");

/** First line of the question, trimmed to something that fits a sidebar. */
function titleFrom(question: string): string {
    const line = question.split("\n")[0].trim();
    return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line;
}

/**
 * The path from `leafId` back to the root, oldest first. Walked in memory
 * rather than by recursive CTE: a conversation is bounded by human patience,
 * and the whole tree is needed anyway to answer "which branch is this".
 */
function threadTo(messages: MessageRow[], leafId: string | null): MessageRow[] {
    if (!leafId) return [];
    const byId = new Map(messages.map((m) => [m.id, m]));
    const path: MessageRow[] = [];
    let cursor = byId.get(leafId);
    // `seen` guards against a cycle that no valid write can create but that a
    // corrupt row could, and which would otherwise hang the request.
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        path.push(cursor);
        cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    return path.reverse();
}

app.post("/ask-sage", async (c) => {
    const auth = await requireUser(c);
    if (!auth.ok) return auth.response;
    const { admin, userId } = auth;

    const parsed = await readJson<AskRequest>(c);
    if (!parsed.ok) return parsed.response;

    const question = (parsed.body.question ?? "").trim();
    if (!question) return c.json({ error: "question is required" }, 400);
    if (question.length > MAX_QUESTION) {
        return c.json({ error: `question must be under ${MAX_QUESTION} characters` }, 400);
    }

    let conversationId = parsed.body.conversationId ?? null;
    let parentId = parsed.body.parentMessageId ?? null;
    let history: HistoryTurn[] = [];

    if (conversationId) {
        const { data: conversation, error } = await admin
            .from("sage_conversations")
            .select("id, active_leaf_id")
            .eq("id", conversationId)
            .eq("user_id", userId)
            .maybeSingle();
        if (error) return c.json({ error: error.message }, 500);
        if (!conversation) return c.json({ error: "conversation not found" }, 404);

        const { data, error: msgError } = await admin
            .from("sage_messages")
            .select("id, parent_id, role, content, created_at")
            .eq("conversation_id", conversationId)
            .eq("user_id", userId)
            .order("created_at", { ascending: true });
        if (msgError) return c.json({ error: msgError.message }, 500);
        const messages = (data ?? []) as MessageRow[];

        // An explicit parent is a branch point and must be a real turn in this
        // conversation; without one, continue whatever branch is on screen.
        if (parentId !== null) {
            if (!messages.some((m) => m.id === parentId)) {
                return c.json({ error: "parentMessageId is not part of this conversation" }, 400);
            }
        } else if (parsed.body.parentMessageId === undefined) {
            parentId = (conversation as { active_leaf_id: string | null }).active_leaf_id;
        }

        history = threadTo(messages, parentId).map((m) => ({
            role: m.role,
            content: m.content,
        }));
    } else {
        const { data, error } = await admin
            .from("sage_conversations")
            .insert({ user_id: userId, title: titleFrom(question) })
            .select("id")
            .single();
        if (error) return c.json({ error: error.message }, 500);
        conversationId = (data as { id: string }).id;
        parentId = null;
    }

    const { data: userRow, error: userError } = await admin
        .from("sage_messages")
        .insert({
            conversation_id: conversationId,
            user_id: userId,
            parent_id: parentId,
            role: "user",
            content: question,
        })
        .select("id, parent_id, role, content, created_at")
        .single();
    if (userError) return c.json({ error: userError.message }, 500);
    const userMessage = userRow as MessageRow;

    // A model that can't be reached is written down as a failed turn rather
    // than thrown away: the question stays in the thread, and the user can
    // retry it in place instead of retyping it.
    let answer: SageAnswer | null = null;
    let failure: string | null = null;
    try {
        answer = await askLedger(
            admin,
            userId,
            question,
            history,
            parsed.body.context?.trim().slice(0, MAX_CONTEXT) || undefined,
        );
    } catch (err) {
        failure = errorMessage(err);
        console.error("[ask-sage]", failure);
    }

    const { data: sageRow, error: sageError } = await admin
        .from("sage_messages")
        .insert({
            conversation_id: conversationId,
            user_id: userId,
            parent_id: userMessage.id,
            role: "sage",
            content: answer?.answer ?? "",
            answer,
            error: failure,
        })
        .select("id, parent_id, role, content, answer, error, created_at")
        .single();
    if (sageError) return c.json({ error: sageError.message }, 500);

    await touchConversation(admin, userId, conversationId, (sageRow as { id: string }).id);

    return c.json({
        conversationId,
        userMessage,
        sageMessage: sageRow,
    });
});

/**
 * Point the conversation at the turn just written and bump it to the top of the
 * history list. Not fatal if it fails — the messages are saved either way, and
 * a refetch rebuilds the thread from the tree.
 */
async function touchConversation(
    admin: SupabaseClient,
    userId: string,
    conversationId: string,
    leafId: string,
): Promise<void> {
    const { error } = await admin
        .from("sage_conversations")
        .update({ active_leaf_id: leafId })
        .eq("id", conversationId)
        .eq("user_id", userId);
    if (error) console.error("[ask-sage] leaf update", error.message);
}

serve(app);
