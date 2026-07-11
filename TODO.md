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

- ✅ **Scaffold `webapp/`** (Vite + React + TS + Tailwind v4 + TanStack Query) with
  auth gate, connect screen, sidebar shell, and monthly reports page.
- ✅ **Capture screen v1** (text + file → `process-media`, extraction result with
  duplicate flags, `clientTime` sent for relative-date anchoring).
  🔜 Still to add: microphone recorder, global paste handler, camera capture.
  *Why:* capture speed is the product's core promise; if logging a receipt takes
  >10 seconds, users stop doing it.
- ✅ **Inbox review UI v1** (accept / edit-and-accept / reject, duplicate badge
  with inline compare against the matching records on file, group-aware category
  picker, account picker on accept, bulk accept/reject, "+ Rule" shortcut,
  keyboard review: J/K navigate, A accept, R reject, E edit, X select).
  🔜 Still to add: "merge duplicates" action.
  *Why:* AI extraction is only trustworthy with a cheap human checkpoint; this is
  where trust in the ledger is built.
- ✅ **Transactions browser v1** (accepted ledger; date/account/category/kind
  filters run server-side; load-more pagination; client-side text search; rows
  expand to show tags and the original receipt/recording via signed URLs).
  *Why:* an unqueryable ledger is a write-only diary.
- ✅ **Edit everything after the fact** — accepted transactions are editable in
  place (payee, amount, currency, kind, date, category, account, memo, tags)
  plus "Back to inbox" and "Reject"; accounts are editable (name, type,
  currency, institution, opening balance — a manual balance permanently
  overrides the inferred one); categories can be renamed/deleted. The
  balance-recalc trigger now also covers the *old* account when a transaction
  moves between accounts or is un-accepted (migration
  `20260708000002_recalc_edges.sql`).
  *Why:* AI inference is a draft; every inferred fact must be user-correctable.
- ✅ **Categories & groups browser v1** (grouped listing + quick-add category).
  🔜 Still to add: drag between groups, nest/rename/merge, colors & icons editing.
  *Why:* the custom-taxonomy feature (e.g. real-estate) is only as good as the UI for
  shaping it.
- ✅ **PWA install + OS share-target (text/URL)** — installable manifest + service
  worker via vite-plugin-pwa; sharing text (e.g. a bank SMS) from the OS share
  sheet opens Capture pre-filled.
  🔜 Still to add: file/image share-target (needs a custom SW POST handler),
  offline capture queue (IndexedDB, flush on reconnect).
  *Why:* gets a "mobile app" without a second codebase.
- ✅ **Activity page + logging system** — `app_logs` table (owner-only RLS, 90-day
  retention cron) receives client events from Capture/Import/Inbox/Net worth;
  the Activity page merges them with `media_ingestions` into one timeline with
  failure filters and a per-entry **Copy report** button for pasting into a
  debugging conversation. The commit pipeline now returns per-row
  `insertErrors` (surfaced in the Capture result and stamped onto the
  ingestion) instead of swallowing them.
  *Why:* "it failed" is only fixable when the failure is on record.
- ✅ **AI provider routing** — any OpenAI-compatible provider via secrets
  (`AI_BASE_URL` + `AI_API_KEY` + `AI_MODEL`: DeepSeek, Qwen/DashScope, GLM,
  Kimi, …) using JSON-object mode with the schema embedded in the prompt.
  Preference order: custom (cheapest) → Gemini → OpenRouter; override with
  `AI_PROVIDER`. Gemini remains required for audio/video/pdf (OpenAI-compatible
  chat APIs only take text + images).
  🔜 Follow-up: Qwen-Omni for audio via compatible mode, removing the Gemini
  dependency for voice notes.
- ✅ **Backblaze B2 storage backend** — `storage-proxy` edge function keeps B2
  credentials server-side (`_shared/b2.ts`, native B2 API): authenticated
  uploads to `{userId}/…`, prefix-checked signed download URLs (1 h). Paths are
  prefixed `b2:`; plain paths still resolve to the Supabase `ingest` bucket as
  fallback, and process-media dispatches on the prefix. Secrets: `B2_KEY_ID`,
  `B2_APP_KEY`, `B2_BUCKET_ID`, `B2_BUCKET_NAME`.
  🔜 Follow-up: rotate the application key that was shared in chat; switch to a
  bucket-scoped key (current one is a master key).
- 💡 **Realtime inbox** (subscribe to pending_review inserts).
  *Why:* email/async ingestions should appear without refresh.

## 2. Ingestion pipelines (see INGESTION_PIPELINES.md)

- ✅ **Voice recorder in the web app** (MediaRecorder → existing audio path; codec
  params stripped for Gemini). Inline base64 only — long recordings need the
  Storage-upload path below.
- 🔜 **Send client time + timezone with every ingestion.**
  *Why:* "yesterday" in a voice note currently resolves against the model's unknown
  clock — dates can silently be wrong.
- ✅ **Storage-upload path for large media** — private `ingest` bucket with
  owner-only policies (migration `20260707000002_storage_ingest.sql`); Capture
  uploads every file to `{user_id}/…` and sends `storagePath`; process-media
  verifies the path prefix, downloads via service role (15 MB cap), and infers
  the mime type. Small files fall back to inline if the upload fails. The stored
  object doubles as the receipt archive.
  🔜 Follow-up: Gemini Files API for >15 MB media; retention policy.
- 🔜 **Email forwarding pipeline** (`u-<id>@in.sagebook.app` → `ingest-email` fn).
  *Why:* most receipts/bank alerts already arrive by email; this is the highest-value
  passive pipeline. Includes per-user sender allow-list for safety.
- ✅ **CSV/OFX statement import** — new Import page parses CSV (papaparse) and
  OFX/QFX locally: column-mapping UI with auto-guessing from headers, saved
  per-bank mappings (recalled by header signature), date-format and sign
  conventions, debit/credit column pairs, locale-aware amount parsing, preview
  with per-line skip reasons. Rows go through the new `ingest-import` edge
  function into the shared rules/dedup/commit pipeline (extracted to
  `_shared/commit.ts`, now reused by all three entry points), optionally
  pre-assigned to an account, with the original file archived in storage.
  🔜 Follow-up: XLSX (convert client-side), QIF, chunked imports >1000 rows,
  server-side mapping templates (currently per-browser localStorage).
- ✅ **SMS/bank-alert path v1** via the PWA share-target (share the alert text →
  Capture pre-filled → extract).
  💡 Later: Android forwarder app / automation for hands-free forwarding, plus
  per-bank regex templates before the LLM.
  *Why:* in markets without bank APIs, debit-alert SMS is de-facto real-time sync.
- 💡 **`ingest-api` with per-device API tokens.**
  *Why:* unlocks Shortcuts/Tasker/Zapier without handing out user JWTs.
- 💡 **Bank aggregators** (Mono/Okra/Plaid/TrueLayer).
  *Why:* real sync, but big lift — only after manual pipelines are polished.
- 💡 **Add `source` + `source_ref` columns to `media_ingestions`.**
  *Why:* provenance ("this came from email X / import Y") and per-source dedup.

## 3. Categorization, groups & rules

- ✅ Custom groups + Real Estate Investment taxonomy (see §0).
- ✅ **"Create rule from transaction" flow** — "+ Rule" on an inbox card opens the
  Rules page with payee/category pre-filled; Rules page supports create, enable/
  disable, delete.
  *Why:* rules are powerful but nobody writes regex from scratch; harvest them from
  corrections instead.
- ✅ **Inference & confirm flow** (migration `20260708000000_account_inference.sql`):
  extraction now infers the **source account** (holder name, bank, masked number)
  and the **reference ID** from bank receipts, with the user's accounts injected
  into the prompt so known accounts auto-match. Unmatched inferences surface in
  the inbox as one-click proposals — "Create account & assign" / "Create
  category in group & assign" / Ignore — while the transaction stays
  pending_review. Capture results list all inferences up front. Accounts created
  this way carry `metadata.auto_balance`: their **opening balance is inferred**
  (a ₦4m debit implies ≥₦4m was there; recomputed on every accepted transaction
  until the user sets it manually). Reference IDs are a strong dedup signal in
  `find_duplicate`. Accounts page shows live balances (`v_account_balances`)
  with an "inferred balance" badge.
- ✅ **Fix: defaults were never seeded for real signups** — nothing created
  `profiles` rows (the seed trigger hangs off profiles), so real users had no
  groups/categories and extraction ran taxonomy-blind. New `auth.users` trigger
  creates the profile (and thereby the seed) at signup; existing users
  backfilled (migration `20260708000001_seed_on_signup.sql`).
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

- ✅ **Account assignment during review** — Accounts page (create/archive) plus an
  account picker on inbox accept/edit that remembers the last-used account.
  🔜 Still to add: require-account option, per-account registers with running
  balances.
  *Why:* net worth and account registers are meaningless while transactions float
  account-less.
- ✅ **Broader currency seed** (NGN, ZAR, KES, GHS, INR, AED, BRL and more) —
  `transactions.currency` has an FK to `currencies`, so an extracted ₦ receipt
  previously failed to insert at all (migration `20260707000000_more_currencies.sql`).
  🔜 Follow-up: commit path should surface (not just console-log) rows dropped by
  an unknown currency, or fall back to the profile base currency.
- ✅ **FX pipeline** — `sync-fx-rates` edge function (open.er-api.com for fiat,
  CoinGecko for BTC/ETH, no API keys) writes USD-based rows into `fx_rates`;
  `latest_fx_rate()` resolves any pair (direct → inverse → USD cross); a trigger
  fills `fx_rate`/`base_amount` whenever a transaction is accepted, and
  `refresh_my_base_amounts()` backfills rows accepted before rates existed
  (migration `20260707000001_fx_networth.sql`).
  🔜 Follow-up: schedule the sync daily (Supabase scheduled functions or pg_cron
  + pg_net) — today it runs when a user hits "Update now" on the Net worth page.
- ✅ **Net-worth snapshots** — `compute_net_worth_snapshot()` sums per-account
  balances (income/expense/transfer legs/adjustments) up to a date, converts to
  the profile base currency, splits assets vs liabilities by account type, and
  upserts with a per-account `breakdown` jsonb. Nightly pg_cron job scheduled
  where the extension is available; `refresh_my_net_worth()` RPC for on-demand.
  The webapp **Net worth page** shows stat tiles, a trend chart, the account
  breakdown (with "no rate" warnings), and a one-click Update button that chains
  rate-sync → base-amount backfill → snapshot.
- 💡 **Transfer linking.** A transfer between two own accounts should be one logical
  event (two legs), not two unrelated rows that inflate income/expense.
- 💡 **Attachment retention policy + receipt archive UI.**
  *Why:* land purchases specifically need retrievable documents years later.

## 5. AI extraction quality

- ✅ **Persist and display transcripts** — `transcript` added to the extraction
  schema/prompt for audio/video; shown in the Capture result and in the
  Transactions detail next to the audio player.
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
- ✅ **CI** — GitHub Actions: webapp typecheck + build, `deno check` on every
  edge function (`.github/workflows/ci.yml`).
  🔜 Follow-up: `supabase db lint`/migration dry-run (needs Docker on the runner).
- 💡 **Tighten CORS** (`origin: "*"` today) once the web app's domain exists.
- 💡 **Soft-delete / audit trail on transactions.**
  *Why:* a wealth ledger should never lose data to a mis-click; `rejected` covers
  inbox items but accepted rows are hard-deleted today.
- ✅ **Data export (CSV/JSON)** — on the Transactions page, exports everything
  matching the current filters (up to 10k rows) with category/account names
  and tags resolved.
  *Why:* trust — users must be able to leave with their data.

## 7. Housekeeping

- ✅ Removed `tempInvoke.js` from repo root — it was an ad-hoc script that had a
  hardcoded live Supabase auth JWT committed to git; deleted rather than moved.
  🔜 Follow-up: rotate/expire that test user's session, and consider a
  git-history scrub (filter-repo/BFG) before this repo is ever made public.
- ✅ Deleted the empty root `supabase/` directory (only `.temp` inside) — the real
  project lives in `backend/supabase/`.
  *Why:* two supabase dirs will eventually make someone run CLI commands in the
  wrong one.
- 💡 Fold `SAGEBOOK_BACKEND_SPEC.md`'s directory blueprint up to date (it predates
  the two newer functions and migrations).
