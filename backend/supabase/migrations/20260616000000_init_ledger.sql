-- =============================================================================
-- Sagebook · Initial Ledger Schema
-- Multimodal, multi-currency personal wealth & net-worth tracking ledger.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- -----------------------------------------------------------------------------
-- Enumerations
-- -----------------------------------------------------------------------------

do $$ begin
    create type account_type as enum (
        'cash',
        'checking',
        'savings',
        'credit_card',
        'loan',
        'investment',
        'retirement',
        'real_estate',
        'vehicle',
        'crypto',
        'other_asset',
        'other_liability'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type transaction_kind as enum (
        'income',
        'expense',
        'transfer',
        'adjustment'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type media_kind as enum (
        'image',
        'audio',
        'video',
        'pdf',
        'text'
    );
exception when duplicate_object then null; end $$;

do $$ begin
    create type ingestion_status as enum (
        'pending',
        'processing',
        'parsed',
        'failed',
        'applied'
    );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- Profiles (mirrors auth.users for app-side metadata)
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
    id              uuid primary key references auth.users(id) on delete cascade,
    display_name    text,
    base_currency   char(3) not null default 'USD',
    locale          text    not null default 'en-US',
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Currencies & FX rates
-- -----------------------------------------------------------------------------

create table if not exists public.currencies (
    code        char(3) primary key,
    name        text    not null,
    symbol      text,
    decimals    smallint not null default 2
);

insert into public.currencies (code, name, symbol, decimals) values
    ('USD', 'US Dollar',        '$', 2),
    ('EUR', 'Euro',             '€', 2),
    ('GBP', 'Pound Sterling',   '£', 2),
    ('JPY', 'Japanese Yen',     '¥', 0),
    ('CAD', 'Canadian Dollar',  'C$', 2),
    ('AUD', 'Australian Dollar','A$', 2),
    ('CHF', 'Swiss Franc',      'Fr', 2),
    ('CNY', 'Chinese Yuan',     '¥', 2),
    ('BTC', 'Bitcoin',          '₿', 8),
    ('ETH', 'Ether',            'Ξ', 8)
on conflict (code) do nothing;

create table if not exists public.fx_rates (
    base_code   char(3) not null references public.currencies(code),
    quote_code  char(3) not null references public.currencies(code),
    rate        numeric(24, 12) not null check (rate > 0),
    as_of       date not null,
    source      text,
    primary key (base_code, quote_code, as_of)
);

create index if not exists fx_rates_as_of_idx on public.fx_rates(as_of desc);

-- -----------------------------------------------------------------------------
-- Accounts
-- -----------------------------------------------------------------------------

create table if not exists public.accounts (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    name            text not null,
    type            account_type not null,
    currency        char(3) not null references public.currencies(code),
    institution     text,
    opening_balance numeric(20, 4) not null default 0,
    is_archived     boolean not null default false,
    metadata        jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists accounts_user_idx on public.accounts(user_id);

-- -----------------------------------------------------------------------------
-- Categories (hierarchical)
-- -----------------------------------------------------------------------------

create table if not exists public.categories (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users(id) on delete cascade,
    parent_id   uuid references public.categories(id) on delete set null,
    name        text not null,
    icon        text,
    color       text,
    created_at  timestamptz not null default now(),
    unique (user_id, parent_id, name)
);

create index if not exists categories_user_idx on public.categories(user_id);

-- -----------------------------------------------------------------------------
-- Transactions
-- -----------------------------------------------------------------------------

create table if not exists public.transactions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    account_id      uuid not null references public.accounts(id) on delete cascade,
    counter_account uuid references public.accounts(id) on delete set null,
    category_id     uuid references public.categories(id) on delete set null,
    kind            transaction_kind not null,
    occurred_at     timestamptz not null,
    amount          numeric(20, 4) not null,
    currency        char(3) not null references public.currencies(code),
    fx_rate         numeric(24, 12),
    base_amount     numeric(20, 4),
    payee           text,
    memo            text,
    tags            text[] not null default '{}',
    metadata        jsonb not null default '{}'::jsonb,
    ingestion_id    uuid,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists tx_user_occurred_idx on public.transactions(user_id, occurred_at desc);
create index if not exists tx_account_idx      on public.transactions(account_id);
create index if not exists tx_category_idx     on public.transactions(category_id);

-- -----------------------------------------------------------------------------
-- Media ingestions (multimodal pipeline)
-- -----------------------------------------------------------------------------

create table if not exists public.media_ingestions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    storage_path    text,
    media_kind      media_kind not null,
    mime_type       text not null,
    bytes           bigint,
    status          ingestion_status not null default 'pending',
    prompt_hint     text,
    raw_response    jsonb,
    parsed_payload  jsonb,
    error           text,
    model           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists ingestions_user_idx   on public.media_ingestions(user_id, created_at desc);
create index if not exists ingestions_status_idx on public.media_ingestions(status);

alter table public.transactions
    add constraint transactions_ingestion_fk
    foreign key (ingestion_id) references public.media_ingestions(id) on delete set null;

-- -----------------------------------------------------------------------------
-- Net-worth snapshots
-- -----------------------------------------------------------------------------

create table if not exists public.net_worth_snapshots (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users(id) on delete cascade,
    as_of           date not null,
    base_currency   char(3) not null references public.currencies(code),
    assets          numeric(20, 4) not null default 0,
    liabilities     numeric(20, 4) not null default 0,
    net_worth       numeric(20, 4) generated always as (assets - liabilities) stored,
    breakdown       jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    unique (user_id, as_of)
);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------

create or replace function public.tg_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at := now();
    return new;
end $$;

do $$
declare
    t text;
begin
    foreach t in array array['profiles', 'accounts', 'transactions', 'media_ingestions']
    loop
        execute format(
            'drop trigger if exists touch_updated_at on public.%I;
             create trigger touch_updated_at before update on public.%I
             for each row execute function public.tg_touch_updated_at();',
             t, t);
    end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles            enable row level security;
alter table public.accounts            enable row level security;
alter table public.categories          enable row level security;
alter table public.transactions        enable row level security;
alter table public.media_ingestions    enable row level security;
alter table public.net_worth_snapshots enable row level security;

-- Generic owner-only policy applied to all user-scoped tables.
do $$
declare
    t text;
begin
    foreach t in array array[
        'profiles', 'accounts', 'categories',
        'transactions', 'media_ingestions', 'net_worth_snapshots'
    ]
    loop
        execute format('drop policy if exists owner_select on public.%I;', t);
        execute format('drop policy if exists owner_modify on public.%I;', t);

        if t = 'profiles' then
            execute format(
                'create policy owner_select on public.%I
                 for select using (auth.uid() = id);', t);
            execute format(
                'create policy owner_modify on public.%I
                 for all using (auth.uid() = id) with check (auth.uid() = id);', t);
        else
            execute format(
                'create policy owner_select on public.%I
                 for select using (auth.uid() = user_id);', t);
            execute format(
                'create policy owner_modify on public.%I
                 for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
        end if;
    end loop;
end $$;

-- Currencies and FX rates are reference data: world-readable, no writes via API.
alter table public.currencies enable row level security;
alter table public.fx_rates   enable row level security;

drop policy if exists currencies_read on public.currencies;
create policy currencies_read on public.currencies for select using (true);

drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates for select using (true);
