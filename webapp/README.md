# Sagebook Web App

The production UI for Sagebook: capture financial events (text or media), review
AI-extracted transactions in an inbox, browse the ledger, manage the category
taxonomy, and view monthly reports. Design rationale lives in
[docs/WEBAPP_DESIGN.md](../docs/WEBAPP_DESIGN.md).

## Stack

Vite · React 18 · TypeScript · Tailwind CSS v4 · TanStack Query · React Router ·
`@supabase/supabase-js`

## Run

```powershell
cd webapp
npm install
npm run dev
```

Configuration comes from either:

- `.env` / `.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  (see `.env.example`), or
- the one-time connect screen shown on first launch (stored in localStorage).

Sign in with a Supabase Auth email/password user. The backend (migrations +
edge functions) must be deployed first — see the repo root README.

## Structure

```
src/
├── App.tsx              Router, auth gate, query client
├── components/AppShell  Sidebar navigation layout
├── lib/
│   ├── supabase.ts      Client bootstrap, config storage, edge-fn invoker
│   ├── taxonomy.ts      Shared groups/categories + accounts fetchers
│   ├── storage.ts       Ingest-bucket upload helper
│   ├── importer.ts      CSV/OFX parsing + mapping templates (pure functions)
│   ├── types.ts         Row/response types
│   └── format.ts        Money/date formatting
└── pages/
    ├── Welcome.tsx      Connect + sign in / sign up
    ├── Capture.tsx      Text/media/voice capture → process-media → result
    ├── Import.tsx       CSV/OFX statement import wizard → ingest-import
    ├── Inbox.tsx        Review queue: accept (with account) / edit / reject,
    │                    bulk actions, "+ Rule" shortcut
    ├── Transactions.tsx Accepted ledger with search
    ├── Accounts.tsx     Account list, create, archive
    ├── Categories.tsx   Groups → categories browser + quick add
    ├── Rules.tsx        Auto-categorization rules (create/toggle/delete)
    ├── Reports.tsx      Current-month income/expense + category breakdown
    └── NetWorth.tsx     Snapshot timeline chart, breakdown table, update action
```

`npm run build` typechecks (`tsc --noEmit`) then bundles.
