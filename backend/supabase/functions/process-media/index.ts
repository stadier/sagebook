// =============================================================================
// Sagebook · process-media Edge Function
// -----------------------------------------------------------------------------
// Receives multimodal input (image / audio / video / pdf / text), routes it
// through Gemini 1.5 Flash, normalises the model response into a structured
// ledger payload, and persists both the raw and parsed artefacts.
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { b2Configured, b2Download } from "../_shared/b2.ts";
import { commitParsedTransactions } from "../_shared/commit.ts";
import {
    type ExtractionInput,
    type MediaKind,
    type ParsedPayload,
    base64FromArrayBuffer,
    buildCategoryHint,
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
// Environment
// -----------------------------------------------------------------------------

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")         ?? "";
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY")    ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY")
                          ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.warn("[process-media] Supabase env vars missing; runtime calls will fail.");
}

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

/** Cap for inlining storage objects into a model request (base64 overhead ~33%). */
const MAX_STORAGE_BYTES = 15 * 1024 * 1024;

// -----------------------------------------------------------------------------
// HTTP app
// -----------------------------------------------------------------------------

const app = new Hono();

app.use("*", cors({
    origin: "*",
    allowHeaders: ["authorization", "content-type", "x-client-info", "apikey"],
    allowMethods: ["POST", "OPTIONS"],
}));

app.get("/process-media/health", (c) => c.json({
    ok: true,
    b2: b2Configured(),
    ...providerHealthInfo(),
}));

app.post("/process-media", async (c) => {
    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return c.json({ error: "missing bearer token" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
        return c.json({ error: "invalid session" }, 401);
    }
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    let body: ProcessMediaRequest;
    try {
        body = await c.req.json<ProcessMediaRequest>();
    } catch {
        return c.json({ error: "body must be JSON" }, 400);
    }

    if (!body.inlineMedia && !body.text && !body.storagePath) {
        return c.json({ error: "inlineMedia, storagePath, or text required" }, 400);
    }

    // Resolve storage-uploaded media into inline data for the model call.
    if (body.storagePath && !body.inlineMedia) {
        const isB2 = body.storagePath.startsWith("b2:");
        const path = isB2 ? body.storagePath.slice(3) : body.storagePath;
        if (!path.startsWith(`${userId}/`)) {
            return c.json({ error: "storagePath must be under your own folder" }, 403);
        }

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
                    detail: err instanceof Error ? err.message : String(err),
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

        if (bytesBuf.byteLength > MAX_STORAGE_BYTES) {
            return c.json({
                error: "object too large",
                detail: `max ${MAX_STORAGE_BYTES} bytes for inline model input; got ${bytesBuf.byteLength}`,
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

    // Load the user's taxonomy and accounts for the extraction prompt.
    let categoryHint: string | null = null;
    try {
        const [{ data: cats }, { data: groups }, { data: accounts }] = await Promise.all([
            admin.from("categories")
                .select("id, name, parent_id, group_id")
                .eq("user_id", userId),
            admin.from("category_groups")
                .select("id, name")
                .eq("user_id", userId),
            admin.from("accounts")
                .select("name, institution, type")
                .eq("user_id", userId)
                .eq("is_archived", false),
        ]);
        const catById   = new Map((cats ?? []).map((c: { id: string }) => [c.id, c]));
        const groupById = new Map((groups ?? []).map((g: { id: string }) => [g.id, g]));
        categoryHint = buildCategoryHint((cats ?? []).map((c: { name: string; parent_id: string | null; group_id: string | null }) => ({
            name:   c.name,
            parent: c.parent_id ? catById.get(c.parent_id) ?? null : null,
            group:  c.group_id  ? groupById.get(c.group_id) ?? null : null,
        })));
        if (accounts?.length) {
            const lines = accounts.map((a: { name: string; institution: string | null; type: string }) =>
                `- ${a.name}${a.institution ? ` (${a.institution})` : ""} [${a.type}]`);
            categoryHint = `${categoryHint ?? ""}\n\nUser's accounts:\n${lines.join("\n")}`;
        }
    } catch (err) {
        console.warn("[process-media] context hint fetch failed", err);
    }

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
        const message = err instanceof Error ? err.message : String(err);
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

function inferUpstreamStatus(message: string): 429 | 502 | 500 {
    if (/\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(message)) return 429;
    if (/\b404\b|NOT_FOUND/i.test(message)) return 502;
    return 500;
}

// -----------------------------------------------------------------------------
// Deno serve hook
// -----------------------------------------------------------------------------

Deno.serve((req) => app.fetch(req));
