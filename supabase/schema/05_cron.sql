-- AI Office · 基线：定时任务
-- 从线上项目 nabuuerjahwjsxsfgiuy 导出。可重复执行。
--
-- 这是整个公司的心跳：每分钟敲一次 runtime，runtime 自己决定有没有活干。
-- 用 x-admin-key 鉴权（值从 Vault 里的 tg_admin 取），所以 runtime 这个
-- Edge Function 必须保持 verify_jwt: false，否则这里会被 401 挡掉，公司就停了。
--
-- 依赖：vault_items 里要有 id = 'tg_admin' 的记录，且密钥已写入 Vault。
-- 新建项目时先跑 set_secret('tg_admin', ...) 再建这个定时任务。

select cron.unschedule('ai-office-runtime')
where exists (select 1 from cron.job where jobname = 'ai-office-runtime');

select cron.schedule('ai-office-runtime', '* * * * *', $job$
  select net.http_post(
    url := 'https://nabuuerjahwjsxsfgiuy.supabase.co/functions/v1/runtime',
    headers := jsonb_build_object('Content-Type','application/json','x-admin-key', public.tg_secret('tg_admin')),
    body := '{}'::jsonb, timeout_milliseconds := 10000);
$job$);
