// =============================================================================
// Sagebook · ingest-email Edge Function
// -----------------------------------------------------------------------------
// Receives forwarded emails via webhook (from Cloudflare Email Workers or
// similar), identifies the user by their unique ingest slug, extracts
// transactions via the shared AI pipeline, and commits them to the inbox.
// =============================================================================

import { b2Configured, b2Upload } from "../_shared/b2.ts";
import { commitParsedTransactions } from "../_shared/commit.ts";
import { loadUserContextHint } from "../_shared/context.ts";
import { INGEST_WEBHOOK_SECRET } from "../_shared/env.ts";
import { adminClient, createApp, errorMessage, readJson, serve } from "../_shared/http.ts";
import {
    type ExtractionInput,
    type ParsedPayload,
    detectMediaKind,
    estimateBase64Bytes,
    extractTransactions,
    safeParse,
} from "../_shared/extract.ts";

if (!INGEST_WEBHOOK_SECRET) {
    console.warn("[ingest-email] INGEST_WEBHOOK_SECRET not set; all requests will be rejected.");
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface EmailAttachment {
    filename: string;
    mimeType: string;
    /** Base64-encoded content. */
    data: string;
}

interface InboundEmailPayload {
    from: string;
    to: string;
    subject?: string;
    bodyText?: string;
    bodyHtml?: string;
    headers?: Record<string, string>;
    attachments?: EmailAttachment[];
}

// -----------------------------------------------------------------------------
// HTTP app
// -----------------------------------------------------------------------------

const app = createApp("ingest-email", {
    allowHeaders: ["x-webhook-secret"],
    health: () => ({ b2: b2Configured() }),
});

app.post("/ingest-email", async (c) => {
    // Authenticated by a shared webhook secret, not a user JWT — the sender is
    // a mail worker, and the user is identified from the "to" slug below.
    const secret = c.req.header("x-webhook-secret") ?? "";
    if (!INGEST_WEBHOOK_SECRET || secret !== INGEST_WEBHOOK_SECRET) {
        return c.json({ error: "unauthorized" }, 401);
    }

    const admin = adminClient();

    const parsed = await readJson<InboundEmailPayload>(c);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    if (!body.to || !body.from) {
        return c.json({ error: "from and to are required" }, 400);
    }

    // --- Identify user by slug in the "to" address ---
    const slug = extractSlug(body.to);
    if (!slug) {
        return c.json({ error: "could not parse slug from to address" }, 400);
    }

    const { data: ingestAddr } = await admin
        .from("ingest_addresses")
        .select("user_id, is_active")
        .eq("slug", slug)
        .single();

    if (!ingestAddr) {
        return c.json({ error: "unknown ingest address" }, 404);
    }
    if (!ingestAddr.is_active) {
        return c.json({ error: "ingest address is deactivated" }, 403);
    }

    const userId: string = ingestAddr.user_id;

    // --- Insert raw email record ---
    const { data: emailRecord, error: emailErr } = await admin
        .from("ingest_emails")
        .insert({
            user_id:      userId,
            from_address: body.from,
            subject:      body.subject ?? null,
            body_text:    body.bodyText ?? null,
            body_html:    body.bodyHtml ?? null,
            raw_headers:  body.headers ?? {},
            status:       "received",
        })
        .select("id")
        .single();

    if (emailErr || !emailRecord) {
        console.error("[ingest-email] email record insert failed", emailErr);
        return c.json({ error: "could not store email", detail: emailErr?.message }, 500);
    }

    // --- Upload attachments to B2 ---
    const attachmentPaths: string[] = [];
    const attachmentMedia: Array<{ mimeType: string; data: string }> = [];

    if (body.attachments?.length && b2Configured()) {
        for (const att of body.attachments) {
            try {
                const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
                const storagePath = `${userId}/${crypto.randomUUID()}-${safeName}`;
                const bytes = Uint8Array.from(atob(att.data), (ch) => ch.charCodeAt(0));
                await b2Upload(storagePath, bytes, att.mimeType);
                attachmentPaths.push(`b2:${storagePath}`);
                attachmentMedia.push({ mimeType: att.mimeType, data: att.data });
            } catch (err) {
                console.warn("[ingest-email] attachment upload failed", att.filename, err);
            }
        }

        if (attachmentPaths.length) {
            await admin
                .from("ingest_emails")
                .update({ attachment_paths: attachmentPaths })
                .eq("id", emailRecord.id);
        }
    }

    // --- Update status to processing ---
    await admin
        .from("ingest_emails")
        .update({ status: "processing" })
        .eq("id", emailRecord.id);

    // --- Determine what to extract from ---
    // Priority: PDF/image attachments first (most structured), then email body text.
    // If multiple attachments, process each separately then combine results.
    const hasExtractableAttachments = attachmentMedia.some((a) =>
        a.mimeType.startsWith("image/") || a.mimeType === "application/pdf");

    // Build the email text context (always included as a hint)
    const emailText = [
        body.subject ? `Subject: ${body.subject}` : "",
        body.bodyText ?? "",
    ].filter(Boolean).join("\n\n");

    // --- Load user context (taxonomy + accounts) ---
    const categoryHint = await loadUserContextHint(admin, userId, "ingest-email");

    // Load user's base currency
    let baseCurrency: string | undefined;
    try {
        const { data: profile } = await admin
            .from("profiles")
            .select("base_currency")
            .eq("id", userId)
            .single();
        baseCurrency = profile?.base_currency ?? undefined;
    } catch { /* use default */ }

    // --- Create media_ingestion record ---
    const primaryKind = hasExtractableAttachments
        ? detectMediaKind(attachmentMedia.find((a) =>
            a.mimeType.startsWith("image/") || a.mimeType === "application/pdf")!.mimeType)
        : "text";

    const { data: ingestion, error: ingErr } = await admin
        .from("media_ingestions")
        .insert({
            user_id:      userId,
            media_kind:   primaryKind,
            mime_type:    hasExtractableAttachments ? "multipart/mixed" : "text/plain",
            bytes:        emailText.length + attachmentMedia.reduce((n, a) => n + estimateBase64Bytes(a.data), 0),
            status:       "processing",
            prompt_hint:  `Forwarded email from ${body.from}${body.subject ? `: ${body.subject}` : ""}`,
            model:        "email-extract",
        })
        .select("id")
        .single();

    if (ingErr || !ingestion) {
        console.error("[ingest-email] ingestion insert failed", ingErr);
        await admin
            .from("ingest_emails")
            .update({ status: "failed", error: ingErr?.message ?? "ingestion insert failed" })
            .eq("id", emailRecord.id);
        return c.json({ error: "could not create ingestion", detail: ingErr?.message }, 500);
    }

    await admin
        .from("ingest_emails")
        .update({ ingestion_id: ingestion.id })
        .eq("id", emailRecord.id);

    // --- AI extraction ---
    try {
        let input: ExtractionInput;

        if (hasExtractableAttachments) {
            // Use the first extractable attachment as primary media, email text as hint
            const primary = attachmentMedia.find((a) =>
                a.mimeType.startsWith("image/") || a.mimeType === "application/pdf")!;
            input = {
                inlineMedia: { mimeType: primary.mimeType, data: primary.data },
                text: emailText || undefined,
                promptHint: `Forwarded email from ${body.from}. Extract all transactions from this receipt/invoice.`,
                baseCurrency,
            };
        } else {
            input = {
                text: emailText,
                promptHint: `Forwarded email from ${body.from}. Extract all financial transactions mentioned.`,
                baseCurrency,
            };
        }

        const result = await extractTransactions(input, primaryKind, categoryHint);

        // Update the model field now that we know which provider was used
        await admin.from("media_ingestions")
            .update({ model: result.model })
            .eq("id", ingestion.id);

        const parsed = safeParse<ParsedPayload>(result.raw);
        if (!parsed) {
            await admin.from("media_ingestions").update({
                status:       "failed",
                raw_response: { text: result.raw },
                error:        "model returned non-JSON payload",
            }).eq("id", ingestion.id);
            await admin.from("ingest_emails")
                .update({ status: "failed", error: "extraction returned non-JSON" })
                .eq("id", emailRecord.id);
            return c.json({
                error: "extraction failed",
                emailId: emailRecord.id,
                ingestionId: ingestion.id,
            }, 502);
        }

        await admin.from("media_ingestions").update({
            status:         "parsed",
            raw_response:   { text: result.raw },
            parsed_payload: parsed,
        }).eq("id", ingestion.id);

        // Commit extracted transactions to the review inbox
        const commitResult = await commitParsedTransactions(
            admin, userId, ingestion.id, parsed.transactions ?? []);

        // Mark email as done
        await admin.from("ingest_emails")
            .update({ status: "done" })
            .eq("id", emailRecord.id);

        return c.json({
            ok: true,
            emailId:      emailRecord.id,
            ingestionId:  ingestion.id,
            provider:     result.provider,
            model:        result.model,
            summary:      parsed.summary,
            committed:    commitResult.committed,
            duplicates:   commitResult.duplicates,
            rulesApplied: commitResult.rulesApplied,
        });
    } catch (err) {
        const message = errorMessage(err);
        console.error("[ingest-email] extraction failed", message);
        await admin.from("media_ingestions").update({
            status: "failed",
            error:  message,
        }).eq("id", ingestion.id);
        await admin.from("ingest_emails")
            .update({ status: "failed", error: message })
            .eq("id", emailRecord.id);
        return c.json({
            error: "extraction failed",
            detail: message,
            emailId: emailRecord.id,
            ingestionId: ingestion.id,
        }, 500);
    }
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function extractSlug(toAddress: string): string | null {
    // Handles formats like:
    //   "slug@ingest.sagebook.app"
    //   "<slug@ingest.sagebook.app>"
    //   "Name <slug@ingest.sagebook.app>"
    const match = toAddress.match(/<?([^<@\s]+)@/);
    return match?.[1]?.toLowerCase() ?? null;
}

serve(app);
