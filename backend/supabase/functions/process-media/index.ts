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

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
    console.warn("[process-media] Supabase env vars missing; runtime calls will fail.");
}
if (!OPENROUTER_API_KEY && !GEMINI_API_KEY) {
    console.warn("[process-media] No AI provider key set; runtime calls will fail.");
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

interface ParsedTransaction {
    occurred_at: string;       // ISO datetime
    amount: number;            // positive number
    currency: string;          // ISO 4217 code
    kind: "income" | "expense" | "transfer" | "adjustment";
    payee?: string;
    memo?: string;
    category?: string;
    tags?: string[];
}

interface ParsedPayload {
    summary: string;
    transactions: ParsedTransaction[];
    confidence: number;        // 0..1
}

// -----------------------------------------------------------------------------
// Gemini schema & prompt
// -----------------------------------------------------------------------------

const RESPONSE_SCHEMA = {
    type: "object",
    properties: {
        summary:    { type: "string" },
        confidence: { type: "number" },
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
- 'confidence' reflects overall extraction certainty (0..1).
- If nothing extractable, return an empty transactions array with a short summary.`;

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
    openrouter: !!OPENROUTER_API_KEY,
    gemini: !!GEMINI_API_KEY,
    defaultModel: OPENROUTER_API_KEY ? OPENROUTER_MODEL : GEMINI_MODEL,
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

    if (!body.inlineMedia && !body.text) {
        return c.json({ error: "inlineMedia or text required" }, 400);
    }

    const mimeType  = body.inlineMedia?.mimeType ?? "text/plain";
    const mediaKind = detectMediaKind(mimeType);
    const bytes     = body.inlineMedia ? estimateBase64Bytes(body.inlineMedia.data) : (body.text?.length ?? 0);
    const useOpenRouter = !!OPENROUTER_API_KEY && (mediaKind === "text" || mediaKind === "image");
    const provider = useOpenRouter ? "openrouter" : "gemini";
    const selectedModel = useOpenRouter ? OPENROUTER_MODEL : GEMINI_MODEL;

    if (!useOpenRouter && !GEMINI_API_KEY) {
        return c.json({
            error: "no compatible AI provider configured",
            detail: "Set GEMINI_API_KEY for audio/video/pdf or send text/image with OPENROUTER_API_KEY.",
            provider,
            model: selectedModel,
        }, 503);
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
        const raw = useOpenRouter
            ? await extractWithOpenRouter(body)
            : await extractWithGemini(body);
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

        return c.json({
            ingestionId: ingestion.id,
            provider,
            model: selectedModel,
            parsed,
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

async function extractWithGemini(body: ProcessMediaRequest): Promise<string> {
    if (!genai) throw new Error("GEMINI_API_KEY is not configured");

    const parts: Part[] = [];
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

async function extractWithOpenRouter(body: ProcessMediaRequest): Promise<string> {
    const content: Array<Record<string, unknown>> = [];

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
        throw new Error("no usable input for OpenRouter");
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            temperature: 0.1,
            messages: [
                { role: "system", content: SYSTEM_INSTRUCTION },
                { role: "user", content },
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "sagebook_ledger_payload",
                    strict: true,
                    schema: RESPONSE_SCHEMA,
                },
            },
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

    throw new Error("OpenRouter response missing message content");
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
