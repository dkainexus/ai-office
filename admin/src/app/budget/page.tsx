"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { sb, loadSettings, saveBudget, rm, type Settings } from "@/lib/supabase";

type Log = {
  id: number; kind: string; amount: number | null;
  before_rm: number | null; after_rm: number | null; note: string | null; created_at: string;
};

const KIND: Record<string, string> = {
  set_monthly: "改月上限", set_task: "改单任务上限", set_task_topup: "改单任务追加额",
  set_month_topup: "改月追加额", topup_task: "任务追加", topup_month: "月度追加",
};

const FIELDS = [
  ["monthly_cap_rm", "本月上限", "用完后所有任务暂停，并推一条审批给你"],
  ["task_budget_rm", "单任务上限", "只对新建的任务生效"],
  ["task_topup_rm", "单任务追加额", "任务用完预算时，一次追加多少"],
  ["month_topup_rm", "月度追加额", "本月用完时，一次追加多少"],
] as const;

export default function Budget() {
  const [st, setSt] = useState<Settings | null>(null);
  const [month, setMonth] = useState(0);
  const [day, setDay] = useState(0);
  const [log, setLog] = useState<Log[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, m, d, l] = await Promise.all([
      loadSettings(),
      sb.rpc("rt_month_spend"),
      sb.rpc("rt_day_spend"),
      sb.from("budget_log").select("*").order("created_at", { ascending: false }).limit(30),
    ]);
    setSt(s);
    setMonth(Number(m.data) || 0);
    setDay(Number(d.data) || 0);
    setLog((l.data ?? []) as Log[]);
    setForm(Object.fromEntries(FIELDS.map(([k]) => [k, String(s[k] ?? "")])));
  }, []);

  useEffect(() => { load().catch((e) => setMsg("载入失败：" + e.message)); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const n = (k: string) => Number(form[k]);
      if (FIELDS.some(([k]) => !(n(k) > 0))) throw new Error("四个数字都必须大于 0");
      await saveBudget({
        monthly_cap_rm: n("monthly_cap_rm"), task_budget_rm: n("task_budget_rm"),
        task_topup_rm: n("task_topup_rm"), month_topup_rm: n("month_topup_rm"),
      });
      await load();
      setMsg("已保存，改动记进了预算流水");
    } catch (e) {
      setMsg("没保存成功：" + (e as Error).message);
    }
    setBusy(false);
  };

  const cap = Number(st?.monthly_cap_rm) || 0;
  const pct = cap ? Math.min(100, Math.round((month / cap) * 100)) : 0;

  return (
    <Shell title="预算">
      {!st ? (
        <p className="text-sm text-[var(--ink-2)]">载入中…</p>
      ) : (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6">
            <h2 className="mb-4 text-sm font-semibold">花了多少</h2>
            <div className="mb-5 grid grid-cols-2 gap-4">
              <Stat label="今日" value={rm(day)} />
              <Stat label="本月" value={rm(month)} sub={`上限 ${rm(cap)}`} />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--paper-2)]">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: pct >= 90 ? "var(--bad)" : pct >= 70 ? "var(--amber)" : "var(--ok)" }}
              />
            </div>
            <p className="mt-2 text-[11px] text-[var(--ink-2)]">本月用了 {pct}%。按新加坡时间分月。</p>
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6">
            <h2 className="mb-1 text-sm font-semibold">改上限</h2>
            <p className="mb-4 text-[11px] text-[var(--ink-2)]">
              每次改动都会写进下面的流水。单任务上限只影响新任务，已经在跑的不受影响。
            </p>
            <form onSubmit={submit} className="flex flex-col gap-3">
              {FIELDS.map(([k, label, hint]) => (
                <label key={k} className="block">
                  <span className="text-xs text-[var(--ink-2)]">{label}</span>
                  <input
                    type="number" min="1" step="1" required value={form[k] ?? ""}
                    onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                    className="num mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--cobalt)]"
                  />
                  <span className="text-[11px] text-[var(--ink-2)]">{hint}</span>
                </label>
              ))}
              <button disabled={busy} className="mt-1 rounded-lg bg-[var(--cobalt)] py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "保存中…" : "保存"}
              </button>
              {msg && <p className="text-xs text-[var(--ink-2)]">{msg}</p>}
            </form>
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6 lg:col-span-2">
            <h2 className="mb-4 text-sm font-semibold">预算流水</h2>
            {log.length === 0 ? (
              <p className="text-sm text-[var(--ink-2)]">还没有改动记录。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-2)]">
                      <th className="pb-2 pr-4 font-medium">时间</th>
                      <th className="pb-2 pr-4 font-medium">动作</th>
                      <th className="pb-2 pr-4 font-medium">改前</th>
                      <th className="pb-2 pr-4 font-medium">改后</th>
                      <th className="pb-2 font-medium">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.map((l) => (
                      <tr key={l.id} className="border-b border-[var(--line)] last:border-0">
                        <td className="num whitespace-nowrap py-2 pr-4 text-xs text-[var(--ink-2)]">
                          {new Date(l.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-4">{KIND[l.kind] ?? l.kind}</td>
                        <td className="num py-2 pr-4 text-[var(--ink-2)]">{l.before_rm != null ? rm(l.before_rm) : "—"}</td>
                        <td className="num py-2 pr-4">{l.after_rm != null ? rm(l.after_rm) : "—"}</td>
                        <td className="py-2 text-[var(--ink-2)]">{l.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Shell>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--ink-2)]">{label}</div>
      <div className="num text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-[var(--ink-2)]">{sub}</div>}
    </div>
  );
}
