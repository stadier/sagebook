// =============================================================================
// Sagebook · ask-sage
// -----------------------------------------------------------------------------
// Answers a question about the caller's ledger. The work is in
// _shared/ask.ts — this is the HTTP shell: authenticate, validate, delegate.
// =============================================================================

import { askLedger } from "../_shared/ask.ts";
import { createApp, errorMessage, readJson, requireUser, serve } from "../_shared/http.ts";

/** Long enough for any real question, short enough to reject a pasted essay. */
const MAX_QUESTION = 500;

interface AskRequest {
    question?: string;
}

const app = createApp("ask-sage");

app.post("/ask-sage", async (c) => {
    const auth = await requireUser(c);
    if (!auth.ok) return auth.response;

    const parsed = await readJson<AskRequest>(c);
    if (!parsed.ok) return parsed.response;

    const question = (parsed.body.question ?? "").trim();
    if (!question) return c.json({ error: "question is required" }, 400);
    if (question.length > MAX_QUESTION) {
        return c.json({ error: `question must be under ${MAX_QUESTION} characters` }, 400);
    }

    try {
        return c.json(await askLedger(auth.admin, auth.userId, question));
    } catch (err) {
        // The model being unreachable is the only failure that gets this far;
        // a failing query is reported inside the answer instead.
        console.error("[ask-sage]", errorMessage(err));
        return c.json({ error: errorMessage(err) }, 502);
    }
});

serve(app);
