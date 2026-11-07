-- AI Office · 基线：行级安全、策略、授权
-- 从线上项目 nabuuerjahwjsxsfgiuy 导出。可重复执行。
--
-- 结构是「单 Owner」：18 张表全开 RLS，17 张挂 owner-only 策略，
-- oauth_states 开了 RLS 但故意不挂任何策略 —— 对 anon / authenticated 全拒绝，
-- 只有 service_role（Edge Function）能读写它。OAuth 的 state 不该让浏览器碰。
--
-- 注意：anon / authenticated 在表上有 grant，真正拦住他们的是下面的 RLS 策略，
-- 这是 Supabase 的标准做法。删掉策略 = 数据对所有登录用户敞开。

-- ---------- 开启 RLS ----------

alter table public.agent_memories     enable row level security;
alter table public.agents             enable row level security;
alter table public.budget_log         enable row level security;
alter table public.decisions          enable row level security;
alter table public.feedback           enable row level security;
alter table public.integrations       enable row level security;
alter table public.messages           enable row level security;
alter table public.model_calls        enable row level security;
alter table public.oauth_states       enable row level security;
alter table public.office_state       enable row level security;
alter table public.owners             enable row level security;
alter table public.runtime_settings   enable row level security;
alter table public.subtasks           enable row level security;
alter table public.tasks              enable row level security;
alter table public.telegram_actions   enable row level security;
alter table public.telegram_messages  enable row level security;
alter table public.upgrade_proposals  enable row level security;
alter table public.vault_items        enable row level security;

-- ---------- 策略 ----------

drop policy if exists "owner full access" on public.agent_memories;
create policy "owner full access" on public.agent_memories as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.agents;
create policy "owner full access" on public.agents as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 预算流水只读：改预算要走 set_budget()，这样每次改动都会留下 budget_log。
drop policy if exists "owner read" on public.budget_log;
create policy "owner read" on public.budget_log as permissive for select to authenticated
  using (public.is_owner());

drop policy if exists "owner full access" on public.decisions;
create policy "owner full access" on public.decisions as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.feedback;
create policy "owner full access" on public.feedback as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.integrations;
create policy "owner full access" on public.integrations as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.messages;
create policy "owner full access" on public.messages as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.model_calls;
create policy "owner full access" on public.model_calls as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.office_state;
create policy "owner full access" on public.office_state as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- owners 表例外：用自己的 user_id 比对，不走 is_owner()，否则会无限递归。
drop policy if exists "owners read self" on public.owners;
create policy "owners read self" on public.owners as permissive for select to authenticated
  using ((user_id = auth.uid()));

drop policy if exists "owner full access" on public.runtime_settings;
create policy "owner full access" on public.runtime_settings as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.subtasks;
create policy "owner full access" on public.subtasks as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.tasks;
create policy "owner full access" on public.tasks as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.telegram_actions;
create policy "owner full access" on public.telegram_actions as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

drop policy if exists "owner full access" on public.telegram_messages;
create policy "owner full access" on public.telegram_messages as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- 升级提案只读：状态由 propose_upgrade / upgrade_report / 触发器改。
drop policy if exists "owner read" on public.upgrade_proposals;
create policy "owner read" on public.upgrade_proposals as permissive for select to authenticated
  using (public.is_owner());

-- 只放 secret_id，不放密钥值。
drop policy if exists "owner full access" on public.vault_items;
create policy "owner full access" on public.vault_items as permissive for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- public.oauth_states 故意没有策略：对客户端全拒绝。

-- ---------- 表授权 ----------
-- Supabase 默认：角色拿到表权限，由 RLS 把关。

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- ---------- 函数授权 ----------
-- 先全部收回，再按最小需要发放。网页端（authenticated）只拿到 6 个，
-- 其中会动数据的 set_secret / set_budget 在函数体里自己查 is_owner()。

revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_owner()        to authenticated, service_role;
grant execute on function public.rt_day_spend()    to authenticated, service_role;
grant execute on function public.rt_month_spend()  to authenticated, service_role;
grant execute on function public.secret_status()   to authenticated, service_role;
grant execute on function public.set_budget(numeric, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.set_secret(text, text, text, text)             to authenticated, service_role;

-- 下面这些只给 service_role —— Edge Function 用 service role key 调。
-- tg_secret 会返回解密后的密钥明文，绝不能给 authenticated。
grant execute on function public.tg_secret(text)      to service_role;
grant execute on function public.rt_set_secret(text, text, text, text) to service_role;
grant execute on function public.rt_add_cost(text, numeric) to service_role;
grant execute on function public.rt_claim_plan()      to service_role;
grant execute on function public.rt_claim_sub()       to service_role;
grant execute on function public.rt_claim_conclude()  to service_role;
grant execute on function public.propose_upgrade(text, text, text, text, text, bigint[]) to service_role;
grant execute on function public.upgrade_report(bigint, text, text, text) to service_role;
grant execute on function public.on_upgrade_decision() to service_role;
