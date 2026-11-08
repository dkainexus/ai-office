"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { sb } from "@/lib/supabase";

const NAV = [
  { href: "/budget", label: "预算", hint: "上限与追加额" },
  { href: "/vault", label: "金库", hint: "API Key 与凭证" },
  { href: "/models", label: "模型路由", hint: "重要 / 日常各走哪条链" },
];

type Gate = "checking" | "anon" | "notowner" | "ok";

export default function Shell({ children, title }: { children: React.ReactNode; title: string }) {
  const [gate, setGate] = useState<Gate>("checking");
  const [who, setWho] = useState("");
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const { data: { session } } = await sb.auth.getSession();
      if (!alive) return;
      if (!session) { setGate("anon"); return; }
      setWho(session.user.email?.split("@")[0] ?? "");
      // 光有登录不够：后台只给 Owner。is_owner() 查的是 owners 表，
      // 和数据库里全表 RLS 用的是同一个判断。
      const { data, error } = await sb.rpc("is_owner");
      if (!alive) return;
      setGate(!error && data === true ? "ok" : "notowner");
    };
    check();
    const { data: sub } = sb.auth.onAuthStateChange(() => check());
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  if (gate === "checking") return <Center>正在确认身份…</Center>;

  if (gate === "anon") {
    router.replace("/login");
    return <Center>正在转到登录…</Center>;
  }

  if (gate === "notowner") {
    return (
      <Center>
        <div className="max-w-sm text-center">
          <p className="mb-2 font-semibold text-[var(--bad)]">这个账号不是 Owner</p>
          <p className="text-sm text-[var(--ink-2)]">
            后台只对 <code className="font-mono">owners</code> 表里的账号开放。换个账号登录，或者让 Owner 把你加进去。
          </p>
          <button onClick={() => sb.auth.signOut()} className="mt-4 rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm hover:bg-[var(--paper-2)]">
            退出登录
          </button>
        </div>
      </Center>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-[var(--line)] bg-[var(--paper)] p-5">
        <div className="mb-7">
          <div className="font-[family-name:var(--f-display)] text-[13px] font-bold tracking-wide">DK GLOBAL GROUP</div>
          <div className="text-xs text-[var(--ink-2)]">AI Office 后台</div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const on = path === n.href;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-lg px-3 py-2 text-sm transition ${
                  on ? "bg-[var(--cobalt)] text-white" : "text-[var(--ink)] hover:bg-[var(--paper-2)]"
                }`}
              >
                <div className="font-medium">{n.label}</div>
                <div className={`text-[11px] ${on ? "text-white/70" : "text-[var(--ink-2)]"}`}>{n.hint}</div>
              </Link>
            );
          })}
        </nav>
        <div className="mt-8 border-t border-[var(--line)] pt-4 text-[11px] text-[var(--ink-2)]">
          <div className="mb-2">登录为 {who || "—"}</div>
          <button onClick={() => sb.auth.signOut()} className="underline hover:text-[var(--ink)]">退出</button>
          <a href="https://office.dkainexus.com" className="mt-2 block underline hover:text-[var(--ink)]">
            去 3D 办公室 ↗
          </a>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-8">
        <h1 className="mb-6 font-[family-name:var(--f-display)] text-2xl font-bold">{title}</h1>
        {children}
      </main>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center p-8 text-sm text-[var(--ink-2)]">{children}</div>;
}
