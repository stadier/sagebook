// =============================================================================
// Sagebook · process-media Edge Function
// -----------------------------------------------------------------------------
// Receives multimodal input (image / audio / video / pdf / text), routes it
// through Gemini 1.5 Flash, normalises the model response into a structured
// ledger payload, and persists both the raw and parsed artefacts.
// =============================================================================

import { b2Configured, b2Download } from "../_shared/b2.ts";
import { commitParsedTransactions } from "../_shared/commit.ts";
import { MAX_INLINE_BYTES } from "../_shared/constants.ts";
import { loadUserContextHint } from "../_shared/context.ts";
import {
    createApp,
    errorMessage,
    ownsStoragePath,
    readJson,
    requireUser,
    serve,
} from "../_shared/http.ts";
import {
    type ExtractionInput,
    type ParsedPayload,
    base64FromArrayBuffer,
    detectMediaKind,
    estimateBase64Bytes,
    extractTransactions,
    inferMimeFromPath,
    pickProvider,
    providerHealthInfo,
    safeParse,
    selectedModelForProvider,
} from "../_shared/extract.ts";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface ProcessMediaRequest {
    inlineMedia?: { mimeType: string; data: string };
    text?: string;
    storagePath?: string;
    promptHint?: string;
    baseCurrency?: string;
}

// -----------------------------------------------------------------------------
// HTTP app
// -----------------------------------------------------------------------------

const app = createApp("process-media", {
    health: () => ({ b2: b2Configured(), ...providerHealthInfo() }),
});

app.post("/process-media", async (c) => {
    const auth = await requireUser(c);
    if (!auth.ok) return auth.response;
    const { userId, admin } = auth;

    const parsed = await readJson<ProcessMediaRequest>(c);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    if (!body.inlineMedia && !body.text && !body.storagePath) {
        return c.json({ error: "inlineMedia, storagePath, or text required" }, 400);
    }

    // Resolve storage-uploaded media into inline data for the model call.
    if (body.storagePath && !body.inlineMedia) {
        if (!ownsStoragePath(userId, body.storagePath)) {
            return c.json({ error: "storagePath must be under your own folder" }, 403);
        }
        const isB2 = body.storagePath.startsWith("b2:");
        const path = isB2 ? body.storagePath.slice(3) : body.storagePath;

        let bytesBuf: ArrayBuffer;
        let mime: string;
        if (isB2) {
            if (!b2Configured()) {
                return c.json({ error: "B2 storage is not configured" }, 503);
            }
            try {
                const file = await b2Download(path);
                bytesBuf = file.bytes;
                mime = file.contentType !== "application/octet-stream"
                    ? file.contentType
                    : inferMimeFromPath(path);
            } catch (err) {
                return c.json({
                    error: "could not download storage object",
                    detail: errorMessage(err),
                }, 400);
            }
        } else {
            const { data: blob, error: dlErr } = await admin.storage
                .from("ingest")
                .download(path);
            if (dlErr || !blob) {
                return c.json({
                    error: "could not download storage object",
                    detail: dlErr?.message ?? "empty object",
                }, 400);
            }
            bytesBuf = await blob.arrayBuffer();
            mime = blob.type && blob.type !== "application/octet-stream"
                ? blob.type
                : inferMimeFromPath(path);
        }

        if (bytesBuf.byteLength > MAX_INLINE_BYTES) {
            return c.json({
                error: "object too large",
                detail: `max ${MAX_INLINE_BYTES} bytes for inline model input; got ${bytesBuf.byteLength}`,
            }, 413);
        }
        body.inlineMedia = {
            mimeType: mime,
            data: base64FromArrayBuffer(bytesBuf),
        };
    }

    const mimeType  = body.inlineMedia?.mimeType ?? "text/plain";
    const mediaKind = detectMediaKind(mimeType);
    const bytes     = body.inlineMedia ? estimateBase64Bytes(body.inlineMedia.data) : (body.text?.length ?? 0);

    // Prime the model with this user's taxonomy and account names.
    const categoryHint = await loadUserContextHint(admin, userId, "process-media");

    // Record the ingestion as pending.
    const resolvedProvider = pickProvider(mediaKind);
    const provider = resolvedProvider ?? "none";
    const selectedModel = resolvedProvider ? selectedModelForProvider(resolvedProvider) : "unknown";

    const { data: ingestion, error: ingErr } = await admin
        .from("media_ingestions")
        .insert({
            user_id:      userId,
            storage_path: body.storagePath ?? null,
            media_kind:   mediaKind,
            mime_type:    mimeType,
            bytes,
            status:       "processing",
            prompt_hint:  body.promptHint ?? null,
            model:        selectedModel,
        })
        .select("id")
        .single();

    if (ingErr || !ingestion) {
        console.error("[process-media] ingestion insert failed", ingErr);
        return c.json({
            error: "could not create ingestion",
            detail: ingErr?.message ?? String(ingErr),
            provider,
            model: selectedModel,
        }, 500);
    }

    // Call AI extraction.
    try {
        const input: ExtractionInput = {
            inlineMedia: body.inlineMedia,
            text: body.text,
            promptHint: body.promptHint,
            baseCurrency: body.baseCurrency,
        };
        const result = await extractTransactions(input, mediaKind, categoryHint);
        const parsed = safeParse<ParsedPayload>(result.raw);

        if (!parsed) {
            await admin.from("media_ingestions").update({
                status:       "failed",
                raw_response: { text: result.raw },
                error:        "model returned non-JSON payload",
            }).eq("id", ingestion.id);
            return c.json({
                error: "model returned non-JSON",
                ingestionId: ingestion.id,
                provider: result.provider,
                model: result.model,
            }, 502);
        }

        await admin.from("media_ingestions").update({
            status:         "parsed",
            raw_response:   { text: result.raw },
            parsed_payload: parsed,
        }).eq("id", ingestion.id);

        const commitResult = await commitParsedTransactions(
            admin, userId, ingestion.id, parsed.transactions ?? []);

        return c.json({
            ingestionId: ingestion.id,
            provider: result.provider,
            model: result.model,
            parsed,
            committed:    commitResult.committed,
            duplicates:   commitResult.duplicates,
            rulesApplied: commitResult.rulesApplied,
            inbox:        commitResult.transactions,
            insertErrors: commitResult.insertErrors,
        });
    } catch (err) {
        const message = errorMessage(err);
        const status = inferUpstreamStatus(message);
        console.error("[process-media] model invocation failed", message);
        await admin.from("media_ingestions").update({
            status: "failed",
            error:  message,
        }).eq("id", ingestion.id);
        return c.json({
            error: "model invocation failed",
            detail: message,
            provider,
            model: selectedModel,
        }, status);
    }
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Map a provider failure onto a status the client can act on: 429 means "back
 *  off and retry", 502 means "the model is wrong/unavailable", 500 is ours. */
function inferUpstreamStatus(message: string): 429 | 502 | 500 {
    if (/\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(message)) return 429;
    if (/\b404\b|NOT_FOUND/i.test(message)) return 502;
    return 500;
}

serve(app);
