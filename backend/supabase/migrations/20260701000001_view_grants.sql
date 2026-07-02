-- Grant SELECT on summary views to authenticated users.
-- security_invoker ensures RLS on the underlying tables still applies.

grant select on public.v_pending_review    to authenticated;
grant select on public.v_monthly_summary   to authenticated;
grant select on public.v_category_summary  to authenticated;
grant select on public.rules               to authenticated;

-- Also ensure the find_duplicate function is callable by authenticated users
grant execute on function public.find_duplicate(uuid, text, numeric, timestamptz, uuid)
    to authenticated;

grant execute on function public.seed_default_categories(uuid)
    to service_role;
