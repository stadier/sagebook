# Sagebook Ingestion Pipelines — Design

Every pipeline ends at the same place: a `media_ingestions` row + AI extraction +
rule application + dedup + `transactions` rows in `pending_review`. That funnel
already exists (`process-media` → `commitIngestionInline`). This document defines the
*entry points* that feed it.

```
 typed text ─┐
 voice note ─┤
 receipt 📷 ─┤                                   ┌─ rules engine
 PDF/stmt  ─┼→ media_ingestions → AI extraction ─┼─ dedup (find_duplicate)
 email ✉️  ─┤        (Gemini / OpenRouter)       └─ category mapping
 CSV/OFX   ─┤                                            │
 SMS/push  ─┘                                            ▼
                                          transactions (pending_review) → Inbox
```

Design rule: **new pipelines add adapters, not new funnels.** Each adapter converts
its source into a `process-media` call (or, for structured data like CSV, skips the AI
and inserts parsed rows through the same commit path).

---

## 1. Typed natural language — ✅ working today

`process-media` with `{ text }`. Already handles "spent $40 on groceries at Aldi".

**Improvements:**
- **Relative-date anchoring.** "yesterday", "last Friday" resolve against *now* in the
  model's head, which is unreliable. Send `clientTime` + timezone with every request
  and inject it into the prompt ("Current user datetime: …").
- **Multi-transaction utterances.** Already supported by the schema (array), but add
  prompt examples: "paid 2m for the land and 150k to the surveyor" → two rows.
- **Chat-style capture (later):** a conversational refinement loop — model asks one
  clarifying question ("which account did you pay from?") before committing.

## 2. Voice — typed by microphone, or recorded audio files — ✅ backend ready, needs UI

Gemini accepts audio natively, and `process-media` already routes `audio/*` to Gemini.
What's missing is capture surfaces:

- **Web app recorder:** MediaRecorder → `audio/webm` blob → base64 `inlineMedia`.
  Press-and-hold UX; show the extraction transcript for confirmation.
- **Uploaded recordings:** longer files (meeting where a deal was discussed, voice
  memos from the field). These exceed the ~4–5 MB comfortable base64 inline limit →
  needs the Storage-upload path (§5).
- **Speaker context:** pass `promptHint` like "voice note recorded 2026-07-06, user's
  base currency NGN" automatically.
- **Store transcript:** persist the model's transcription into
  `media_ingestions.parsed_payload.transcript` so review shows *what was heard* next
  to *what was extracted* (add `transcript` to the response schema).

## 3. Email ingestion — ✉️ new pipeline

Receipts, bank alerts, invoices, and broker statements mostly arrive by email. Two
phases:

**Phase 1 — forwarding address (recommended first).**
1. Each user gets `u-<shortid>@in.sagebook.app` (store the alias in `profiles`).
2. An inbound-email service (Postmark Inbound, SendGrid Inbound Parse, or Cloudflare
   Email Workers) POSTs the parsed MIME to a new edge function `ingest-email`.
3. `ingest-email`: verify provider signature → resolve alias → user_id → create one
   `media_ingestions` row per relevant part (HTML/text body as `text`, each
   PDF/image attachment as its own ingestion) → run the same extraction + commit.
4. Sender allow-list per user (first email from a new sender requires confirming in
   the app) so third parties can't inject transactions into someone's ledger.

**Phase 2 — mailbox connection (later).** Gmail/Outlook OAuth + label watch, so
nothing needs forwarding. Higher effort (token refresh, webhooks/polling, scopes) —
do it only once phase 1 proves the extraction quality.

Schema addition: `media_ingestions.source` enum (`app`, `email`, `api`, `import`,
`sms`) + `source_ref` (e.g. Message-ID) for traceability and email-specific dedup.

## 4. Bank statements & structured files — CSV / OFX / XLSX

Statements are *structured*; sending them through the LLM row-by-row is wasteful and
error-prone for 200-row files. Split the path:

- **CSV/OFX/QIF:** parse deterministically in a new `ingest-file` function (or
  client-side). Column mapping UI ("this column is the date, format DD/MM/YYYY"),
  saved per institution as an import template. Rows go straight into the commit path
  (rules + dedup still apply — dedup matters most here because statement imports
  overlap with already-captured receipts).
- **PDF statements:** stay on the AI path (Gemini handles PDF), but chunk long
  statements page-by-page and reconcile totals ("sum of extracted rows must match the
  statement's closing balance delta"; flag mismatches in review).
- **XLSX:** convert to CSV client-side (SheetJS) then the CSV path.

## 5. Large media — Storage upload path

`inlineMedia` base64 breaks down past a few MB (audio recordings, multi-page scans,
video). The `storagePath` request field and DB column already exist but nothing uses
them:

1. Client uploads to Storage bucket `ingest/` at `{user_id}/{uuid}.{ext}` (private
   bucket, owner-only RLS storage policy).
2. Calls `process-media` with `{ storagePath }` only.
3. Function downloads via service role and either inlines to Gemini (small) or uses
   the Gemini Files API (large audio/video).
4. Keep the object — it becomes the receipt archive shown in transaction detail.

## 6. SMS / bank push alerts (regional, high value in NG context)

Bank debit-alert SMS are the closest thing to real-time bank sync in markets without
Plaid coverage. Options, in increasing effort:
- **Paste/share:** user shares the SMS text into the PWA share target → text pipeline
  (works day one, zero build beyond PWA `share_target`).
- **Android companion / automation:** an automation app (Tasker/MacroDroid) or a tiny
  companion app forwards matching SMS to an authenticated `ingest-api` endpoint.
- Alert texts are highly templated → add per-bank regex rules *before* the LLM, fall
  back to LLM for unknown formats.

## 7. Direct API / automations

A thin authenticated `ingest-api` endpoint (same shape as `process-media`) enables
Shortcuts (iOS), Tasker, Zapier/Make, and future integrations. Use per-device API
tokens (new `api_tokens` table, hashed) rather than user JWTs so a leaked automation
token can be revoked alone.

## 8. Bank aggregators (later)

Where available: Mono/Okra (NG), Plaid (US/EU), TrueLayer (UK/EU), or GoCardless
open-banking. These produce *structured* transactions → CSV-style commit path with
`source: 'api'`. Big lift (webhooks, re-auth, per-provider quirks); postpone until
manual + email + import pipelines are polished.

---

## Cross-cutting requirements

1. **Provenance everywhere.** Every transaction already links `ingestion_id`; add
   `source`/`source_ref` (§3) so users can always answer "where did this number come
   from?" and see the original artifact.
2. **Dedup is the keystone.** The same purchase can arrive as receipt photo + SMS
   alert + statement row. `find_duplicate` (amount ±0.01, ±3 days, payee match) is a
   good start; improve with (a) cross-source confidence — different sources with same
   amount/date are *more* likely dupes, (b) reference-number matching when extractions
   include one, (c) a "merge duplicates" review action rather than only flagging.
3. **Async processing.** Email and large-file ingestion shouldn't block a request
   cycle. Insert `media_ingestions` as `pending`, process via a queue (pg_cron +
   `status='pending'` poller, or Supabase Queues), and let the inbox update via
   Realtime.
4. **Rate limits & quotas.** Per-user ingestion caps (e.g. 100/day) to bound AI spend;
   `429` from providers is already surfaced (`inferUpstreamStatus`) — add retry with
   backoff in the async worker.
5. **Currency & locale hints.** All adapters should pass the user's `base_currency`
   and locale; NGN receipts with "₦2.5m" shorthand need locale-aware prompting.
