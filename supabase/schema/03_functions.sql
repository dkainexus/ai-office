-- AI Office · 基线：函数与触发器
-- 从线上项目 nabuuerjahwjsxsfgiuy 导出。可重复执行（全部是 create or replace）。
--
-- 鉴权约定（和 supabase/functions/*/index.ts 对应）：
--   is_owner()                只认 auth.uid() 是否在 owners 表里
--   set_secret / set_budget   给了 authenticated，但函数体里自己查 is_owner()
--   tg_secret / rt_set_secret 只给 service_role，网页端拿不到（见 04_rls.sql 的授权）
-- 这里没有任何密钥的字面值，密钥都在 Supabase Vault 里，运行时才读。

-- ---------- 身份 ----------

create or replace function public.is_owner()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (select 1 from public.owners where user_id = auth.uid());
$function$;

-- ---------- 花费与预算 ----------

create or replace function public.rt_add_cost(p_task text, p_rm numeric)
 returns void
 language sql
 set search_path to ''
as $function$
  update public.tasks set cost = cost + p_rm, updated_at = now() where id = p_task;
$function$;

-- 日/月花费都按新加坡时间切分。
create or replace function public.rt_day_spend()
 returns numeric
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(sum(cost),0) from public.model_calls
  where created_at >= (date_trunc('day', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore');
$function$;

create or replace function public.rt_month_spend()
 returns numeric
 language sql
 stable
 set search_path to ''
as $function$
  select coalesce(sum(cost),0) from public.model_calls
  where created_at >= (date_trunc('month', now() at time zone 'Asia/Singapore') at time zone 'Asia/Singapore');
$function$;

create or replace function public.set_budget(p_month numeric, p_task numeric, p_task_topup numeric, p_month_topup numeric)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare d jsonb;
begin
  if not public.is_owner() then raise exception 'not allowed'; end if;
  if p_month is null or p_month <= 0 or p_task <= 0 or p_task_topup <= 0 or p_month_topup <= 0 then raise exception '金额必须大于 0'; end if;
  select data into d from public.runtime_settings where id = 1 for update;
  if (d->>'monthly_cap_rm')::numeric is distinct from p_month then
    insert into public.budget_log(kind, before_rm, after_rm, note) values ('set_monthly', (d->>'monthly_cap_rm')::numeric, p_month, 'Dave 在后台修改');
  end if;
  if (d->>'task_budget_rm')::numeric is distinct from p_task then
    insert into public.budget_log(kind, before_rm, after_rm, note) values ('set_task', (d->>'task_budget_rm')::numeric, p_task, 'Dave 在后台修改（对新任务生效）');
  end if;
  if (d->>'task_topup_rm')::numeric is distinct from p_task_topup then
    insert into public.budget_log(kind, before_rm, after_rm, note) values ('set_task_topup', (d->>'task_topup_rm')::numeric, p_task_topup, 'Dave 在后台修改');
  end if;
  if (d->>'month_topup_rm')::numeric is distinct from p_month_topup then
    insert into public.budget_log(kind, before_rm, after_rm, note) values ('set_month_topup', (d->>'month_topup_rm')::numeric, p_month_topup, 'Dave 在后台修改');
  end if;
  update public.runtime_settings set data = d || jsonb_build_object('monthly_cap_rm', p_month, 'task_budget_rm', p_task, 'task_topup_rm', p_task_topup, 'month_topup_rm', p_month_topup), updated_at = now() where id = 1;
end $function$;

-- ---------- 任务认领 ----------
-- 三个 rt_claim_* 都用 for update skip locked，所以多个 runtime 实例同时跑也不会
-- 认领到同一条；另外都带 10 分钟超时回收，进程中途挂掉的任务会被重新捡起来。

create or replace function public.rt_claim_plan()
 returns setof public.tasks
 language sql
 set search_path to ''
as $function$
  update public.tasks t set status = 'planning_run', started_at = now(), updated_at = now()
  where t.id = (select id from public.tasks
                where status = 'planning' or (status = 'planning_run' and updated_at < now() - interval '10 minutes')
                order by created_at limit 1 for update skip locked)
  returning t.*;
$function$;

create or replace function public.rt_claim_sub()
 returns setof public.subtasks
 language sql
 set search_path to ''
as $function$
  update public.subtasks s set status = 'doing', started_at = now(), attempts = s.attempts + 1
  where s.id = (select s2.id from public.subtasks s2 join public.tasks t on t.id = s2.task_id
                where t.status = 'active'
                  and (s2.status = 'todo' or (s2.status = 'doing' and s2.started_at < now() - interval '10 minutes'))
                  and not exists (select 1 from public.subtasks p where p.task_id = s2.task_id and p.seq < s2.seq and p.status <> 'done')
                order by t.created_at, s2.seq, s2.created_at limit 1 for update of s2 skip locked)
  returning s.*;
$function$;

create or replace function public.rt_claim_conclude()
 returns setof public.tasks
 language sql
 set search_path to ''
as $function$
  update public.tasks t set status = 'concluding', updated_at = now()
  where t.id = (select t2.id from public.tasks t2
                where (t2.status = 'active'
                       and exists (select 1 from public.subtasks s where s.task_id = t2.id)
                       and not exists (select 1 from public.subtasks s where s.task_id = t2.id and s.status <> 'done'))
                   or (t2.status = 'concluding' and t2.updated_at < now() - interval '10 minutes')
                order by t2.created_at limit 1 for update skip locked)
  returning t.*;
$function$;

-- ---------- 金库 ----------
-- 密钥值只进 Vault，vault_items 里只存 secret_id。
-- secret_status 只回「配没配」，不回内容；tg_secret 会回明文，所以不授权给网页端。

create or replace function public.set_secret(p_item_id text, p_name text, p_kind text, p_value text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_secret uuid;
begin
  if not public.is_owner() then raise exception 'not allowed'; end if;
  if coalesce(length(p_value),0) = 0 then raise exception 'empty secret'; end if;
  select secret_id into v_secret from public.vault_items where id = p_item_id;
  if v_secret is null then
    v_secret := vault.create_secret(p_value, 'office_' || p_item_id, p_name);
    insert into public.vault_items(id, name, kind, secret_id) values (p_item_id, p_name, p_kind, v_secret)
      on conflict (id) do update set secret_id = excluded.secret_id, name = excluded.name, kind = excluded.kind;
  else
    perform vault.update_secret(v_secret, p_value);
  end if;
end $function$;

-- 和 set_secret 一样，但不查 is_owner：只给 service_role（Edge Function 用），
-- 网页端没有执行权限。见 04_rls.sql。
create or replace function public.rt_set_secret(p_item_id text, p_name text, p_kind text, p_value text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_secret uuid;
begin
  select secret_id into v_secret from public.vault_items where id = p_item_id;
  if v_secret is null then
    v_secret := vault.create_secret(p_value, 'office_' || p_item_id, p_name);
    insert into public.vault_items(id, name, kind, secret_id) values (p_item_id, p_name, p_kind, v_secret)
      on conflict (id) do update set secret_id = excluded.secret_id;
  else
    perform vault.update_secret(v_secret, p_value);
  end if;
end $function$;

create or replace function public.secret_status()
 returns table(item_id text, configured boolean)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select id, secret_id is not null from public.vault_items where public.is_owner();
$function$;

create or replace function public.tg_secret(p_id text)
 returns text
 language sql
 stable security definer
 set search_path to ''
as $function$
  select d.decrypted_secret from public.vault_items v join vault.decrypted_secrets d on d.id = v.secret_id where v.id = p_id;
$function$;

-- ---------- 自动升级流程 ----------
-- 对应 UPGRADE.md。propose_upgrade 建提案并推 Telegram 审批，
-- 审批结果经 decisions 的触发器回写提案状态，upgrade_report 收尾。

create or replace function public.propose_upgrade(p_problem text, p_evidence text, p_plan text, p_impact text, p_eta text, p_feedback_ids bigint[] default '{}'::bigint[])
 returns bigint
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare pid bigint; did text; detail text; opts jsonb := '[["批准，开始做","yes"],["不做","no"]]'::jsonb;
begin
  insert into public.upgrade_proposals(problem, evidence, plan, impact, eta) values (p_problem, p_evidence, p_plan, p_impact, p_eta) returning id into pid;
  did := 'upgrade-' || pid;
  update public.upgrade_proposals set decision_id = did where id = pid;
  update public.feedback set status = 'proposed', proposal_id = pid where id = any(p_feedback_ids);
  detail := '问题：' || p_problem
    || case when coalesce(p_evidence,'') <> '' then E'\n证据：' || p_evidence else '' end
    || E'\n\n方案：' || p_plan
    || case when coalesce(p_impact,'') <> '' then E'\n影响范围：' || p_impact else '' end
    || case when coalesce(p_eta,'') <> '' then E'\n预计：' || p_eta else '' end;
  insert into public.decisions(id, title, detail, review, options, status, kind)
    values (did, '系统升级：' || left(p_problem, 60), detail, '批准后自动开发、检查、上线；检查不通过不会上线，会告诉你原因', opts, 'pending', 'upgrade');
  perform net.http_post(
    url := 'https://nabuuerjahwjsxsfgiuy.supabase.co/functions/v1/telegram',
    headers := jsonb_build_object('Content-Type','application/json','x-admin-key', public.tg_secret('tg_admin')),
    body := jsonb_build_object('action','decision','ref',did,'title','系统升级：' || left(p_problem, 60),'from','系统巡检','role','自动升级',
                               'detail',detail,'rev','批准后自动开发、检查、上线；检查不通过不会上线','opts',opts),
    timeout_milliseconds := 10000);
  return pid;
end $function$;

create or replace function public.upgrade_report(p_id bigint, p_status text, p_result text, p_sha text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare pr record; title text;
begin
  update public.upgrade_proposals set status = p_status, result = p_result, commit_sha = coalesce(p_sha, commit_sha), updated_at = now()
    where id = p_id returning * into pr;
  if p_status = 'shipped' then update public.feedback set status = 'done' where proposal_id = p_id; end if;
  if p_status in ('shipped','failed') then
    title := case when p_status = 'shipped' then '升级已上线：' else '升级没有上线：' end || left(pr.problem, 60);
    perform net.http_post(
      url := 'https://nabuuerjahwjsxsfgiuy.supabase.co/functions/v1/telegram',
      headers := jsonb_build_object('Content-Type','application/json','x-admin-key', public.tg_secret('tg_admin')),
      body := jsonb_build_object('action','report','ref','upgrade-' || p_id || '-' || p_status || '-' || extract(epoch from now())::bigint,
                                 'title', title, 'from', '系统升级', 'text', p_result),
      timeout_milliseconds := 10000);
  end if;
end $function$;

create or replace function public.on_upgrade_decision()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.kind = 'upgrade' and old.status = 'pending' and new.status in ('approved','rejected') then
    update public.upgrade_proposals set status = new.status, updated_at = now()
      where decision_id = new.id and status = 'pending';
  end if;
  return new;
end $function$;

-- ---------- 触发器 ----------

drop trigger if exists upgrade_decision on public.decisions;
create trigger upgrade_decision
  after update of status on public.decisions
  for each row execute function public.on_upgrade_decision();
