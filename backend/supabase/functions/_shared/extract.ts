// =============================================================================
// Sagebook · Shared AI extraction pipeline
// -----------------------------------------------------------------------------
// Gemini / OpenAI-compatible extraction logic shared by process-media and
// ingest-email. Moved here so both entry points stay in sync.
// =============================================================================

import { GoogleGenAI, type Part } from "https://esm.sh/@google/genai@0.14.0";

// -----------------------------------------------------------------------------
// Environment
// -----------------------------------------------------------------------------

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") ?? "";
const OPENROUTER_MODEL   = Deno.env.get("OPENROUTER_MODEL")   ?? "openrouter/auto";
const GEMINI_API_KEY     = Deno.env.get("GEMINI_API_KEY")      ?? "";
const GEMINI_MODEL       = Deno.env.get("GEMINI_MODEL")        ?? "gemini-2.0-flash";

const AI_BASE_URL = (Deno.env.get("AI_BASE_URL") ?? "").replace(/\/$/, "");
const AI_API_KEY  = Deno.env.get("AI_API_KEY")  ?? "";
const AI_MODEL    = Deno.env.get("AI_MODEL")    ?? "";
const customConfigured = !!(AI_BASE_URL && AI_API_KEY && AI_MODEL);

const CUSTOM_PDF_OK = AI_BASE_URL.includes("mistral");

const genai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type MediaKind = "image" | "audio" | "video" | "pdf" | "text";
export type Provider = "custom" | "gemini" | "openrouter";

export interface InlineMedia {
    mimeType: string;
    data: string;
}

export interface ExtractionInput {
    inlineMedia?: InlineMedia;
    text?: string;
    promptHint?: string;
    baseCurrency?: string;
}

export interface InferredAccount {
    name?: string;
    institution?: string;
    number_masked?: string;
    reason?: string;
}

export interface LineItem {
    description: string;
    quantity?: number;
    amount?: number;
}

export interface ParsedTransaction {
    occurred_at: string;
    amount: number;
    currency: string;
    kind: "income" | "expense" | "transfer" | "adjustment";
    payee?: string;
    memo?: string;
    category?: string;
    category_reason?: string;
    tags?: string[];
    account?: InferredAccount;
    reference?: string;
    line_items?: LineItem[];
}

export interface ParsedPayload {
    summary: string;
    transactions: ParsedTransaction[];
    confidence: number;
    transcript?: string;
}

// -----------------------------------------------------------------------------
// Schema & prompt
// -----------------------------------------------------------------------------

export const RESPONSE_SCHEMA = {
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
                    payee:           { type: "string" },
                    memo:            { type: "string" },
                    category:        { type: "string" },
                    category_reason: { type: "string" },
                    tags:            { type: "array", items: { type: "string" } },
                    reference: { type: "string" },
                    account: {
                        type: "object",
                        properties: {
                            name:          { type: "string" },
                            institution:   { type: "string" },
                            number_masked: { type: "string" },
                            reason:        { type: "string" },
                        },
                    },
                    line_items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                description: { type: "string" },
                                quantity:    { type: "number" },
                                amount:      { type: "number" },
                            },
                            required: ["description"],
                        },
                    },
                },
                required: ["occurred_at", "amount", "currency", "kind"],
            },
        },
    },
    required: ["summary", "transactions", "confidence"],
} as const;

export const SYSTEM_INSTRUCTION = `You are Sagebook's ledger extraction engine.
Given multimodal input (receipts, statements, screenshots, voice notes, free text)
extract every distinct financial movement.

Rules:
- An itemized retail/store receipt or invoice is ONE transaction: the final
  amount actually paid, after discounts and promos. NEVER emit one transaction
  per purchased item. Put the purchased items into 'line_items'
  [{description, quantity, amount}], the store name into 'payee', and choose
  the category from what was bought (e.g. a supermarket receipt → Groceries).
  Discount / promo / "you saved" lines are not transactions.
- Bank statements and transaction lists are the opposite: each listed
  movement IS its own transaction.
- Always return ISO 8601 datetimes (UTC if unknown timezone).
- 'amount' is a positive decimal. Sign is conveyed by 'kind'.
- 'currency' is an ISO 4217 three-letter code; infer from symbols / locale cues.
- 'kind' must be one of: income, expense, transfer, adjustment.
- 'category' must be chosen from the user's category list when one is provided;
  pick the most specific match (e.g. prefer 'Land Purchase' over 'Real Estate
  Investment' for a land receipt) and return only the category name itself,
  never the group or parent prefix. Only invent a new category name if nothing
  in the list plausibly fits. Whenever you set 'category', ALSO set
  'category_reason': one short sentence (<=140 chars) naming the cue you used
  (e.g. "Receipt is a prepaid electricity token purchase → Utilities."). Do not
  fabricate a reason — describe what you actually saw.
- 'confidence' reflects overall extraction certainty (0..1).
- Infer the SOURCE account when the document reveals it (bank receipts show the
  debit account holder, bank name, and a masked number): return it as
  'account': { name, institution, number_masked, reason }. If a "user's accounts"
  list is provided and one clearly matches, use that account's name EXACTLY as
  listed; otherwise report the details as printed so a new account can be
  proposed. The payee/beneficiary is never the source account. Lean toward
  making a proposal even when unsure — the user can rename, relink, or dismiss
  it. Whenever you return an 'account', ALSO set 'account.reason': one short
  sentence (<=140 chars) naming the specific cue you used, so the guess is
  auditable. Examples: "Matched 'Estate' in the receipt address to your 'Vycount
  Estates' account." / "No funding account printed on the receipt; proposed from
  the biller's customer account name." Do not fabricate a reason — describe what
  you actually saw.
- Return 'reference' when the document shows a reference / session / receipt ID
  (used for duplicate detection).
- Narration/description lines go into 'memo' verbatim.
- For audio or video input, also return 'transcript': a faithful transcription
  of the speech (the user reviews it next to the extracted transactions).
  Omit 'transcript' for images, PDFs, and plain text.
- If nothing extractable, return an empty transactions array with a short summary.`;

// -----------------------------------------------------------------------------
// Provider selection
// -----------------------------------------------------------------------------

export function pickProvider(kind: MediaKind): Provider | null {
    const textOrImage = kind === "text" || kind === "image";
    const available: Record<Provider, boolean> = {
        custom:     customConfigured && (textOrImage || (kind === "pdf" && CUSTOM_PDF_OK)),
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

export function selectedModelForProvider(provider: Provider): string {
    return provider === "custom"     ? AI_MODEL
         : provider === "openrouter" ? OPENROUTER_MODEL
         : GEMINI_MODEL;
}

export function providerHealthInfo() {
    return {
        custom: customConfigured,
        customModel: customConfigured ? AI_MODEL : null,
        gemini: !!GEMINI_API_KEY,
        openrouter: !!OPENROUTER_API_KEY,
        textImageProvider: pickProvider("text"),
        audioPdfProvider: pickProvider("audio"),
    };
}

// -----------------------------------------------------------------------------
// Category/account hint builder
// -----------------------------------------------------------------------------

export function buildCategoryHint(
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

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

export function safeParse<T>(text: string): T | null {
    if (!text) return null;
    try {
        return JSON.parse(text) as T;
    } catch {
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

export function detectMediaKind(mimeType: string): MediaKind {
    if (mimeType.startsWith("image/"))  return "image";
    if (mimeType.startsWith("audio/"))  return "audio";
    if (mimeType.startsWith("video/"))  return "video";
    if (mimeType === "application/pdf") return "pdf";
    return "text";
}

export function base64FromArrayBuffer(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

export function estimateBase64Bytes(b64: string): number {
    const len = b64.length;
    const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
    return Math.floor((len * 3) / 4) - pad;
}

export const EXT_MIME: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
    gif: "image/gif", heic: "image/heic",
    webm: "audio/webm", ogg: "audio/ogg", m4a: "audio/mp4", mp3: "audio/mpeg",
    wav: "audio/wav",
    mp4: "video/mp4", mov: "video/quicktime",
    pdf: "application/pdf", txt: "text/plain", csv: "text/csv",
};

export function inferMimeFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    return EXT_MIME[ext] ?? "application/octet-stream";
}

// -----------------------------------------------------------------------------
// Extraction: Gemini
// -----------------------------------------------------------------------------

export async function extractWithGemini(
    input: ExtractionInput,
    categoryHint?: string | null,
): Promise<string> {
    if (!genai) throw new Error("GEMINI_API_KEY is not configured");

    const parts: Part[] = [];
    if (categoryHint)      parts.push({ text: categoryHint });
    if (input.promptHint)  parts.push({ text: `User hint: ${input.promptHint}` });
    if (input.baseCurrency) parts.push({ text: `User base currency: ${input.baseCurrency}` });
    if (input.inlineMedia) {
        parts.push({
            inlineData: {
                mimeType: input.inlineMedia.mimeType,
                data:     input.inlineMedia.data,
            },
        });
    }
    if (input.text) parts.push({ text: input.text });

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

// -----------------------------------------------------------------------------
// Extraction: OpenAI-compatible (custom / OpenRouter)
// -----------------------------------------------------------------------------

export interface OpenAICompatConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    schemaMode: "json_schema" | "json_object";
    allowDocumentUrl?: boolean;
}

export function openAIConfigForProvider(provider: Provider): OpenAICompatConfig | null {
    if (provider === "gemini") return null;
    return provider === "custom"
        ? { baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL, schemaMode: "json_object", allowDocumentUrl: CUSTOM_PDF_OK }
        : { baseUrl: "https://openrouter.ai/api/v1", apiKey: OPENROUTER_API_KEY, model: OPENROUTER_MODEL, schemaMode: "json_schema" };
}

export async function extractWithOpenAICompat(
    cfg: OpenAICompatConfig,
    input: ExtractionInput,
    categoryHint?: string | null,
): Promise<string> {
    const content: Array<Record<string, unknown>> = [];

    if (categoryHint)       content.push({ type: "text", text: categoryHint });
    if (input.promptHint)   content.push({ type: "text", text: `User hint: ${input.promptHint}` });
    if (input.baseCurrency) content.push({ type: "text", text: `User base currency: ${input.baseCurrency}` });
    if (input.text)         content.push({ type: "text", text: input.text });
    if (input.inlineMedia) {
        if (input.inlineMedia.mimeType.startsWith("image/")) {
            content.push({
                type: "image_url",
                image_url: {
                    url: `data:${input.inlineMedia.mimeType};base64,${input.inlineMedia.data}`,
                },
            });
        } else if (input.inlineMedia.mimeType === "application/pdf" && cfg.allowDocumentUrl) {
            content.push({
                type: "document_url",
                document_url: `data:application/pdf;base64,${input.inlineMedia.data}`,
            });
        } else {
            content.push({
                type: "text",
                text: `Non-image media (${input.inlineMedia.mimeType}) supplied. Use Gemini for best extraction from audio/video/pdf.`,
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
    if (typeof raw === "string") return raw;

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

// -----------------------------------------------------------------------------
// High-level extract helper (picks provider, calls the right function)
// -----------------------------------------------------------------------------

export async function extractTransactions(
    input: ExtractionInput,
    mediaKind: MediaKind,
    categoryHint?: string | null,
): Promise<{ raw: string; provider: Provider; model: string }> {
    const provider = pickProvider(mediaKind);
    if (!provider) {
        throw new Error(
            mediaKind === "text" || mediaKind === "image"
                ? "No compatible AI provider configured. Set AI_BASE_URL + AI_API_KEY + AI_MODEL, GEMINI_API_KEY, or OPENROUTER_API_KEY."
                : `${mediaKind} input needs GEMINI_API_KEY (OpenAI-compatible providers only take text and images).`,
        );
    }
    const model = selectedModelForProvider(provider);

    const raw = provider === "gemini"
        ? await extractWithGemini(input, categoryHint)
        : await extractWithOpenAICompat(openAIConfigForProvider(provider)!, input, categoryHint);

    return { raw, provider, model };
}
