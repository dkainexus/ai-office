// AI Office · Telegram bridge
// - owner (signed-in browser) or admin key: setup / test / decision / report / decided
// - Telegram webhook (secret header): button taps -> telegram_actions
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SB_URL, SR, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cut = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

type Cfg = { token: string | null; chat: string | null; hook: string | null };
async function secret(id: string): Promise<string | null> {
  const { data, error } = await admin.rpc("tg_secret", { p_id: id });
  if (error) throw error;
  return (data as string | null) ?? null;
}
async function cfg(): Promise<Cfg> {
  const [token, chat, hook] = await Promise.all([secret("p1_token"), secret("p1_chat"), secret("tg_webhook")]);
  return { token: token?.trim() ?? null, chat: chat?.trim() ?? null, hook };
}
async function tg(token: string, method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }));
  if (!j.ok) throw new Error(`Telegram: ${j.description || "error"}`);
  return j.result;
}

async function isOwner(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const c = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await c.rpc("is_owner");
  return data === true;
}
async function isAdmin(req: Request) {
  const k = req.headers.get("x-admin-key");
  if (!k) return false;
  const a = await secret("tg_admin");
  return !!a && k === a;
}

// claim a ref so several open tabs never send the same thing twice
async function claim(ref: string, kind: string, payload: unknown) {
  const { data, error } = await admin.from("telegram_messages").insert({ ref, kind, payload }).select("ref");
  if (error) { if (error.code === "23505") return false; throw error; }
  return !!data?.length;
}

const kb = (ref: string, opts: [string, string][]) => {
  const btns = opts.map((o, i) => ({ text: cut(o[0], 30), callback_data: `d|${ref}|${i}`.slice(0, 64) }));
  const rows = []; for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  return { inline_keyboard: rows };
};

async function sendDecision(b: any, c: Cfg) {
  const ref = String(b.ref || ""); if (!ref) throw new Error("missing ref");
  const opts: [string, string][] = Array.isArray(b.opts) && b.opts.length ? b.opts.slice(0, 6) : [["批准", "yes"], ["驳回", "no"]];
  const text = [
    `🟡 <b>需要你审批</b>`,
    `<b>${esc(cut(b.title, 200))}</b>`,
    `提交：${esc(b.from)}${b.role ? `（${esc(b.role)}）` : ""}`,
    b.detail ? `\n${esc(cut(b.detail, 1500))}` : "",
    b.rev ? `\n📝 ${esc(cut(b.rev, 300))}` : "",
  ].filter(Boolean).join("\n");
  if (!(await claim(ref, "decision", { opts, text }))) return { skipped: true };
  try {
    const m = await tg(c.token!, "sendMessage", { chat_id: c.chat, parse_mode: "HTML", text, reply_markup: kb(ref, opts) });
    await admin.from("telegram_messages").update({ message_id: m.message_id }).eq("ref", ref);
    return { ok: true };
  } catch (e) {
    await admin.from("telegram_messages").delete().eq("ref", ref); // let a later retry send it
    throw e;
  }
}

async function sendReport(b: any, c: Cfg, kind = "report") {
  const ref = String(b.ref || ""); if (!ref) throw new Error("missing ref");
  const icon = kind === "daily" ? "🗓" : "✅";
  const text = `${icon} <b>${esc(cut(b.title, 200))}</b>\n来自：${esc(b.from || "系统")}\n\n${esc(cut(b.text, 3000))}`;
  if (!(await claim(ref, kind, { text }))) return { skipped: true };
  try {
    const m = await tg(c.token!, "sendMessage", { chat_id: c.chat, parse_mode: "HTML", text });
    await admin.from("telegram_messages").update({ message_id: m.message_id, status: "sent" }).eq("ref", ref);
    return { ok: true };
  } catch (e) {
    await admin.from("telegram_messages").delete().eq("ref", ref);
    throw e;
  }
}

async function closeDecision(row: any, c: Cfg, choice: string, kind: string, via: string) {
  const { data } = await admin.from("telegram_messages").update({ status: "decided", choice })
    .eq("ref", row.ref).eq("status", "pending").select("ref");
  if (!data?.length) return false;
  if (row.message_id) {
    const text = `${row.payload?.text || ""}\n\n${kind === "yes" ? "✅" : "❌"} <b>你的决定：${esc(choice)}</b>（${via}）`;
    await tg(c.token!, "editMessageText", { chat_id: c.chat, message_id: row.message_id, parse_mode: "HTML", text })
      .catch((e) => console.error("edit failed", e.message));
  }
  return true;
}

async function markDecided(b: any, c: Cfg) {
  const { data: row } = await admin.from("telegram_messages").select("*").eq("ref", String(b.ref || "")).maybeSingle();
  if (!row || row.status !== "pending") return { skipped: true };
  await closeDecision(row, c, String(b.choice || ""), b.kind === "yes" ? "yes" : "no", "网页");
  return { ok: true };
}

async function onUpdate(u: any, c: Cfg) {
  const q = u.callback_query;
  if (!q) {
    const m = u.message;
    if (!m || String(m.chat?.id) !== String(c.chat)) return;
    const text = String(m.text || m.caption || "").trim();
    if (/^\/start/.test(text)) {
      await tg(c.token!, "sendMessage", { chat_id: c.chat, text: "AI Office 已连接。审批、任务结论和每日简报会发到这里。直接打字给我，就会记成问题或改进意见，系统巡检时处理。" });
    } else if (text) {
      await admin.from("feedback").insert({ source: "telegram", content: cut(text, 2000) });
      await tg(c.token!, "sendMessage", { chat_id: c.chat, reply_to_message_id: m.message_id, text: "已记下。系统巡检时会处理，需要改动的话会先把方案发给你批准。" });
    }
    return;
  }
  const answer = (text: string) => tg(c.token!, "answerCallbackQuery", { callback_query_id: q.id, text });
  if (String(q.message?.chat?.id) !== String(c.chat)) { await answer("无权限"); return; }
  const [t, ref, idx] = String(q.data || "").split("|");
  if (t !== "d" || !ref) { await answer("无法识别"); return; }
  const { data: row } = await admin.from("telegram_messages").select("*").eq("ref", ref).maybeSingle();
  if (!row || row.status !== "pending") { await answer(row ? `已经处理过：${row.choice || ""}` : "找不到这项审批"); return; }
  const o = row.payload?.opts?.[Number(idx)];
  if (!o) { await answer("选项无效"); return; }
  if (!(await closeDecision(row, c, o[0], o[1], "Telegram"))) { await answer("已经处理过了"); return; }
  // real (backend) approvals live in the decisions table; the runtime picks them up
  const { data: real } = await admin.from("decisions").update({
    status: o[1] === "yes" ? "approved" : "rejected", choice: o[0], decided_at: new Date().toISOString(),
  }).eq("id", ref).eq("status", "pending").select("id");
  if (real?.length) {
    fetch(`${SB_URL}/functions/v1/runtime`, { method: "POST", headers: { "x-admin-key": (await secret("tg_admin")) || "" } }).catch(() => {});
  } else {
    await admin.from("telegram_actions").insert({ decision_id: ref, choice: o[0], kind: o[1] });
  }
  await answer(`已记录：${o[0]}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let c: Cfg;
  try { c = await cfg(); } catch (e) { console.error(e); return json({ error: "config" }, 500); }

  const hookHeader = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (hookHeader !== null) {
    if (!c.hook || hookHeader !== c.hook) return json({ error: "forbidden" }, 403);
    try { await onUpdate(await req.json(), c); } catch (e) { console.error("update failed", (e as Error).message); }
    return json({ ok: true });
  }

  if (!((await isOwner(req)) || (await isAdmin(req)))) return json({ error: "forbidden" }, 403);
  if (!c.token || !c.chat) return json({ error: "Telegram 还没配置 Bot Token 和 Chat ID" }, 400);
  const b = await req.json().catch(() => ({}));
  try {
    switch (b.action) {
      case "setup":
        await tg(c.token, "setWebhook", {
          url: `${SB_URL}/functions/v1/telegram`, secret_token: c.hook,
          allowed_updates: ["callback_query", "message"],
        });
        return json({ ok: true });
      case "test":
        await tg(c.token, "sendMessage", {
          chat_id: c.chat, parse_mode: "HTML",
          text: "✅ <b>DK Global Group · AI Office</b>\nTelegram 已接通。之后需要你审批的事、任务结论和每日简报都会发到这里，审批消息可以直接点按钮决定。",
        });
        return json({ ok: true });
      case "decision": return json(await sendDecision(b, c));
      case "report": return json(await sendReport(b, c, "report"));
      case "daily": return json(await sendReport(b, c, "daily"));
      case "decided": return json(await markDecided(b, c));
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(b.action, (e as Error).message);
    return json({ error: (e as Error).message }, 502);
  }
});
