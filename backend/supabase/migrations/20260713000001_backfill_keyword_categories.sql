-- Backfill uncategorized transactions using keyword inference.
-- Matches payee || memo text against common keywords and assigns the
-- corresponding default category. Only touches rows where category_id IS NULL.

do $$
declare
  r record;
  kw_rules jsonb := '[
    {"keywords":["value added tax","vat ","stamp duty","sms alert","account maintenance","bank charge","bank fee","service charge","withholding tax","commission","atm charge","card maintenance"],"category":"Fees & Charges"},
    {"keywords":["supermarket","grocery","groceries","market","foodstuff","shoprite","spar ","game stores"],"category":"Groceries"},
    {"keywords":["restaurant","eatery","kitchen","chicken republic","kfc","dominos","pizza","cafe","bakery","suya","food"],"category":"Food & Dining"},
    {"keywords":["uber","bolt","taxi","fuel","petrol","filling station","tollgate","parking","transport"],"category":"Transport"},
    {"keywords":["electricity","power","phcn","ekedc","ikedc","dstv","gotv","startimes","cable","internet","isp","airtime","mtn","glo","airtel","9mobile","data bundle","water board"],"category":"Utilities"},
    {"keywords":["pharmacy","hospital","clinic","medical","health","diagnostic","laboratory"],"category":"Health"},
    {"keywords":["school","university","college","tuition","education","academy","institute"],"category":"Education"},
    {"keywords":["netflix","spotify","youtube","apple.com","google play","amazon prime","subscription","icloud"],"category":"Subscriptions"},
    {"keywords":["cinema","film house","concert","event","tickets","entertainment","betting","bet9ja","sportybet"],"category":"Entertainment"},
    {"keywords":["shopping","mall","store","amazon","jumia","konga","aliexpress"],"category":"Shopping"},
    {"keywords":["airline","flight","hotel","booking","travel","air peace","dana air","arik"],"category":"Travel"},
    {"keywords":["salary","payroll","wage"],"category":"Salary"},
    {"keywords":["savings","fixed deposit","piggyvest","cowrywise"],"category":"Savings & Deposits"},
    {"keywords":["transfer","trf"],"category":"Transfer"}
  ]';
  rule_entry jsonb;
  kw text;
  matched_cat text;
  cat_id uuid;
begin
  -- Process each uncategorized transaction
  for r in
    select t.id, t.user_id,
           lower(coalesce(t.payee, '') || ' ' || coalesce(t.memo, '')) as search_text
    from transactions t
    where t.category_id is null
  loop
    matched_cat := null;

    -- Try each keyword rule in order (first match wins)
    for rule_entry in select * from jsonb_array_elements(kw_rules)
    loop
      if matched_cat is not null then exit; end if;

      for kw in select * from jsonb_array_elements_text(rule_entry -> 'keywords')
      loop
        if r.search_text like '%' || kw || '%' then
          matched_cat := rule_entry ->> 'category';
          exit;
        end if;
      end loop;
    end loop;

    -- Resolve category name to user's category id and update
    if matched_cat is not null then
      select c.id into cat_id
      from categories c
      where c.user_id = r.user_id
        and lower(c.name) = lower(matched_cat)
      limit 1;

      if cat_id is not null then
        update transactions
        set category_id = cat_id
        where id = r.id;
      end if;
    end if;
  end loop;
end $$;
