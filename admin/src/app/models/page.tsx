"use client";

import { useCallback, useEffect, useState } from "react";
import Shell from "@/components/Shell";
import { loadSettings, patchSettings, type Settings } from "@/lib/supabase";

// runtime 里的实际行为：先按本档顺序逐个试，全失败再去试另一档。
// 所以这两行的顺序就是真实的降级顺序。
const TIERS = [
  { key: "smart" as const, label: "重要 / 技术", hint: "拆解、验收，以及总监 / 项目经理 / 主管 / 工程师执行的步骤" },
  { key: "fast" as const, label: "日常", hint: "其余职位执行的步骤" },
];

export default function Models() {
  const [st, setSt] = useState<Settings | null>(null);
  const [smart, setSmart] = useState("");
  const [fast, setFast] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await loadSettings();
    setSt(s);
    setSmart((s.models?.smart ?? []).join("\n"));
    setFast((s.models?.fast ?? []).join("\n"));
  }, []);

  useEffect(() => { load().catch((e) => setMsg("载入失败：" + e.message)); }, [load]);

  const parse = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      const a = parse(smart), b = parse(fast);
      if (!a.length || !b.length) throw new Error("两档都至少要有一个模型");
      const bad = [...a, ...b].filter((x) => !/^(anthropic|openai):.+/.test(x));
      if (bad.length) throw new Error(`格式不对：${bad.join("、")}。每行要写成 anthropic:模型名 或 openai:模型名`);
      await patchSettings({ models: { smart: a, fast: b } });
      await load();
      setMsg("已保存。下一分钟 runtime 就会用新的路由。");
    } catch (e) {
      setMsg("没保存成功：" + (e as Error).message);
    }
    setBusy(false);
  };

  const prices = Object.entries(st?.prices_usd_per_mtok ?? {});

  return (
    <Shell title="模型路由">
      {!st ? (
        <p className="text-sm text-[var(--ink-2)]">载入中…</p>
      ) : (
        <div className="grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_1fr]">
          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6">
            <h2 className="mb-1 text-sm font-semibold">两档链路</h2>
            <p className="mb-4 text-[11px] leading-relaxed text-[var(--ink-2)]">
              一行一个，<code className="font-mono">厂商:模型名</code>。从上往下依次尝试，
              某一行失败就试下一行；整档都失败，才去试另一档。所以顺序就是降级顺序。
            </p>
            <form onSubmit={submit} className="flex flex-col gap-4">
              {TIERS.map((t) => (
                <label key={t.key} className="block">
                  <span className="text-xs font-medium">{t.label}</span>
                  <span className="mb-1 block text-[11px] text-[var(--ink-2)]">{t.hint}</span>
                  <textarea
                    rows={4} spellCheck={false}
                    value={t.key === "smart" ? smart : fast}
                    onChange={(e) => (t.key === "smart" ? setSmart : setFast)(e.target.value)}
                    className="w-full resize-y rounded-lg border border-[var(--line)] bg-white px-3 py-2 font-mono text-[13px] outline-none focus:border-[var(--cobalt)]"
                  />
                </label>
              ))}
              <button disabled={busy} className="rounded-lg bg-[var(--cobalt)] py-2.5 text-sm font-medium text-white disabled:opacity-50">
                {busy ? "保存中…" : "保存"}
              </button>
              {msg && <p className="text-xs text-[var(--ink-2)]">{msg}</p>}
            </form>
          </section>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-6">
            <h2 className="mb-1 text-sm font-semibold">价目表</h2>
            <p className="mb-4 text-[11px] leading-relaxed text-[var(--ink-2)]">
              每百万 token 的美元价，[输入, 输出]。花费就是按这张表算的 ——
              表里没有的模型按 [3, 15] 估，所以新模型记得加进来，否则账目会偏。
              汇率 1 USD = {st.usd_myr ?? 4.25} MYR。
            </p>
            {prices.length === 0 ? (
              <p className="text-sm text-[var(--ink-2)]">还没有价目表。</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs text-[var(--ink-2)]">
                    <th className="pb-2 font-medium">模型</th>
                    <th className="pb-2 text-right font-medium">输入</th>
                    <th className="pb-2 text-right font-medium">输出</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map(([m, p]) => (
                    <tr key={m} className="border-b border-[var(--line)] last:border-0">
                      <td className="py-2 font-mono text-[12px]">{m}</td>
                      <td className="num py-2 text-right">${p?.[0]}</td>
                      <td className="num py-2 text-right">${p?.[1]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-[11px] text-[var(--ink-2)]">价目表暂时只读，改它要先想清楚会不会让历史账目对不上。</p>
          </section>
        </div>
      )}
    </Shell>
  );
}
