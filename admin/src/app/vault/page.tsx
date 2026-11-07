"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { sb } from "@/lib/supabase";

// 只取非机密字段。secret_id 永远不下发到前端 —— 它是 Vault 里那条密钥的指针。
const SAFE = "id,name,kind,needs_approval,uses,last_used_at";

type Item = {
  id: string; name: string; kind: string;
  needs_approval: boolean; uses: number; last_used_at: string | null;
};

export default function Vault() {
  const [items, setItems] = useState<Item[]>([]);
  const [ok, setOk] = useState<Set<string>>(new Set());
  const [val, setVal] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [v, s] = await Promise.all([
      sb.from("vault_items").select(SAFE).order("id"),
      sb.rpc("secret_status"),
    ]);
    setItems((v.data ?? []) as Item[]);
    setOk(new Set(((s.data ?? []) as { item_id: string; configured: boolean }[]).filter((x) => x.configured).map((x) => x.item_id)));
    setLoaded(true);
  }, []);

  useEffect(() => { load().catch(() => setLoaded(true)); }, [load]);

  const save = async (it: Item) => {
    const v = (val[it.id] ?? "").trim();
    if (!v) { setMsg({ ...msg, [it.id]: "先填新值" }); return; }
    setBusy(it.id); setMsg({ ...msg, [it.id]: "" });
    // set_secret 自己会查 is_owner()，值直接进 Vault，不经过任何表
    const { error } = await sb.rpc("set_secret", { p_item_id: it.id, p_name: it.name, p_kind: it.kind, p_value: v });
    setBusy("");
    if (error) { setMsg({ ...msg, [it.id]: "没存进去：" + error.message }); return; }
    setVal({ ...val, [it.id]: "" });
    setMsg({ ...msg, [it.id]: "已替换" });
    load();
  };

  return (
    <Shell title="金库">
      <p className="mb-6 max-w-2xl text-xs leading-relaxed text-[var(--ink-2)]">
        密钥存在 Supabase Vault 里，这个页面只知道「配了没配」，读不到内容，Agent 也读不到 ——
        它们只能请求调用，由后台代为注入。想换值就填新的，没有「查看」这个操作。
      </p>

      {!loaded ? (
        <p className="text-sm text-[var(--ink-2)]">载入中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--ink-2)]">金库里还没有凭证。</p>
      ) : (
        <div className="grid max-w-4xl gap-3">
          {items.map((it) => {
            const set = ok.has(it.id);
            return (
              <div key={it.id} className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{it.name}</span>
                  <code className="rounded bg-[var(--paper-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-2)]">{it.id}</code>
                  <span className="rounded bg-[var(--paper-2)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)]">{it.kind}</span>
                  {it.needs_approval && (
                    <span className="rounded bg-[var(--amber-soft)] px-1.5 py-0.5 text-[11px] text-[var(--amber)]">每次需批准</span>
                  )}
                  <span className={`ml-auto text-[11px] ${set ? "text-[var(--ok)]" : "text-[var(--bad)]"}`}>
                    {set ? "● 已配置" : "○ 未配置"}
                  </span>
                </div>

                <div className="mb-3 text-[11px] text-[var(--ink-2)]">
                  已调用 {it.uses} 次
                  {it.last_used_at && ` · 最近 ${new Date(it.last_used_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}`}
                </div>

                <div className="flex flex-wrap gap-2">
                  <input
                    type="password" autoComplete="off" placeholder={set ? "输入新值可替换" : "填入密钥"}
                    value={val[it.id] ?? ""} onChange={(e) => setVal({ ...val, [it.id]: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-mono text-sm outline-none focus:border-[var(--cobalt)]"
                  />
                  <button
                    onClick={() => save(it)} disabled={busy === it.id}
                    className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm hover:bg-[var(--paper-2)] disabled:opacity-50"
                  >
                    {busy === it.id ? "保存中…" : "保存"}
                  </button>
                </div>
                {msg[it.id] && <p className="mt-2 text-xs text-[var(--ink-2)]">{msg[it.id]}</p>}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
