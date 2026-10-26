// AI Office · Google Drive
// POST {action:"start"}            (owner)  -> Google login URL
// GET  ?code&state                 (Google redirect) -> stores refresh token, creates root folder, back to the office
// POST {action:"save_task",task_id}(admin)  -> saves a task's deliverables into Drive, returns folder url
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SB_URL, SR, { auth: { persistSession: false } });
const OFFICE = "https://office.dkglobal.group/";
const REDIRECT = `${SB_URL}/functions/v1/gdrive`;
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const ROOT_NAME = "DK Global Group · AI Office";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${OFFICE}?${q}` } });

async function secret(id: string) {
  const { data, error } = await db.rpc("tg_secret", { p_id: id });
  if (error) throw error;
  return ((data as string | null) ?? "").trim() || null;
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
  return !!k && k === (await secret("tg_admin"));
}
async function settings() {
  const { data } = await db.from("runtime_settings").select("data").eq("id", 1).single();
  return (data?.data || {}) as any;
}
async function saveDrive(patch: Record<string, unknown>) {
  const st = await settings();
  st.drive = { ...(st.drive || {}), ...patch };
  await db.from("runtime_settings").update({ data: st, updated_at: new Date().toISOString() }).eq("id", 1);
  return st.drive;
}

// ---------- Google API ----------
async function accessToken() {
  const [cid, cs, rt] = await Promise.all([secret("p2_client_id"), secret("p2_client_secret"), secret("p2_refresh")]);
  if (!cid || !cs || !rt) throw new Error("Google Drive 还没授权");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cid, client_secret: cs, refresh_token: rt, grant_type: "refresh_token" }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error === "invalid_grant" ? "Google Drive 授权已失效，请在后台重新授权" : `Google token: ${j.error_description || j.error}`);
  return j.access_token as string;
}
async function gapi(tok: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${tok}`, ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(`Drive ${r.status}: ${j?.error?.message || "error"}`), { status: r.status });
  return j;
}
async function folder(tok: string, name: string, parent?: string) {
  const f = await gapi(tok, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) }),
  });
  return f.id as string;
}
async function alive(tok: string, id?: string | null) {
  if (!id) return false;
  try { const f = await gapi(tok, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`); return !f.trashed; }
  catch { return false; }
}
async function doc(tok: string, name: string, content: string, parent: string) {
  const send = async (type: string) => {
    const b = "aioffice" + crypto.randomUUID().replace(/-/g, "");
    const meta = { name, mimeType: "application/vnd.google-apps.document", parents: [parent] };
    const body = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${type}; charset=UTF-8\r\n\r\n${content}\r\n--${b}--`;
    return await gapi(tok, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body,
    });
  };
  try { return await send("text/markdown"); } catch { return await send("text/plain"); }
}
const sgt = (iso?: string) => new Date((iso ? Date.parse(iso) : Date.now()) + 8 * 3600e3).toISOString();
const clean = (s: string) => s.replace(/[\\/:*?"<>|\n\r]+/g, " ").trim().slice(0, 60);

async function rootFolder(tok: string) {
  const st = await settings();
  if (await alive(tok, st.drive?.root_id)) return st.drive.root_id as string;
  const id = await folder(tok, ROOT_NAME);
  await saveDrive({ root_id: id, months: {} });
  return id;
}
async function monthFolder(tok: string, root: string, month: string) {
  const st = await settings();
  const id = st.drive?.months?.[month];
  if (await alive(tok, id)) return id as string;
  const nid = await folder(tok, `任务 ${month}`, root);
  await saveDrive({ months: { ...(st.drive?.months || {}), [month]: nid } });
  return nid;
}

async function saveTask(taskId: string) {
  const { data: T } = await db.from("tasks").select("*").eq("id", taskId).single();
  if (!T) throw new Error("找不到任务");
  const { data: subs } = await db.from("subtasks").select("title,output,agent_id,seq,model").eq("task_id", taskId).eq("status", "done").order("seq");
  const { data: as } = await db.from("agents").select("id,name,title");
  const who = (id: string) => (as || []).find((a: any) => a.id === id);
  const tok = await accessToken();
  const created = sgt(T.created_at);
  let fid = (T.drive_folder_url || "").split("/folders/")[1] || null;
  if (!(await alive(tok, fid))) {
    const root = await rootFolder(tok);
    const month = await monthFolder(tok, root, created.slice(0, 7));
    fid = await folder(tok, `${created.slice(5, 10)} ${clean(T.title)}`, month);
  }
  const v = T.version > 1 ? `v${T.version} · ` : "";
  const head = [
    `# ${T.title}`, "", `- 优先级：${T.priority}`, `- 发布：${created.slice(0, 16).replace("T", " ")}（新加坡时间）`,
    `- 模型花费：RM ${(+T.cost).toFixed(2)}`, T.version > 1 ? `- 版本：第 ${T.version} 版（返工）` : "",
    T.description ? `\n## 要求\n${T.description}` : "", T.rework_note ? `\n## 上次打回意见\n${T.rework_note}` : "",
    `\n## 项目经理结论\n${T.conclusion || "（还没有结论）"}`,
    `\n## 交付清单\n${(subs || []).map((s: any) => `${s.seq}. ${s.title} — ${who(s.agent_id)?.name || ""}`).join("\n")}`,
  ].filter(Boolean).join("\n");
  await doc(tok, `${v}00 结论`, head, fid!);
  for (const s of subs || []) {
    const a = who(s.agent_id);
    const body = `# ${s.title}\n\n_${a?.name || ""}（${a?.title || ""}）· ${s.model || ""}_\n\n${s.output || ""}`;
    await doc(tok, `${v}${String(s.seq).padStart(2, "0")} ${clean(s.title)}（${a?.name || ""}）`, body, fid!);
  }
  const url = `https://drive.google.com/drive/folders/${fid}`;
  await db.from("tasks").update({ drive_folder_url: url }).eq("id", taskId);
  return url;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url);

  // Google redirects back here after login
  if (req.method === "GET") {
    const code = u.searchParams.get("code"), state = u.searchParams.get("state");
    if (u.searchParams.get("error")) return back(`drive=error&msg=${encodeURIComponent(u.searchParams.get("error")!)}`);
    if (!code || !state) return back("drive=error&msg=missing");
    const { data: s } = await db.from("oauth_states").delete().eq("state", state).select("created_at");
    if (!s?.length || Date.now() - Date.parse(s[0].created_at) > 15 * 60e3) return back("drive=error&msg=expired");
    try {
      const [cid, cs] = await Promise.all([secret("p2_client_id"), secret("p2_client_secret")]);
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: cid!, client_secret: cs!, redirect_uri: REDIRECT, grant_type: "authorization_code" }),
      });
      const j = await r.json();
      if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "没有拿到长期授权");
      await db.rpc("rt_set_secret", { p_item_id: "p2_refresh", p_name: "Google Drive · 授权", p_kind: "oauth", p_value: j.refresh_token });
      await rootFolder(j.access_token);
      return back("drive=ok");
    } catch (e) {
      console.error("drive callback", (e as Error).message);
      return back(`drive=error&msg=${encodeURIComponent((e as Error).message.slice(0, 120))}`);
    }
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "start") {
      if (!(await isOwner(req))) return json({ error: "forbidden" }, 403);
      const cid = await secret("p2_client_id");
      if (!cid || !(await secret("p2_client_secret"))) return json({ error: "请先填 Client ID 和 Client secret" }, 400);
      const state = crypto.randomUUID();
      await db.from("oauth_states").delete().lt("created_at", new Date(Date.now() - 3600e3).toISOString());
      await db.from("oauth_states").insert({ state, provider: "google" });
      const q = new URLSearchParams({
        client_id: cid, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE,
        access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      });
      return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${q}` });
    }
    if (b.action === "save_task") {
      if (!(await isAdmin(req)) && !(await isOwner(req))) return json({ error: "forbidden" }, 403);
      return json({ url: await saveTask(String(b.task_id || "")) });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(b.action, (e as Error).message);
    return json({ error: (e as Error).message }, 502);
  }
});
