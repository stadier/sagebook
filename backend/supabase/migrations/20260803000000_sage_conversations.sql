-- =============================================================================
-- Sagebook · Sage conversations
-- -----------------------------------------------------------------------------
-- Every question to Sage used to be its own island: ask about a transaction,
-- then ask a follow-up about it, and the second question arrived with no idea
-- the first had happened. These two tables give Sage a memory.
--
-- Messages form a *tree*, not a list. `parent_id` is what a turn was said in
-- reply to, so editing an earlier question is not a destructive rewrite — it is
-- a second child of the same parent. Both versions survive; the user flips
-- between them. That is the whole reason this isn't a simple ordered list with
-- a `position` column.
--
-- `sage_conversations.active_leaf_id` names the tip of the branch currently on
-- screen. The thread is the path from that leaf back to the root, so switching
-- versions costs one update rather than a rewrite of anything.
--
--        root ─ "how much on land this year?"
--                 └ Sage: ₦12.4m
--                     ├ "and last year?"        ← version 1
--                     │   └ Sage: ₦8.1m
--                     └ "what about lagos only?" ← version 2, after an edit
--                         └ Sage: ₦4.2m          ← active_leaf_id
-- =============================================================================

create table if not exists public.sage_conversations (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    -- Taken from the opening question; the user can rename it.
    title           text not null default 'New conversation',
    -- Tip of the branch on screen. Set after the messages table exists, below.
    active_leaf_id  uuid,
    -- Out of the history list without being gone. Deleting a conversation takes
    -- every figure Sage worked out in it, so the list offers this first.
    archived_at     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists sage_conversations_user_idx
    on public.sage_conversations(user_id, updated_at desc);

alter table public.sage_conversations enable row level security;

drop policy if exists owner_select on public.sage_conversations;
create policy owner_select on public.sage_conversations
    for select using (auth.uid() = user_id);
drop policy if exists owner_modify on public.sage_conversations;
create policy owner_modify on public.sage_conversations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists touch_updated_at on public.sage_conversations;
create trigger touch_updated_at
    before update on public.sage_conversations
    for each row execute function public.tg_touch_updated_at();

grant select, insert, update, delete on public.sage_conversations to authenticated;

-- =============================================================================
-- sage_messages — one turn, user or Sage
-- =============================================================================

create table if not exists public.sage_messages (
    id              uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.sage_conversations(id) on delete cascade,
    user_id         uuid not null references auth.users(id) on delete cascade,
    -- What this turn replies to. Null for the opening question. Two children
    -- with the same parent are two versions of the same turn.
    parent_id       uuid references public.sage_messages(id) on delete cascade,
    role            text not null check (role in ('user', 'sage')),
    -- The question as typed, or Sage's one-line gist.
    content         text not null default '',
    -- Sage turns only: the whole answer — blocks, the queries behind it, the
    -- follow-ups. Stored verbatim so reopening a conversation redraws the same
    -- tables from the same figures rather than asking the ledger again.
    answer          jsonb,
    -- Set instead of `answer` when the model could not be reached, so a failed
    -- turn is still part of the thread and can be retried in place.
    error           text,
    created_at      timestamptz not null default now()
);

create index if not exists sage_messages_conversation_idx
    on public.sage_messages(conversation_id, created_at);
create index if not exists sage_messages_parent_idx
    on public.sage_messages(parent_id);

alter table public.sage_messages enable row level security;

drop policy if exists owner_select on public.sage_messages;
create policy owner_select on public.sage_messages
    for select using (auth.uid() = user_id);
drop policy if exists owner_modify on public.sage_messages;
create policy owner_modify on public.sage_messages
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.sage_messages to authenticated;

-- The leaf pointer, now that there is something to point at. `set null` rather
-- than cascade: losing a branch tip should empty the pointer, never take the
-- conversation with it.
do $$ begin
    alter table public.sage_conversations
        add constraint sage_conversations_active_leaf_fkey
        foreign key (active_leaf_id) references public.sage_messages(id) on delete set null;
exception when duplicate_object then null;
end $$;
