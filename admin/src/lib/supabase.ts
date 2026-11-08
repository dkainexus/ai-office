import { createClient } from "@supabase/supabase-js";

// anon key 是设计上就公开的，挡住数据的是数据库里的 RLS 策略（全表 owner-only），
// 不是这把 key。它本来就写在 3D 页的 index.html 里，仓库也是公开的。
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY，看 .env.example");
}

export const sb = createClient(url, key);

// 3D 页用的是同一套凭据：用户名拼成 <用户名>@office.dkglobal.group
//
// 别动这个字符串。它不是网址，是 Supabase auth 里那条账号记录的一部分。
// 办公室已经搬到 office.dkainexus.com，但账号还是建在旧域名上的，
// 改成新域名就等于拿一个不存在的账号去登录，Owner 会被锁在外面。
// 要换的话得先在 Supabase 改 auth.users 里的 email，再改这里和 index.html。
export const EMAIL_DOMAIN = "office.dkglobal.group";

export type Settings = {
  monthly_cap_rm?: number;
  task_budget_rm?: number;
  task_topup_rm?: number;
  month_topup_rm?: number;
  usd_myr?: number;
  daily_brief_hour?: number;
  stuck_after_min?: number;
  paused?: boolean;
  models?: { smart?: string[]; fast?: string[] };
  prices_usd_per_mtok?: Record<string, [number, number]>;
};

export async function loadSettings(): Promise<Settings> {
  const { data, error } = await sb.from("runtime_settings").select("data").eq("id", 1).single();
  if (error) throw error;
  return (data?.data ?? {}) as Settings;
}

// 预算必须走 set_budget()：它会把每一次改动写进 budget_log，直接改表就没有流水了。
export async function saveBudget(s: Required<Pick<Settings, "monthly_cap_rm" | "task_budget_rm" | "task_topup_rm" | "month_topup_rm">>) {
  const { error } = await sb.rpc("set_budget", {
    p_month: s.monthly_cap_rm,
    p_task: s.task_budget_rm,
    p_task_topup: s.task_topup_rm,
    p_month_topup: s.month_topup_rm,
  });
  if (error) throw error;
}

// 其余设置没有专用 RPC，按表更新（RLS 只放行 Owner）。
// 只合并传进来的键，避免把整份 data 覆盖掉。
export async function patchSettings(patch: Settings) {
  const cur = await loadSettings();
  const { error } = await sb
    .from("runtime_settings")
    .update({ data: { ...cur, ...patch }, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

export const rm = (n: number) => "RM " + (Number(n) || 0).toFixed(2);
