-- AI Office · 基线：扩展
-- 从线上项目 nabuuerjahwjsxsfgiuy 导出（版本号是线上当时的实际版本）。
--
-- 这几个扩展都是 Supabase 托管平台提供的。在别的 Postgres 上重建时，
-- pg_cron / pg_net / supabase_vault 不一定存在 —— 见 supabase/schema/README.md。

create extension if not exists pg_cron          with schema pg_catalog;   -- v1.6.4  每分钟触发 runtime
create extension if not exists pg_net           with schema extensions;   -- v0.20.4 数据库里发 HTTP
create extension if not exists pg_stat_statements with schema extensions; -- v1.11
create extension if not exists pgcrypto         with schema extensions;   -- v1.3
create extension if not exists supabase_vault   with schema vault;        -- v0.3.1  金库，存 API Key
create extension if not exists "uuid-ossp"      with schema extensions;   -- v1.1
create extension if not exists vector           with schema extensions;   -- v0.8.2  agent_memories.embedding
