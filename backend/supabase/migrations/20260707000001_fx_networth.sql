-- =============================================================================
-- Sagebook · FX conversion & Net-Worth Snapshots
-- -----------------------------------------------------------------------------
-- 1. latest_fx_rate(): resolve a conversion rate (direct, inverse, USD-cross).
-- 2. Trigger: fill transactions.fx_rate/base_amount when a row is accepted.
-- 3. compute_net_worth_snapshot(): per-user assets/liabilities in base currency.
-- 4. refresh_my_* RPCs for on-demand recompute from the web app.
-- 5. Nightly pg_cron snapshot job (skipped gracefully where pg_cron is absent).
-- Rates are written by the sync-fx-rates edge function as USD → quote rows.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rate lookup
-- -----------------------------------------------------------------------------

create or replace function public.latest_fx_rate(
    p_from char(3),
    p_to   char(3),
    p_on   date default current_date
)
returns numeric language sql stable set search_path = public as $$
    select case
        when p_from = p_to then 1::numeric
        else coalesce(
            -- direct rate
            (select rate from public.fx_rates
             where base_code = p_from and quote_code = p_to and as_of <= p_on
             order by as_of desc limit 1),
            -- inverse rate
            (select 1 / rate from public.fx_rates
             where base_code = p_to and quote_code = p_from and as_of <= p_on
             order by as_of desc limit 1),
            -- USD cross rate: 1 FROM = (usd->to / usd->from) TO
            (select u_to.rate / u_from.rate
             from (select rate from public.fx_rates
                   where base_code = 'USD' and quote_code = p_from and as_of <= p_on
                   order by as_of desc limit 1) u_from,
                  (select rate from public.fx_rates
                   where base_code = 'USD' and quote_code = p_to and as_of <= p_on
                   order by as_of desc limit 1) u_to)
        )
    end;
$$;

-- -----------------------------------------------------------------------------
-- base_amount trigger: convert to the profile base currency on accept
-- -----------------------------------------------------------------------------

create or replace function public.tg_compute_base_amount()
returns trigger language plpgsql set search_path = public as $$
declare
    v_base char(3);
    v_rate numeric;
begin
    if new.review_status = 'accepted'
       and (new.base_amount is null or new.fx_rate is null) then
        select base_currency into v_base from public.profiles where id = new.user_id;
        v_base := coalesce(v_base, 'USD');
        v_rate := public.latest_fx_rate(new.currency, v_base, new.occurred_at::date);
        if v_rate is not null then
            new.fx_rate     := v_rate;
            new.base_amount := round(new.amount * v_rate, 4);
        end if;
    end if;
    return new;
end $$;

drop trigger if exists compute_base_amount on public.transactions;
create trigger compute_base_amount
    before insert or update on public.transactions
    for each row execute function public.tg_compute_base_amount();

-- Recompute missing base_amounts (e.g. after the first FX sync). The no-op
-- update fires the trigger above for each row still lacking a conversion.
create or replace function public.refresh_my_base_amounts()
returns integer language plpgsql security definer set search_path = public as $$
declare
    v_count integer;
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    update public.transactions
    set base_amount = null
    where user_id = auth.uid()
      and review_status = 'accepted'
      and base_amount is null;
    get diagnostics v_count = row_count;
    return v_count;
end $$;

-- -----------------------------------------------------------------------------
-- Net-worth snapshot computation
-- -----------------------------------------------------------------------------
-- Balance model per account, using accepted transactions up to p_as_of:
--   income +amount · expense −amount · transfer −amount (leg out) and +amount
--   into counter_account · adjustment +amount (positive correction).
-- Liability accounts (credit_card / loan / other_liability) report −balance
-- as the liability figure, so net worth = assets − liabilities always equals
-- the plain sum of balances.

create or replace function public.compute_net_worth_snapshot(
    p_user_id uuid,
    p_as_of   date default current_date
)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_base       char(3);
    v_assets     numeric := 0;
    v_liab       numeric := 0;
    v_breakdown  jsonb   := '[]'::jsonb;
    v_balance    numeric;
    v_rate       numeric;
    v_converted  numeric;
    v_is_liab    boolean;
    r            record;
begin
    select base_currency into v_base from public.profiles where id = p_user_id;
    v_base := coalesce(v_base, 'USD');

    for r in
        select
            a.id, a.name, a.type::text as acct_type, a.currency, a.opening_balance,
            coalesce((
                select sum(case
                    when t.kind = 'income'     then t.amount
                    when t.kind = 'expense'    then -t.amount
                    when t.kind = 'transfer'   then -t.amount
                    when t.kind = 'adjustment' then t.amount
                    else 0 end)
                from public.transactions t
                where t.account_id = a.id
                  and t.review_status = 'accepted'
                  and t.occurred_at::date <= p_as_of
            ), 0)
            + coalesce((
                select sum(t2.amount)
                from public.transactions t2
                where t2.counter_account = a.id
                  and t2.kind = 'transfer'
                  and t2.review_status = 'accepted'
                  and t2.occurred_at::date <= p_as_of
            ), 0) as delta
        from public.accounts a
        where a.user_id = p_user_id
          and not a.is_archived
    loop
        v_balance   := r.opening_balance + r.delta;
        v_rate      := public.latest_fx_rate(r.currency, v_base, p_as_of);
        v_converted := case when v_rate is null then 0 else round(v_balance * v_rate, 4) end;
        v_is_liab   := r.acct_type in ('credit_card', 'loan', 'other_liability');

        if v_is_liab then
            v_liab := v_liab - v_converted;
        else
            v_assets := v_assets + v_converted;
        end if;

        v_breakdown := v_breakdown || jsonb_build_object(
            'account_id',   r.id,
            'name',         r.name,
            'type',         r.acct_type,
            'currency',     r.currency,
            'balance',      v_balance,
            'base_amount',  case when v_rate is null then null else v_converted end,
            'rate_missing', v_rate is null
        );
    end loop;

    insert into public.net_worth_snapshots
        (user_id, as_of, base_currency, assets, liabilities, breakdown)
    values
        (p_user_id, p_as_of, v_base, v_assets, v_liab, v_breakdown)
    on conflict (user_id, as_of) do update set
        base_currency = excluded.base_currency,
        assets        = excluded.assets,
        liabilities   = excluded.liabilities,
        breakdown     = excluded.breakdown;
end $$;

create or replace function public.refresh_my_net_worth()
returns public.net_worth_snapshots
language plpgsql security definer set search_path = public as $$
declare
    v_row public.net_worth_snapshots;
begin
    if auth.uid() is null then
        raise exception 'not authenticated';
    end if;
    perform public.compute_net_worth_snapshot(auth.uid(), current_date);
    select * into v_row
    from public.net_worth_snapshots
    where user_id = auth.uid() and as_of = current_date;
    return v_row;
end $$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------

grant execute on function public.latest_fx_rate(char, char, date)            to authenticated;
grant execute on function public.refresh_my_base_amounts()                   to authenticated;
grant execute on function public.refresh_my_net_worth()                      to authenticated;
grant execute on function public.compute_net_worth_snapshot(uuid, date)      to service_role;

-- -----------------------------------------------------------------------------
-- Nightly snapshots via pg_cron (best-effort: skip where unavailable)
-- -----------------------------------------------------------------------------

do $outer$
begin
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron unavailable, skipping schedule: %', sqlerrm;
        return;
    end;

    if exists (select 1 from cron.job where jobname = 'sagebook-nightly-networth') then
        perform cron.unschedule('sagebook-nightly-networth');
    end if;

    perform cron.schedule(
        'sagebook-nightly-networth',
        '15 0 * * *',
        $job$select public.compute_net_worth_snapshot(u.id, current_date) from auth.users u;$job$
    );
end $outer$;
