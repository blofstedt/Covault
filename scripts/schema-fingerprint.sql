-- ============================================================
-- Covault — schema fingerprint
-- ============================================================
-- One line per part of the database structure (columns, constraints,
-- indexes, access rules, functions, grants, the sign-up trigger, the nightly
-- job), each with a count and a hash. Run it against two databases and
-- compare: equal hashes mean that part is identical.
--
-- Read-only: catalog views only, no table rows. Runs in the Supabase SQL
-- editor, through the read-only Supabase connection, or with psql.
-- scripts/verify-schema.sh runs it against a throwaway copy built from
-- supabase/schema.sql. See docs/DATABASE_SETUP.md.
--
-- Whitespace and comments inside function bodies are ignored, and so is a
-- "public." prefix in policies and triggers, so a tidied but equivalent
-- schema.sql still matches.
-- ============================================================
with lines(cat, line) as (
  select 'enum', t.typname||'|'||(select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)
    from pg_type t where t.typtype='e' and t.typnamespace='public'::regnamespace
  union all
  select 'col', c.relname||'|'||a.attname||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
    from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where c.relnamespace='public'::regnamespace and c.relkind='r'
  union all
  select 'con', k.conrelid::regclass||'|'||k.conname||'|'||pg_get_constraintdef(k.oid)
    from pg_constraint k where k.connamespace='public'::regnamespace
  union all
  select 'idx', pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='public'::regnamespace
  union all
  select 'rls', relname||'|'||relrowsecurity||'|'||relforcerowsecurity
    from pg_class where relnamespace='public'::regnamespace and relkind='r'
  union all
  select 'pol', tablename||'|'||policyname||'|'||permissive||'|'||cmd||'|'||array_to_string(roles,',')||'|'||coalesce(replace(qual,'public.',''),'')||'|'||coalesce(replace(with_check,'public.',''),'')
    from pg_policies where schemaname='public'
  union all
  select 'fn', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||pg_get_function_result(p.oid)||'|'||p.prosecdef||'|'||p.provolatile::text||'|'||(select lanname from pg_language where oid=p.prolang)||'|'||coalesce(array_to_string(p.proconfig,','),'')||'|'||md5(btrim(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '\s+', ' ', 'g')))
    from pg_proc p where p.pronamespace='public'::regnamespace
  union all
  select 'fexec', p.proname||'|'||coalesce(r.rolname,'PUBLIC')
    from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) e
    left join pg_roles r on r.oid=e.grantee
    where p.pronamespace='public'::regnamespace and (e.grantee=0 or r.rolname in ('anon','authenticated','service_role'))
  union all
  select 'tpriv', c.relname||'|'||r||'|'||coalesce((select string_agg(p, ',' order by p) from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p where has_table_privilege(r, c.oid, p)),'')
    from pg_class c cross join unnest(array['anon','authenticated','service_role']) r
    where c.relnamespace='public'::regnamespace and c.relkind='r'
  union all
  select 'cpriv', c.relname||'.'||a.attname||'|'||r||'|'||has_column_privilege(r,c.oid,a.attnum,'SELECT')||has_column_privilege(r,c.oid,a.attnum,'INSERT')||has_column_privilege(r,c.oid,a.attnum,'UPDATE')
    from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    cross join unnest(array['anon','authenticated']) r
    where c.relnamespace='public'::regnamespace and c.relkind='r'
  union all
  select 'trg', c.relnamespace::regnamespace||'.'||c.relname||'|'||t.tgname||'|'||replace(pg_get_triggerdef(t.oid),'public.','')
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where not t.tgisinternal and c.relnamespace in ('public'::regnamespace,'auth'::regnamespace)
  union all
  select 'cmt', c.relname||'.'||coalesce(a.attname,'')||'|'||d.description
    from pg_description d join pg_class c on c.oid=d.objoid and d.classoid='pg_class'::regclass
    left join pg_attribute a on a.attrelid=c.oid and a.attnum=d.objsubid and d.objsubid>0
    where c.relnamespace='public'::regnamespace
  union all
  select 'fcmt', p.proname||'|'||d.description
    from pg_description d join pg_proc p on p.oid=d.objoid and d.classoid='pg_proc'::regclass
    where p.pronamespace='public'::regnamespace
  union all
  select 'cron', jobname||'|'||schedule||'|'||command||'|'||active from cron.job
  union all
  select 'ext', extname from pg_extension where extname in ('pgcrypto','pg_cron','uuid-ossp')
)
select cat, count(*) n, md5(string_agg(line, E'\n' order by line)) h
  from lines group by cat order by cat;
