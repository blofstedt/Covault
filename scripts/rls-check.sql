-- ============================================================
-- Covault — access-rule behaviour check
-- ============================================================
-- Signs in as three test accounts on a THROWAWAY database built from
-- supabase/schema.sql and checks that the access rules do what the app relies
-- on: strangers see only themselves, a one-sided partner link reads nothing,
-- a mutual one shares at the chosen level, and the paywall columns cannot be
-- raised by the client. Prints one PASS or FAIL line per check.
--
-- NEVER run this against the live project: it inserts test accounts.
-- scripts/verify-schema.sh runs it; see docs/DATABASE_SETUP.md.
-- ============================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\pset format unaligned

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE EXCEPTION 'This database already has accounts. rls-check.sql is for a throwaway copy only.';
  END IF;
END $$;

-- Three accounts: A and B are partners (once they both agree), C is a stranger.
insert into auth.users (id, email, raw_user_meta_data, aud, role, instance_id) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@test','{"full_name":"A"}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@test','{"full_name":"B"}','authenticated','authenticated','00000000-0000-0000-0000-000000000000'),
 ('cccccccc-0000-0000-0000-000000000003','c@test','{"full_name":"C"}','authenticated','authenticated','00000000-0000-0000-0000-000000000000');

select case when count(*)=3 and bool_and(trial_ends_at > now() and subscription_status='none' and not is_tester)
  then 'PASS sign-up trigger creates one untrusted settings row per account'
  else 'FAIL sign-up trigger' end from public.settings;

insert into public.transactions (user_id, vendor, amount, date, budget) values
 ('aaaaaaaa-0000-0000-0000-000000000001','A-shop',10,'2026-09-01','Groceries'),
 ('bbbbbbbb-0000-0000-0000-000000000002','B-shop',20,'2026-09-01','Groceries'),
 ('cccccccc-0000-0000-0000-000000000003','C-shop',30,'2026-09-01','Groceries');

create function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', uid, true);
$$;

-- 1. Strangers see only themselves.
begin; set local role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select case when string_agg(vendor, ',')='C-shop' then 'PASS a stranger sees only their own purchases' else 'FAIL stranger sees: '||coalesce(string_agg(vendor, ','),'nothing') end from public.transactions;
select case when count(*)=1 then 'PASS a stranger sees only their own settings row' else 'FAIL settings rows visible: '||count(*) end from public.settings;
commit;

-- 2. A one-sided link is not a link: A cannot point at B and read B's money.
update public.settings set partner_id='bbbbbbbb-0000-0000-0000-000000000002' where user_id='aaaaaaaa-0000-0000-0000-000000000001';
begin; set local role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select case when string_agg(vendor, ',')='A-shop' then 'PASS a one-sided partner link reads nothing of the other account' else 'FAIL one-sided link sees: '||string_agg(vendor, ',') end from public.transactions;
commit;

-- 3. Once B points back, A sees B's purchases at the default share level...
update public.settings set partner_id='aaaaaaaa-0000-0000-0000-000000000001' where user_id='bbbbbbbb-0000-0000-0000-000000000002';
begin; set local role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select case when string_agg(vendor, ',' order by vendor)='A-shop,B-shop' then 'PASS a mutual link shares purchases at share level "transactions"' else 'FAIL mutual link sees: '||string_agg(vendor, ',') end from public.transactions;
commit;

-- 4. ...and nothing row-level once B shares totals only.
update public.settings set share_level='totals' where user_id='bbbbbbbb-0000-0000-0000-000000000002';
begin; set local role authenticated; select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select case when string_agg(vendor, ',')='A-shop' then 'PASS share level "totals" hides the partner''s individual purchases' else 'FAIL totals-only sees: '||string_agg(vendor, ',') end from public.transactions;
select case when (select total from public.partner_month_summary('2026-09'))=20 then 'PASS share level "totals" still gives the partner''s month total' else 'FAIL partner total wrong' end;
commit;

-- 5. The stranger still sees nothing of A or B.
begin; set local role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select case when string_agg(vendor, ',')='C-shop' then 'PASS the linked pair stays invisible to a stranger' else 'FAIL stranger now sees: '||string_agg(vendor, ',') end from public.transactions;
commit;

-- 6. Nobody can write a row as someone else, or edit someone else's row.
begin; set local role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  begin
    insert into public.transactions (user_id, vendor, amount, date, budget) values ('aaaaaaaa-0000-0000-0000-000000000001','forged',1,'2026-09-02','Other');
    raise notice 'FAIL a purchase could be inserted into another account';
  exception when insufficient_privilege then raise notice 'PASS a purchase cannot be inserted into another account';
  end;
end $$;
with u as (update public.transactions set amount=999 where vendor='A-shop' returning 1)
select case when count(*)=0 then 'PASS another account''s purchase cannot be edited' else 'FAIL edited another account''s purchase' end from u;
with d as (delete from public.transactions where vendor='A-shop' returning 1)
select case when count(*)=0 then 'PASS another account''s purchase cannot be deleted' else 'FAIL deleted another account''s purchase' end from d;
commit;

-- 7. The paywall columns cannot be raised by the client, on UPDATE or on INSERT.
begin; set local role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  begin
    update public.settings set subscription_status='active' where user_id='cccccccc-0000-0000-0000-000000000003';
    raise notice 'FAIL a client could mark itself subscribed';
  exception when insufficient_privilege then raise notice 'PASS a client cannot mark itself subscribed';
  end;
  begin
    update public.settings set partner_id='aaaaaaaa-0000-0000-0000-000000000001' where user_id='cccccccc-0000-0000-0000-000000000003';
    raise notice 'FAIL a client could set its own partner link directly';
  exception when insufficient_privilege then raise notice 'PASS a client cannot set its partner link directly (only by code)';
  end;
end $$;
commit;
delete from public.settings where user_id='cccccccc-0000-0000-0000-000000000003';
begin; set local role authenticated; select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
do $$ begin
  begin
    insert into public.settings (user_id, name, email, is_tester, subscription_status) values ('cccccccc-0000-0000-0000-000000000003','c','c@test',true,'active');
    raise notice 'FAIL a client could create its settings row already subscribed (the gap still open on live)';
  exception when insufficient_privilege then raise notice 'PASS a client cannot create its settings row already subscribed';
  end;
  begin
    insert into public.settings (user_id, name, email, monthly_income) values ('cccccccc-0000-0000-0000-000000000003','c','c@test',100);
    raise notice 'PASS the app''s own fallback can still create a missing settings row';
  exception when others then raise notice 'FAIL the app''s fallback insert is refused: %', sqlerrm;
  end;
end $$;
commit;

-- 8. Signed out sees nothing at all.
begin; set local role anon;
do $$ begin
  begin
    perform 1 from public.transactions;
    raise notice 'FAIL signed-out can read transactions';
  exception when insufficient_privilege then raise notice 'PASS signed-out cannot read any purchases';
  end;
end $$;
commit;
