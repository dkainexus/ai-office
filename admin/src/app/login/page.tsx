"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sb, EMAIL_DOMAIN } from "@/lib/supabase";

export default function Login() {
  const [u, setU] = useState("admin");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    // 和 3D 页同一套凭据：用户名拼成 <用户名>@office.dkglobal.group
    const { error } = await sb.auth.signInWithPassword({ email: `${u}@${EMAIL_DOMAIN}`, password: pw });
    setBusy(false);
    if (error) { setErr("账号或密码不对"); return; }
    router.replace("/budget");
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-7 shadow-sm">
        <div className="font-[family-name:var(--f-display)] text-base font-bold tracking-wide">DK GLOBAL GROUP</div>
        <div className="mb-6 text-xs text-[var(--ink-2)]">AI Office 后台</div>

        <label className="mb-1 block text-xs text-[var(--ink-2)]">账号</label>
        <input
          value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" required
          className="mb-4 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--cobalt)]"
        />

        <label className="mb-1 block text-xs text-[var(--ink-2)]">密码</label>
        <input
          type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required
          className="mb-5 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--cobalt)]"
        />

        {err && <p className="mb-4 text-xs text-[var(--bad)]">{err}</p>}

        <button
          disabled={busy}
          className="w-full rounded-lg bg-[var(--cobalt)] py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "登录中…" : "登录"}
        </button>

        <p className="mt-4 text-[11px] leading-relaxed text-[var(--ink-2)]">
          用你在 3D 办公室里用的同一组账号密码。这个后台是独立站点，所以要单独登录一次。
        </p>
      </form>
    </div>
  );
}
