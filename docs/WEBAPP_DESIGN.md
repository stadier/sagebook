# Sagebook Web App — Design Specification

The production web application that replaces the `test-shell`. It sits directly on the
existing Supabase backend (Postgres + RLS, `process-media`, `commit-transactions`,
`review-transaction` edge functions) — no new server is required.

---

## 1. Goals

- **Capture-first.** The fastest path in the app is "get a financial event into the
  inbox": snap a receipt, speak a voice note, type a sentence, drop a PDF.
- **Review-second.** Everything AI-extracted lands in a review inbox; the human
  accepts, edits, or rejects. Nothing hits reports until accepted.
- **Understand-third.** Dashboards for spending by category group, net worth,
  multi-currency positions.

## 2. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | **React 18 + Vite + TypeScript** | Test-shell already uses Vite/TS; keeps the toolchain familiar. No SSR needed — data is per-user and behind auth, so SEO is irrelevant. |
| Routing | React Router v7 (library mode) | Lightweight; the app is a small SPA. |
| Data layer | TanStack Query + `@supabase/supabase-js` | Queries hit PostgREST directly (RLS enforces ownership); mutations that need service logic call the edge functions. Query cache gives optimistic inbox actions. |
| UI kit | Tailwind CSS + shadcn/ui | Fast to build the dense tables/forms a ledger needs; consistent dark mode. |
| Charts | Recharts | Category donut, monthly bars, net-worth line. |
| State | TanStack Query for server state; tiny Zustand store only for UI state (capture drawer open, active month). | Avoid duplicating server state in a global store. |
| Auth | Supabase Auth (email/password now; magic link + OAuth later) | Session handling already proven in test-shell. |
| Hosting | Static deploy (Netlify/Vercel/Cloudflare Pages) | Pure SPA; env-injected Supabase URL/anon key instead of the test-shell's manual URL/key form. |

Proposed location: `webapp/` at the repo root (sibling of `test-shell/`, which stays as
a raw API harness).

## 3. Information architecture / routes

```
/                     → redirect to /inbox (or /welcome when signed out)
/welcome              Sign in / sign up
/capture              Full-page capture (also available everywhere as a drawer)
/inbox                Review queue (pending_review transactions)
/transactions         Accepted ledger with filters (account, category, date, tag, search)
/accounts             Account list + balances; create/archive accounts
/accounts/:id         Single account register
/categories           Manage groups → categories → subcategories (drag to regroup)
/rules                Rule list; create/edit/reorder; "test rule" against history
/reports              Monthly summary, category-group breakdown, trends
/net-worth            Snapshot timeline + asset/liability breakdown
/settings             Profile, base currency, locale, data export, danger zone
```

## 4. Key screens

### 4.1 Capture (the front door)
A single surface with four input modes, all funneling into `process-media`:

- **Text box** — "Paid ₦2.5m deposit for the Ibeju-Lekki plot yesterday" → sent as `text`.
- **Camera / file** — receipts, invoices, bank-statement PDFs → `inlineMedia` (or Storage
  upload + `storagePath` once large-file support lands; see INGESTION_PIPELINES.md §5).
- **Microphone** — press-and-hold to record; audio blob → `inlineMedia` (`audio/webm`).
- **Paste** — global paste handler accepts images and text anywhere in the app.

After submit: show the extraction result inline (summary, parsed transactions,
confidence, duplicate flags) with one-tap **Accept all** / **Review in inbox**.
Optional prompt-hint field ("this is in EUR") kept from the test-shell.

### 4.2 Inbox (review queue)
Backed by `v_pending_review`. Card list, newest first:

- Each card: payee, amount + currency, date, AI-suggested category (colored chip with
  group), source badge (📷 image / 🎙 audio / ✉️ email / ⌨ text), confidence, and a
  **duplicate warning** when `duplicate_group_id` is set (side-by-side compare with the
  suspected original).
- Actions: **Accept** (assign account if null), **Edit** (inline form → `review-transaction`
  with `action: "edit"`), **Reject**. Keyboard: `A` / `E` / `R`, `J`/`K` to move.
- Bulk select → accept/reject many.
- "Create rule from this" shortcut: pre-fills a rule from the payee so the next
  identical payee auto-categorizes.

### 4.3 Transactions
Virtualized table of accepted transactions. Filters: date range, account, category
(group-aware tree picker), kind, tag, free-text payee/memo search. Row click → detail
drawer with the source media preview (`media_ingestions.storage_path`) and edit form.

### 4.4 Categories & Groups
Two-level management UI matching the new schema (`category_groups` → `categories` →
subcategories via `parent_id`):

- Groups as columns/sections (Income, Essentials, Lifestyle, Investments, Business,
  Transfers & Other) with icon + color editing.
- Drag categories between groups; nest subcategories (e.g. *Real Estate Investment →
  Land Purchase, Legal & Documentation*).
- Per-category month-to-date spend sparkline (from `v_category_summary`).
- Merge tool: reassigns all transactions from category A to B, then deletes A.

### 4.5 Reports
- **This month** header: income vs expense vs net, per currency.
- Category-group donut → drill into categories → drill into transactions.
- 12-month stacked bars by group (`v_monthly_summary` + `v_category_summary`).
- Currency selector: native amounts or converted to base currency (needs `fx_rates`
  population — see TODO).

### 4.6 Net worth
Timeline from `net_worth_snapshots` (needs the snapshot job — see TODO) plus a live
"now" point computed from account opening balances + accepted transactions.

## 5. Data-flow rules

1. **Reads** go straight to PostgREST (tables + `v_*` views) under the user's JWT; RLS
   is the authorization layer. No edge function needed for reads.
2. **Simple writes** (accounts, categories, groups, rules, profile) also go straight to
   PostgREST — owner policies already exist.
3. **Workflow writes** go through edge functions: ingestion (`process-media`), review
   actions (`review-transaction`), re-commit (`commit-transactions`). These need
   service-role logic (dedup RPC, rule application, audit fields).
4. **Optimistic UI** for inbox accept/reject with rollback on error.
5. **Realtime (later):** subscribe to `transactions` inserts where
   `review_status = 'pending_review'` so email/async ingestions pop into the inbox live.

## 6. Component inventory (first build)

- `AppShell` (sidebar nav, capture FAB, user menu)
- `CaptureDrawer` (`TextCapture`, `MediaCapture`, `VoiceRecorder`)
- `ExtractionResult` (parsed tx list + confidence + accept bar)
- `InboxCard`, `DuplicateCompare`, `ReviewEditForm`
- `TransactionsTable` (virtualized), `TransactionDrawer`
- `CategoryTree`, `GroupBoard`, `CategoryPicker` (group-aware)
- `RuleForm`, `RuleTester`
- `MoneyText` (currency-aware formatter — port `fmt` from `dashboard.ts`)
- Charts: `CategoryDonut`, `MonthlyBars`, `NetWorthLine`

## 7. Build order

1. Scaffold `webapp/` (Vite React TS, Tailwind, router, Supabase client from env).
2. Auth screens + session guard (port test-shell auth logic).
3. Capture (text + file) → `process-media` → `ExtractionResult`.
4. Inbox with accept/edit/reject (this makes the product usable end-to-end).
5. Transactions table + filters.
6. Categories & groups management.
7. Rules UI.
8. Reports + dashboard (port/replace `dashboard.html`).
9. Voice recorder, paste capture, PWA polish (see below).

## 8. PWA / mobile

Ship as an installable PWA early: manifest + service worker, `share_target` so the OS
share sheet can send images/PDFs straight into capture, and offline queueing of
captures (IndexedDB) that flush when back online. This gets 80% of a mobile app
without a second codebase.
