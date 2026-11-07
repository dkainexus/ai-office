-- 只给 checks/schema-rebuild.js 用的替身，**不是线上结构的一部分**，不要拿去建生产库。
--
-- 基线 SQL 里引用了几样只有 Supabase 平台才有的东西：auth.users / auth.uid()、
-- Vault、pg_net。本地那个空 Postgres 没有它们，函数体会在创建时就报错。
-- 这里建最小替身，好让「表、约束、索引、15 个函数、触发器、17 条策略、授权」
-- 这些真正属于我们自己的东西能被真跑一遍。
--
-- 替身只保证签名对得上，不保证行为一样。

create schema if not exists auth;
create schema if not exists vault;
create schema if not exists net;
create schema if not exists extensions;

-- Supabase 的三个角色
do $$ begin create role anon          nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role  nologin; exception when duplicate_object then null; end $$;

-- auth
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

-- vault
create table if not exists vault.decrypted_secrets (id uuid primary key, decrypted_secret text);
create or replace function vault.create_secret(p_secret text, p_name text default null, p_description text default null)
  returns uuid language sql as $$ select gen_random_uuid() $$;
create or replace function vault.update_secret(p_id uuid, p_secret text default null, p_name text default null, p_description text default null)
  returns void language sql as $$ select $$;

-- pg_net
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
                                         headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)
  returns bigint language sql as $$ select 0::bigint $$;
