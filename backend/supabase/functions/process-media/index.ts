// =============================================================================
// Sagebook · process-media Edge Function
// -----------------------------------------------------------------------------
// Receives multimodal input (image / audio / video / pdf / text), routes it
// through Gemini 1.5 Flash, normalises the model response into a structured
// ledger payload, and persists both the raw and parsed artefacts.
// =============================================================================

import { cors } from "https://deno.land/x/hono@v4.3.11/middleware.ts";
import { Hono } from "https://deno.land/x/hono@v4.3.11/mod.ts";
import { GoogleGenAI, type Part } from "https://esm.sh/@google/genai@0.14.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { b2Configured, b2Download } from "../_shared/b2.ts";
import { commitParsedTransactions } from "../_shared/commit.ts";

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------

const SUPABASE_URL          = Deno.env.get("SUPABASE_URL")          ?? "";
const SUPABASE_ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")     ?? "";
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_KEY")  ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENROUTER_API_KEY    = Deno.env.get("OPENROUTER_API_KEY")    ?? "";
const OPENROUTER_MODEL      = Deno.env.get("OPENROUTER_MODEL")      ?? "openrouter/auto";
const GEMINI_API_KEY        = Deno.env.get("GEMINI_API_KEY")        ?? "";
const GEMINI_MODEL          = Deno.env.get("GEMINI_MODEL")          ?? "gemini-2.0-flash";

// Any OpenAI-compatible provider (DeepSeek, Qwen/DashScope, GLM, Kimi, ...).
// e.g. AI_BASE_URL=https://api.deepseek.com/v1  AI_MODEL=deepseek-chat
//      AI_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
//      AI_MODEL=qwen-vl-plus (vision-capable, very cheap)
const AI_BASE_URL = (Deno.env.get("AI_BASE_URL") ?? "").replace(/\/$/, "");
const AI_API_KEY  = Deno.env.get("AI_API_KEY")  ?? "";
const AI_MODEL    = Deno.env.get("AI_MODEL")    ?? "";
const customConfigured = !!(AI_BASE_URL && AI_API_KEY && AI_MODEL);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.warn("[process-media] Supabase env vars missing; runtime calls will fail.");
}
if (!OPENROUTER_API_KEY && !GEMINI_API_KEY && !customConfigured) {
    console.warn("[process-media] No AI provider configured; runtime calls will fail.");
}

type Provider = "custom" | "gemini" | "openrouter";

// custom + openrouter are OpenAI-compatible chat APIs: text and image only.
// Gemini accepts every media kind natively. Preference: AI_PROVIDER secret,
// otherwise custom (cheapest) → gemini → openrouter.
function pickProvider(kind: MediaKind): Provider | null {
    const textOrImage = kind === "text" || kind === "image";
    const available: Record<Provider, boolean> = {
        custom:     customConfigured && textOrImage,
        gemini:     !!GEMINI_API_KEY,
        openrouter: !!OPENROUTER_API_KEY && textOrImage,
    };
    const pref = (Deno.env.get("AI_PROVIDER") ?? "").toLowerCase() as Provider | "";
    if (pref && available[pref as Provider]) return pref as Provider;
    for (const p of ["custom", "gemini", "openrouter"] as Provider[]) {
        if (available[p]) return p;
    }
    return null;
}

const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type MediaKind = "image" | "audio" | "video" | "pdf" | "text";

interface InlineMedia {
    mimeType: string;
    /** Base64-encoded raw bytes (no data: prefix). */
    data: string;
}

interface ProcessMediaRequest {
    /** One of inlineMedia or text must be provided. */
    inlineMedia?: InlineMedia;
    text?: string;
    /** Optional storage object path (bucket/key) if the client already uploaded. */
    storagePath?: string;
    /** Free-form hint, e.g. "this is a Whole Foods receipt in EUR". */
    promptHint?: string;
    /** ISO currency code the user wants amounts normalised to (defaults to profile base). */
    baseCurrency?: string;
}

interface InferredAccount {
    name?: string;
    institution?: string;
    number_masked?: string;
}

interface ParsedTransaction {
    occurred_at: string;       // ISO datetime
    amount: number;            // positive number
    currency: string;          // ISO 4217 code
    kind: "income" | "expense" | "transfer" | "adjustment";
    payee?: string;
    memo?: string;
    category?: string;
    tags?: string[];
    /** Source account inferred from the document (bank receipts, statements). */
    account?: InferredAccount;
    /** Bank reference / session ID — a strong dedup signal. */
    reference?: string;
}

interface ParsedPayload {
    summary: string;
    transactions: ParsedTransaction[];
    confidence: number;        // 0..1
    /** Faithful transcription when the input was audio/video. */
    transcript?: string;
}

// -----------------------------------------------------------------------------
// Gemini schema & prompt
// -----------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        summary:    { type: "string" },
        confidence: { type: "number" },
        transcript: { type: "string" },
        transactions: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    occurred_at: { type: "string" },
                    amount:      { type: "number" },
                    currency:    { type: "string" },
                    kind:        {
                        type: "string",
                        enum: ["income", "expense", "transfer", "adjustment"],
                    },
                    payee:    { type: "string" },
                    memo:     { type: "string" },
                    category: { type: "string" },
                    tags:     { type: "array", items: { type: "string" } },
                    reference: { type: "string" },
                    account: {
                        type: "object",
                        properties: {
                            name:          { type: "string" },
                            institution:   { type: "string" },
                            number_masked: { type: "string" },
                        },
                    },
                },
                required: ["occurred_at", "amount", "currency", "kind"],
            },
        },
    },
    required: ["summary", "transactions", "confidence"],
} as const;

const SYSTEM_INSTRUCTION = `You are Sagebook's ledger extraction engine.
Given multimodal input (receipts, statements, screenshots, voice notes, free text)
extract every distinct financial movement.

Rules:
- Always return ISO 8601 datetimes (UTC if unknown timezone).
- 'amount' is a positive decimal. Sign is conveyed by 'kind'.
- 'currency' is an ISO 4217 three-letter code; infer from symbols / locale cues.
- 'kind' must be one of: income, expense, transfer, adjustment.
- 'category' must be chosen from the user's category list when one is provided;
  pick the most specific match (e.g. prefer 'Land Purchase' over 'Real Estate
  Investment' for a land receipt) and return only the category name itself,
  never the group or parent prefix. Only invent a new category name if nothing
  in the list plausibly fits.
- 'confidence' reflects overall extraction certainty (0..1).
- Infer the SOURCE account when the document reveals it (bank receipts show the
  debit account holder, bank name, and a masked number): return it as
  'account': { name, institution, number_masked }. If a "user's accounts" list
  is provided and one clearly matches, use that account's name EXACTLY as
  listed; otherwise report the details as printed so a new account can be
  proposed. The payee/beneficiary is never the source account.
- Return 'reference' when the document shows a reference / session / receipt ID
  (used for duplicate detection).
- Narration/description lines go into 'memo' verbatim.
- For audio or video input, also return 'transcript': a faithful transcription
  of the speech (the user reviews it next to the extracted transactions).
  Omit 'transcript' for images, PDFs, and plain text.
- If nothing extractable, return an empty transactions array with a short summary.`;

/** Renders the user's custom taxonomy as a prompt hint, grouped for readability. */
function buildCategoryHint(
    cats: Array<{ name: string; parent?: { name: string } | null; group?: { name: string } | null }>,
): string | null {
    if (!cats.length) return null;
    const byGroup = new Map<string, string[]>();
    for (const c of cats) {
        const group = c.group?.name ?? "Other";
        const label = c.parent ? `${c.parent.name} > ${c.name}` : c.name;
        if (!byGroup.has(group)) byGroup.set(group, []);
        byGroup.get(group)!.push(label);
    }
    const lines = [...byGroup.entries()]
        .map(([group, names]) => `- ${group}: ${names.join(", ")}`);
    return `User's category list (grouped):\n${lines.join("\n")}`;
}

/** Cap for inlining storage objects into a model request (base64 overhead ~33%). */
const MAX_STORAGE_BYTES = 15 * 1024 * 1024;

const EXT_MIME: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", heic: "image/heic",
    webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4", mov: "video/quicktime",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
};

function inferMimeFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return EXT_MIME[ext] ?? "application/octet-stream";
}

function base64FromArrayBuffer(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000; // avoid arg-count limits in String.fromCharCode
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function detectMediaKind(mimeType: string): MediaKind {
    if (mimeType.startsWith("image/"))            return "image";
    if (mimeType.startsWith("audio/"))            return "audio";
    if (mimeType.startsWith("video/"))            return "video";
    if (mimeType === "application/pdf")           return "pdf";
    return "text";
}

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
    custom: customConfigured,
    customModel: customConfigured ? AI_MODEL : null,
    gemini: !!GEMINI_API_KEY,
    openrouter: !!OPENROUTER_API_KEY,
    b2: b2Configured(),
    textImageProvider: pickProvider("text"),
    audioPdfProvider: pickProvider("audio"),
}));

app.post("/process-media", async (c) => {
    const authHeader = c.req.header("authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return c.json({ error: "missing bearer token" }, 401);
    }

    // User-scoped client (honours RLS, identifies the caller).
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
        auth:   { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
        return c.json({ error: "invalid session" }, 401);
    }
    const userId = userData.user.id;

    // Service-role client for trusted writes (ingestion + transactions linkage).
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
    // "b2:{userId}/..." → Backblaze (via storage-proxy uploads); a plain
    // "{userId}/..." key → the Supabase 'ingest' bucket (legacy/fallback).
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
    const provider = pickProvider(mediaKind);
    const selectedModel =
        provider === "custom"     ? AI_MODEL :
        provider === "openrouter" ? OPENROUTER_MODEL :
        GEMINI_MODEL;

    if (!provider) {
        return c.json({
            error: "no compatible AI provider configured",
            detail: mediaKind === "text" || mediaKind === "image"
                ? "Set AI_BASE_URL + AI_API_KEY + AI_MODEL (any OpenAI-compatible provider, e.g. DeepSeek/Qwen), GEMINI_API_KEY, or OPENROUTER_API_KEY."
                : `${mediaKind} input needs GEMINI_API_KEY (OpenAI-compatible providers only take text and images).`,
            provider: null,
            model: null,
        }, 503);
    }

    // 0) Load the user's taxonomy and accounts so the model classifies into
    //    their categories and matches known accounts instead of proposing dupes.
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
        const catById   = new Map((cats ?? []).map((c) => [c.id, c]));
        const groupById = new Map((groups ?? []).map((g) => [g.id, g]));
        categoryHint = buildCategoryHint((cats ?? []).map((c) => ({
            name:   c.name,
            parent: c.parent_id ? catById.get(c.parent_id) ?? null : null,
            group:  c.group_id  ? groupById.get(c.group_id) ?? null : null,
        })));
        if (accounts?.length) {
            const lines = accounts.map((a) =>
                `- ${a.name}${a.institution ? ` (${a.institution})` : ""} [${a.type}]`);
            categoryHint = `${categoryHint ?? ""}\n\nUser's accounts:\n${lines.join("\n")}`;
        }
    } catch (err) {
        console.warn("[process-media] context hint fetch failed", err);
    }

    // 1) Record the ingestion as pending.
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
            detail: ingErr?.message ?? JSON.stringify(ingErr) ?? String(ingErr),
            ingestion: ingestion ?? null,
            provider,
            model: selectedModel,
        }, 500);
    }

    // 2) Call model provider.
    try {
        const raw = provider === "gemini"
            ? await extractWithGemini(body, categoryHint)
            : await extractWithOpenAICompat(
                provider === "custom"
                    ? { baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL, schemaMode: "json_object" }
                    : { baseUrl: "https://openrouter.ai/api/v1", apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL, schemaMode: "json_schema" },
                body,
                categoryHint,
            );
        const parsed = safeParse<ParsedPayload>(raw);

        if (!parsed) {
            await admin.from("media_ingestions").update({
                status:       "failed",
                raw_response: { text: raw },
                error:        "model returned non-JSON payload",
            }).eq("id", ingestion.id);
            return c.json({
                error: "model returned non-JSON",
                ingestionId: ingestion.id,
                provider,
                model: selectedModel,
            }, 502);
        }

        await admin.from("media_ingestions").update({
            status:         "parsed",
            raw_response:   { text: raw },
            parsed_payload: parsed,
        }).eq("id", ingestion.id);

        // Auto-commit extracted transactions to the inbox
        const commitResult = await commitParsedTransactions(
            admin, userId, ingestion.id, parsed.transactions ?? []);

        return c.json({
            ingestionId: ingestion.id,
            provider,
            model: selectedModel,
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

function safeParse<T>(text: string): T | null {
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
        // Gemini occasionally wraps JSON in markdown fences; strip and retry.
        const stripped = text
            .replace(/^\s*```(?:json)?\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .trim();
        try {
            return JSON.parse(stripped) as T;
        } catch {
            return null;
        }
    }
}

function estimateBase64Bytes(b64: string): number {
    const len = b64.length;
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.floor((len * 3) / 4) - pad;
}

async function extractWithGemini(body: ProcessMediaRequest, categoryHint?: string | null): Promise<string> {
    if (!genai) throw new Error("GEMINI_API_KEY is not configured");

    const parts: Part[] = [];
    if (categoryHint) {
        parts.push({ text: categoryHint });
    }
    if (body.promptHint) {
        parts.push({ text: `User hint: ${body.promptHint}` });
    }
    if (body.baseCurrency) {
        parts.push({ text: `User base currency: ${body.baseCurrency}` });
    }
    if (body.inlineMedia) {
        parts.push({
            inlineData: {
                mimeType: body.inlineMedia.mimeType,
                data:     body.inlineMedia.data,
            },
        });
    }
    if (body.text) {
        parts.push({ text: body.text });
    }

    const response = await genai.models.generateContent({
        model:    GEMINI_MODEL,
        contents: [{ role: "user", parts }],
        config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType:  "application/json",
            responseSchema:    RESPONSE_SCHEMA as unknown as Record<string, unknown>,
            temperature:       0.1,
        },
    });

    return response.text ?? "";
}

interface OpenAICompatConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    /**
     * "json_schema": strict structured output (OpenRouter/OpenAI).
     * "json_object": plain JSON mode with the schema embedded in the prompt —
     * what DeepSeek / Qwen / GLM compatible endpoints support.
     */
    schemaMode: "json_schema" | "json_object";
}

async function extractWithOpenAICompat(
    cfg: OpenAICompatConfig,
    body: ProcessMediaRequest,
    categoryHint?: string | null,
): Promise<string> {
    const content: Array<Record<string, unknown>> = [];

    if (categoryHint) {
        content.push({ type: "text", text: categoryHint });
    }
    if (body.promptHint) {
        content.push({ type: "text", text: `User hint: ${body.promptHint}` });
    }
    if (body.baseCurrency) {
        content.push({ type: "text", text: `User base currency: ${body.baseCurrency}` });
    }
    if (body.text) {
        content.push({ type: "text", text: body.text });
    }
    if (body.inlineMedia) {
        if (body.inlineMedia.mimeType.startsWith("image/")) {
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:${body.inlineMedia.mimeType};base64,${body.inlineMedia.data}`,
                },
            });
        } else {
            content.push({
                type: "text",
                text: `Non-image media (${body.inlineMedia.mimeType}) supplied. Use Gemini for best extraction from audio/video/pdf.`,
            });
        }
    }

    if (!content.length) {
        throw new Error("no usable input for the OpenAI-compatible provider");
    }

    const systemPrompt = cfg.schemaMode === "json_object"
        ? `${SYSTEM_INSTRUCTION}\n\nRespond with a single JSON object (no markdown fences) that conforms to this JSON Schema:\n${JSON.stringify(RESPONSE_SCHEMA)}`
        : SYSTEM_INSTRUCTION;

    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${cfg.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: cfg.model,
            temperature: 0.1,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content },
            ],
            response_format: cfg.schemaMode === "json_schema"
                ? {
                    type: "json_schema",
                    json_schema: {
                        name: "sagebook_ledger_payload",
                        strict: true,
                        schema: RESPONSE_SCHEMA,
                    },
                }
                : { type: "json_object" },
        }),
    });

    const bodyText = await response.text();
    if (!response.ok) {
        throw new Error(`got status: ${response.status} ${response.statusText}. ${bodyText}`);
    }

    const payload = safeParse<{ choices?: Array<{ message?: { content?: unknown } }> }>(bodyText);
    const raw = payload?.choices?.[0]?.message?.content;
    if (typeof raw === "string") {
        return raw;
    }

    if (Array.isArray(raw)) {
        const text = raw
            .map((part) => {
                if (typeof part === "string") return part;
                if (typeof part === "object" && part !== null && "text" in part) {
                    const maybe = (part as { text?: unknown }).text;
                    return typeof maybe === "string" ? maybe : "";
                }
                return "";
            })
            .join("\n")
            .trim();
        if (text) return text;
    }

    throw new Error(`${cfg.baseUrl} response missing message content`);
}

function inferUpstreamStatus(message: string): 429 | 502 | 500 {
    if (/\b429\b|RESOURCE_EXHAUSTED|Too Many Requests/i.test(message)) {
        return 429;
    }
    if (/\b404\b|NOT_FOUND/i.test(message)) {
        return 502;
    }
    return 500;
}

// -----------------------------------------------------------------------------
// Deno serve hook
// -----------------------------------------------------------------------------

Deno.serve((req) => app.fetch(req));
