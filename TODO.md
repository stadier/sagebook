# Sagebook — TODO / Roadmap

Each item has a short **why** so the intent survives context loss. Companion docs:
[docs/WEBAPP_DESIGN.md](docs/WEBAPP_DESIGN.md) and
[docs/INGESTION_PIPELINES.md](docs/INGESTION_PIPELINES.md).

Legend: ✅ done · 🔜 next up · 💡 idea / later

---

## 0. Done so far (baseline)

- ✅ Ledger schema: profiles, accounts, hierarchical categories, transactions,
  media_ingestions, net_worth_snapshots, currencies + fx_rates, full owner-only RLS.
- ✅ `process-media`: multimodal extraction (image/audio/video/pdf/text) via
  Gemini/OpenRouter with strict JSON schema, auto-commit into a review inbox.
- ✅ Review workflow: `pending_review → accepted/rejected`, `review-transaction`
  accept/edit/reject, `v_pending_review` view.
- ✅ Rules engine (payee/memo/kind × contains/equals/starts_with/regex → category,
  tags, memo) and duplicate detection (`find_duplicate`, duplicate groups).
- ✅ Category **groups** layer + custom investment taxonomy incl. *Real Estate
  Investment → Land Purchase / Construction / Surveying / Legal / Agent Fees /
  Property Taxes* (migration `20260706000000_category_groups.sql`).
- ✅ Extraction is now **taxonomy-aware**: the user's groups/categories are injected
  into the AI prompt so receipts land in *their* categories, not generic guesses.
- ✅ Test-shell harness + minimal dashboard (monthly & category summaries).

## 1. Web app (see WEBAPP_DESIGN.md)

- 🔜 **Scaffold `webapp/`** (Vite + React + TS + Tailwind + TanStack Query).
  *Why:* the test-shell is an API harness, not a product. Everything below needs a
  real surface.
- 🔜 **Capture screen** (text, camera/file, mic, paste) → `process-media`.
  *Why:* capture speed is the product's core promise; if logging a receipt takes
  >10 seconds, users stop doing it.
- 🔜 **Inbox review UI** (accept / edit / reject, duplicate compare, bulk actions,
  "create rule from this").
  *Why:* AI extraction is only trustworthy with a cheap human checkpoint; this is
  where trust in the ledger is built.
- 🔜 **Transactions browser** with filters and source-media preview.
  *Why:* an unqueryable ledger is a write-only diary.
- 🔜 **Categories & groups manager** (drag between groups, nest subcategories, merge).
  *Why:* the custom-taxonomy feature (e.g. real-estate) is only as good as the UI for
  shaping it.
- 💡 **PWA install + OS share-target + offline capture queue.**
  *Why:* gets a "mobile app" (share a bank SMS or receipt screenshot straight into
  Sagebook) without a second codebase.
- 💡 **Realtime inbox** (subscribe to pending_review inserts).
  *Why:* email/async ingestions should appear without refresh.

## 2. Ingestion pipelines (see INGESTION_PIPELINES.md)

- 🔜 **Voice recorder in the web app** (MediaRecorder → existing audio path).
  *Why:* backend already supports audio; only the capture surface is missing.
- 🔜 **Send client time + timezone with every ingestion.**
  *Why:* "yesterday" in a voice note currently resolves against the model's unknown
  clock — dates can silently be wrong.
- 🔜 **Storage-upload path for large media** (`storagePath` exists but is unused).
  *Why:* base64 inline breaks past a few MB — long audio recordings and multi-page
  scans need it; the stored object doubles as the receipt archive.
- 🔜 **Email forwarding pipeline** (`u-<id>@in.sagebook.app` → `ingest-email` fn).
  *Why:* most receipts/bank alerts already arrive by email; this is the highest-value
  passive pipeline. Includes per-user sender allow-list for safety.
- 🔜 **CSV/OFX statement import** with per-bank column templates (deterministic, no
  LLM per row).
  *Why:* bulk history and monthly statements; also the main dedup stress-test since
  imports overlap with captured receipts.
- 💡 **SMS/bank-alert path** via PWA share-target first, Android forwarder later.
  *Why:* in markets without bank APIs, debit-alert SMS is de-facto real-time sync.
- 💡 **`ingest-api` with per-device API tokens.**
  *Why:* unlocks Shortcuts/Tasker/Zapier without handing out user JWTs.
- 💡 **Bank aggregators** (Mono/Okra/Plaid/TrueLayer).
  *Why:* real sync, but big lift — only after manual pipelines are polished.
- 💡 **Add `source` + `source_ref` columns to `media_ingestions`.**
  *Why:* provenance ("this came from email X / import Y") and per-source dedup.

## 3. Categorization, groups & rules

- ✅ Custom groups + Real Estate Investment taxonomy (see §0).
- 🔜 **"Create rule from transaction" flow** (inbox shortcut pre-fills payee rule).
  *Why:* rules are powerful but nobody writes regex from scratch; harvest them from
  corrections instead.
- 🔜 **Handle AI-proposed new categories.** When the model suggests a name that
  doesn't exist, surface it in review as "create category 'X' under group …?" instead
  of silently dropping to NULL.
  *Why:* today an unmatched category string is simply lost.
- 💡 **Rule enhancements:** amount ranges (`amount between`), currency match,
  `set_account`, and an `auto_accept` flag for high-trust rules (e.g. recurring
  salary) that skips the inbox.
  *Why:* the current match-fields (payee/memo/kind) can't express "any NGN transfer
  over 1m is real-estate related".
- 💡 **Learning loop:** periodically mine accepted corrections (AI said X, user chose
  Y) into suggested rules and/or few-shot examples in the extraction prompt.
  *Why:* the system should get more accurate the more it's corrected.
- 💡 **Category budgets** (`budgets` table: category/group × month × amount).
  *Why:* groups exist precisely so "Investments vs Lifestyle" can be budgeted.

## 4. Core ledger correctness

- 🔜 **Account assignment during review.** Inbox items have `account_id = null`;
  accept currently doesn't force one.
  *Why:* net worth and account registers are meaningless while transactions float
  account-less. Add default-account per user + account picker on accept.
- 🔜 **FX pipeline: populate `fx_rates` daily and compute `base_amount` on accept.**
  *Why:* the multi-currency promise (₦ + $ + BTC in one net worth) is unfulfilled —
  `fx_rates` is empty and `base_amount`/`fx_rate` are never written. A pg_cron +
  edge function pulling a free FX API (e.g. exchangerate.host) covers it.
- 🔜 **Net-worth snapshot job** (pg_cron nightly: sum accounts + accepted
  transactions per currency → base → insert `net_worth_snapshots`).
  *Why:* the table exists but nothing writes it; the headline chart depends on it.
- 💡 **Transfer linking.** A transfer between two own accounts should be one logical
  event (two legs), not two unrelated rows that inflate income/expense.
- 💡 **Attachment retention policy + receipt archive UI.**
  *Why:* land purchases specifically need retrievable documents years later.

## 5. AI extraction quality

- 🔜 **Persist and display transcripts** for audio (add `transcript` to the response
  schema).
  *Why:* reviewing "what was heard" beats re-listening; also debugging gold.
- 🔜 **Per-field confidence + low-confidence highlighting in review.**
  *Why:* one overall 0.87 hides "the date was a guess".
- 💡 **Statement reconciliation check:** extracted rows must sum to the statement's
  balance delta; mismatch → warning in review.
- 💡 **Eval set:** a folder of anonymized receipts/notes with expected JSON, run
  against prompt changes.
  *Why:* prompt tweaks (like the new taxonomy injection) currently ship blind.

## 6. Security & infrastructure

- 🔜 **Storage bucket + owner-only storage RLS** (prereq for §2 large media).
- 🔜 **Rate limiting / per-user ingestion quotas.**
  *Why:* every ingestion is a paid AI call; one runaway client is a bill.
- 🔜 **CI: typecheck + `supabase db lint`/migration dry-run on PRs.**
  *Why:* migrations are currently verified only by pushing to the live project.
- 💡 **Tighten CORS** (`origin: "*"` today) once the web app's domain exists.
- 💡 **Soft-delete / audit trail on transactions.**
  *Why:* a wealth ledger should never lose data to a mis-click; `rejected` covers
  inbox items but accepted rows are hard-deleted today.
- 💡 **Data export (CSV/JSON) in settings.**
  *Why:* trust — users must be able to leave with their data.

## 7. Housekeeping

- 🔜 Remove `tempInvoke.js` from repo root (ad-hoc script) or move it into
  `test-shell/scripts/`.
- 🔜 Delete the empty root `supabase/` directory (only `.temp` inside) — the real
  project lives in `backend/supabase/`.
  *Why:* two supabase dirs will eventually make someone run CLI commands in the
  wrong one.
- 💡 Fold `SAGEBOOK_BACKEND_SPEC.md`'s directory blueprint up to date (it predates
  the two newer functions and migrations).
