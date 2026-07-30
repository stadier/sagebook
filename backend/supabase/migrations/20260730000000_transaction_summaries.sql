-- =============================================================================
-- Sagebook · Generated transaction summaries
-- -----------------------------------------------------------------------------
-- Bank narration is written for the bank, not the reader:
--   "NIP CR/MOB/ZAMBABAY HOMES AND PROPERTIES INVESTMENT LIMITED/TAJ /
--    Family land development payment"
-- The ledger stores a one-line plain-language reading of each movement so the
-- transactions list is skimmable, and keeps the raw narration on the row for
-- the detail view. Summaries are generated, never authoritative: amount, date,
-- and payee remain the source of truth.
-- =============================================================================

alter table public.transactions
    add column if not exists summary       text,
    add column if not exists summary_model text,
    add column if not exists summary_at    timestamptz;

comment on column public.transactions.summary is
    'Generated one-line plain-language reading of this transaction. Null until summarized; edited by the user takes precedence and is never regenerated.';
comment on column public.transactions.summary_model is
    'Model that produced summary, or ''user'' when hand-edited.';

-- Backlog lookup: "which of this user''s rows still need a summary?" runs on
-- every import and on the transactions page, so keep it an index-only scan.
create index if not exists tx_summary_backlog_idx
    on public.transactions (user_id, occurred_at desc)
    where summary is null and review_status <> 'rejected';
