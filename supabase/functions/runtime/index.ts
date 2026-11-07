// AI Office · Agent runtime
// Runs every minute (pg_cron) and on demand (owner poke). Plans tasks with the project manager,
// has each assigned agent produce its deliverable, has the PM review, routes final approvals to Dave,
// tracks cost and budgets, keeps per-agent memory, and sends the daily brief.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const db = createClient(SB_URL, SR, { auth: { persistSession: false } });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const cut = (s: unknown, n: number) => { const t = String(s ?? ""); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const rid = (p: string) => p + crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const FINAL_RE = /上线|发布|投放|付款|签约|部署|采购|对外|发送给客户/g;
// 命中词前面紧跟否定说法时不算数。任务描述里常写「不能付款」「不涉及上线」来交代边界，
// 旧版的纯子串匹配会把这类说明也当成需要人工审批，Dave 会收到一堆没必要的审批。
// 只收明确表达「做不到 / 不许做」的词。「不要」「没有」太泛（不要紧、还没有付款），
// 漏拦比多拦危险，所以不收。
const NEG_RE = /(不能|不会|不可|无法|不涉及|不得|禁止|不需要|无需|避免)[^。；;！!\n]{0,10}$/;
function needsApproval(text: string) {
  FINAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FINAL_RE.exec(text))) if (!NEG_RE.test(text.slice(0, m.index))) return true;
  return false;
}
const SMART_ROLES = new Set(["director", "pm", "manager", "lead", "engineer"]);

type Agent = { id: string; name: string; role: string; title: string | null; dept: string | null; prompt: string | null; level: number };
type Keys = { anthropic: string | null; openai: string | null };
type Call = { text: string; model: string; host: string; tin: number; tout: number; usd: number; cut: boolean };

// 模型是「写完了」还是「写到上限被掐断」。
//
// 之前两家的这个信号都没看，于是半截文稿被原样存进 subtasks.output、标成 done，
// 项目经理拿着残稿去验收，Dave 也收不到任何提示。实测遇到过一次：
// tokens_out 正好等于 max_tokens 6000。
//
// Anthropic: stop_reason = "max_tokens"；OpenAI: choices[0].finish_reason = "length"。
function truncated(host: string, j: any) {
  return host === "anthropic"
    ? j?.stop_reason === "max_tokens"
    : j?.choices?.[0]?.finish_reason === "length";
}
const CUT_NOTE = "这一步的交付在写到长度上限时被掐断，不是完整内容。";

async function secret(id: string) {
  const { data, error } = await db.rpc("tg_secret", { p_id: id });
  if (error) throw error;
  return ((data as string | null) ?? "").trim() || null;
}
async function settings() {
  const { data, error } = await db.from("runtime_settings").select("data").eq("id", 1).single();
  if (error) throw error;
  return data.data as any;
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

// ---------- models ----------
function price(model: string, tin: number, tout: number, st: any) {
  const p = st.prices_usd_per_mtok?.[model] || [3, 15];
  return (tin * p[0] + tout * p[1]) / 1e6;
}
async function anthropic(key: string, model: string, system: string, user: string, max: number, st: any): Promise<Call> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: max, system, messages: [{ role: "user", content: user }] }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Claude ${r.status}: ${j?.error?.message || "error"}`);
  const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
  if (!text) throw new Error("Claude 返回空内容");
  const tin = j.usage?.input_tokens || 0, tout = j.usage?.output_tokens || 0;
  return { text, model, host: "anthropic", tin, tout, usd: price(model, tin, tout, st), cut: truncated("anthropic", j) };
}
async function openai(key: string, model: string, system: string, user: string, max: number, st: any): Promise<Call> {
  const body: any = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }], max_completion_tokens: max };
  if (/^(gpt-5|o\d)/.test(model)) body.reasoning_effort = "low";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(90000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GPT ${r.status}: ${j?.error?.message || "error"}`);
  const text = (j.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("GPT 返回空内容");
  const tin = j.usage?.prompt_tokens || 0, tout = j.usage?.completion_tokens || 0;
  return { text, model, host: "openai", tin, tout, usd: price(model, tin, tout, st), cut: truncated("openai", j) };
}
async function callModel(tier: "smart" | "fast", system: string, user: string, max: number, st: any, keys: Keys): Promise<Call> {
  const routes: string[] = [...(st.models?.[tier] || []), ...(st.models?.[tier === "smart" ? "fast" : "smart"] || [])];
  let last: Error | null = null;
  for (const r of routes) {
    const [host, model] = r.split(":");
    const key = host === "anthropic" ? keys.anthropic : keys.openai;
    if (!key) continue;
    try {
      return host === "anthropic" ? await anthropic(key, model, system, user, max, st) : await openai(key, model, system, user, max, st);
    } catch (e) { last = e as Error; console.error("model", r, last.message); }
  }
  throw last || new Error("没有可用的模型 API Key");
}
async function logCall(c: Call, agentId: string | null, taskId: string | null, purpose: string, st: any) {
  const rm = +(c.usd * (st.usd_myr || 4.25)).toFixed(4);
  await db.from("model_calls").insert({
    agent_id: agentId, model: c.model, host: c.host, cost: rm, usd: c.usd, tokens_in: c.tin, tokens_out: c.tout,
    task_id: taskId, purpose, verdict: "approve",
  });
  if (taskId) await db.rpc("rt_add_cost", { p_task: taskId, p_rm: rm });
  return rm;
}

// ---------- office helpers ----------
async function agents(): Promise<Agent[]> {
  const { data } = await db.from("agents").select("id,name,role,title,dept,prompt,level");
  return (data || []) as Agent[];
}
const pickPM = (as: Agent[]) => as.find((a) => a.role === "pm") || as.find((a) => a.role === "director") || null;
async function memories(agentId: string, n = 12) {
  const { data } = await db.from("agent_memories").select("content").eq("agent_id", agentId)
    .order("created_at", { ascending: false }).limit(n);
  return (data || []).reverse().map((m: any) => "- " + m.content).join("\n");
}
async function remember(agentId: string | null | undefined, content: string) {
  if (agentId) await db.from("agent_memories").insert({ agent_id: agentId, content: cut(content, 500) });
}
async function say(thread: string, agentId: string | null, content: string, model?: string) {
  await db.from("messages").insert({ thread, agent_id: agentId, content: cut(content, 4000), model: model || null });
}
function persona(a: Agent | null) {
  if (!a) return "你是 DK Global Group 的项目管理系统。公司老板是 Dave，他只看结论和需要他拍板的事。用简体中文，直接、具体。";
  return [
    `你是「DK Global Group」AI 公司的员工 ${a.name}，职位：${a.title || a.role}，部门：${a.dept || "未分配"}。`,
    a.prompt ? `你的个性与工作方式：${a.prompt}` : "",
    "公司老板是 Dave。他只看结论和需要他拍板的事，不喜欢空话。用简体中文，直接、具体、可执行。",
    "你现在不能上网、不能对外发消息、不能付款、不能操作外部系统；需要这些时写清楚缺什么、需要谁支持。",
  ].filter(Boolean).join("\n");
}
async function tg(action: string, body: Record<string, unknown>) {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": (await secret("tg_admin")) || "" },
      body: JSON.stringify({ action, ...body }),
    });
    if (!r.ok) console.error("telegram", action, r.status, await r.text());
  } catch (e) { console.error("telegram", action, (e as Error).message); }
}
async function addDecision(d: { title: string; detail: string; agent: Agent | null; taskId?: string | null; kind: string; options: [string, string][]; review: string; id?: string }) {
  const id = d.id || rid("rd");
  const { error } = await db.from("decisions").insert({
    id, agent_id: d.agent?.id || null, title: d.title, detail: d.detail, review: d.review,
    options: d.options, status: "pending", task_id: d.taskId || null, kind: d.kind,
  });
  if (error) { if (error.code === "23505") return id; throw error; }
  await tg("decision", { ref: id, title: d.title, from: d.agent?.name || "系统", role: d.agent?.title || "", detail: d.detail, rev: d.review, opts: d.options });
  return id;
}
function parseJSON(t: string) {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("项目经理没有给出可用的拆解");
  return JSON.parse(m[0]);
}

// ---------- 1. plan ----------
async function plan(T: any, st: any, keys: Keys) {
  const as = await agents();
  if (!as.length) throw new Error("后台还没有 Agent 名单，请先打开一次网站");
  const pm = pickPM(as);
  const roster = as.map((a) => `${a.id} | ${a.name} | ${a.title || a.role} | ${a.dept || "-"}${a.prompt ? " | " + cut(a.prompt, 80) : ""}`).join("\n");
  const user = [
    `任务：${T.title}`, `补充要求：${T.description || "无"}`, `优先级：${T.priority}`,
    T.rework_note ? `⚠️ 这是返工。Dave 的意见：${T.rework_note}` : "",
    "", "公司成员（id | 名字 | 职位 | 部门 | 说明）：", roster, "",
    "要求：",
    "1. 拆成 1–5 个步骤，每步交给最合适的一名成员（填 id）。可以同时做的步骤用相同 seq，有先后依赖的用更大的 seq。",
    "2. 每步的 instructions 写清楚要交付什么、标准是什么，让执行的人不用再问。",
    "3. 不要把执行步骤分给项目经理自己，除非没有别人能做。",
    "4. needs_final：结果涉及上线、发布、对外发送、花钱、签约，或优先级是重要/紧急时填 true。",
    '只输出 JSON：{"steps":[{"seq":1,"agent_id":"...","title":"不超过 20 字","instructions":"..."}],"needs_final":false,"note":"给 Dave 的一句话拆解说明"}',
  ].filter((x) => x !== "").join("\n");
  const c = await callModel("smart", persona(pm) + "\n你是项目经理，负责把 Dave 发布的任务拆给合适的部门和成员。", user, 3000, st, keys);
  await logCall(c, pm?.id || null, T.id, "plan", st);
  // 拆解被截断时 JSON 基本是残的，parseJSON 会抛一个看不懂的错，这里先说清楚真正的原因
  if (c.cut) throw new Error("项目经理的拆解写到长度上限被截断了，没拿到完整的 JSON");
  const p = parseJSON(c.text);
  const steps = (Array.isArray(p.steps) ? p.steps : []).slice(0, 6);
  if (!steps.length) throw new Error("项目经理没有拆出步骤");
  const workers = as.filter((a) => a.id !== pm?.id);
  const rows = steps.map((s: any, i: number) => {
    const a = as.find((x) => x.id === s.agent_id) || workers[i % Math.max(1, workers.length)] || pm!;
    return {
      id: rid("s"), task_id: T.id, dept: a.dept || "-", agent_id: a.id, status: "todo",
      seq: Math.max(1, Math.min(9, parseInt(s.seq) || 1)), title: cut(s.title || `步骤 ${i + 1}`, 40),
      instructions: cut(s.instructions || "", 2000),
    };
  });
  await db.from("subtasks").insert(rows);
  const needsFinal = !!p.needs_final || T.priority !== "普通" || needsApproval(`${T.title}。${T.description || ""}`);
  await db.from("tasks").update({
    status: "active", needs_final: needsFinal, plan_note: cut(p.note || "", 300), updated_at: new Date().toISOString(),
    ...(T.version === 1 && !T.rework_note && +T.cost === 0 ? { budget_rm: +(st.task_budget_rm || 20) } : {}),
  }).eq("id", T.id);
  const names = rows.map((r: any) => `${r.seq}. ${r.title} → ${as.find((a) => a.id === r.agent_id)?.name}`).join("\n");
  await say(T.id, pm?.id || null, `拆解「${T.title}」：${p.note || ""}\n${names}`, c.model);
  await remember(pm?.id, `拆解 Dave 的任务「${T.title}」，分给：${rows.map((r: any) => as.find((a) => a.id === r.agent_id)?.name).join("、")}`);
  for (const r of rows) await remember(r.agent_id, `被分配「${T.title}」中的「${r.title}」`);
}

// ---------- 2. execute one step ----------
async function execute(s: any, st: any, keys: Keys) {
  const { data: T } = await db.from("tasks").select("*").eq("id", s.task_id).single();
  if (!T) return;
  if (+T.cost >= +T.budget_rm) {
    await db.from("subtasks").update({ status: "todo", attempts: Math.max(0, s.attempts - 1) }).eq("id", s.id);
    await db.from("tasks").update({ status: "paused" }).eq("id", T.id);
    const as = await agents(); const pm = pickPM(as);
    await addDecision({
      id: `budget-${T.id}-${Math.round(+T.budget_rm)}`, kind: "budget", agent: pm, taskId: T.id,
      title: `任务「${cut(T.title, 30)}」已用到预算 RM ${(+T.budget_rm).toFixed(2)}`,
      detail: `已花费 RM ${(+T.cost).toFixed(2)}，还有步骤没做完。继续的话追加 RM ${st.task_topup_rm || 20}。`,
      review: "项目经理已暂停这个任务，等你决定", options: [[`追加 RM ${st.task_topup_rm || 20} 继续`, "yes"], ["停止任务", "no"]],
    });
    return;
  }
  const as = await agents();
  const a = as.find((x) => x.id === s.agent_id) || pickPM(as);
  const { data: prior } = await db.from("subtasks").select("title,output,agent_id,seq").eq("task_id", T.id).eq("status", "done").lt("seq", s.seq).order("seq");
  const priorTxt = (prior || []).map((p: any) => `【${p.title}｜${as.find((x) => x.id === p.agent_id)?.name || ""}】\n${cut(p.output, 3000)}`).join("\n\n");
  const mem = a ? await memories(a.id) : "";
  const system = `${persona(a)}\n\n你的近期记忆：\n${mem || "（暂无）"}`;
  const user = [
    `Dave 发布的任务：${T.title}`, `补充要求：${T.description || "无"}`,
    T.rework_note ? `⚠️ Dave 打回意见：${T.rework_note}` : "",
    `你负责的这一步：${s.title}`, `具体要求：${s.instructions || "按任务目标完成你这部分"}`,
    priorTxt ? `\n前面同事已交付：\n${priorTxt}` : "",
    a?.role === "video" ? "\n公司还没接入视频生成模型：先交付完整脚本、分镜表和每个镜头的生成提示词。" : "",
    "\n现在直接交付你的成果（完整可用的正文，不要只写计划）。做不到的部分（例如真正生成视频、上线、付款）写出能做的部分，最后用「需要支持：」列出缺什么。",
  ].filter(Boolean).join("\n");
  try {
    const c = await callModel(a && SMART_ROLES.has(a.role) ? "smart" : "fast", system, user, 6000, st, keys);
    const rm = await logCall(c, a?.id || null, T.id, "execute", st);
    // 写到上限被掐断的，照样留下已写的部分（扔掉更浪费），但必须标出来：
    // error 字段给前端看，正文末尾的标记给验收的项目经理看。
    await db.from("subtasks").update({
      status: "done", model: c.model, cost: +s.cost + rm, finished_at: new Date().toISOString(),
      output: c.cut ? `${c.text}\n\n⚠️ ${CUT_NOTE}` : c.text,
      error: c.cut ? CUT_NOTE : null,
    }).eq("id", s.id);
    await say(T.id, a?.id || null, c.cut ? `完成「${s.title}」（交付被截断，不完整）` : `完成「${s.title}」`, c.model);
    await remember(a?.id, `完成「${T.title}」中的「${s.title}」：${cut(c.text.replace(/\s+/g, " "), 160)}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (s.attempts >= 3) {
      await db.from("subtasks").update({ status: "failed", error: msg }).eq("id", s.id);
      await db.from("tasks").update({ status: "blocked", plan_note: cut(`「${s.title}」连续失败：${msg}`, 300) }).eq("id", T.id);
      await tg("report", { ref: `fail-${s.id}`, title: `任务卡住：${T.title}`, from: "系统", text: `「${s.title}」连续 3 次失败。\n原因：${cut(msg, 300)}` });
    } else {
      await db.from("subtasks").update({ status: "todo", error: msg }).eq("id", s.id);
    }
  }
}

// ---------- Drive ----------
async function saveToDrive(taskId: string): Promise<string | null> {
  if (!(await secret("p2_refresh"))) return null;
  try {
    const r = await fetch(`${SB_URL}/functions/v1/gdrive`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-admin-key": (await secret("tg_admin")) || "" },
      body: JSON.stringify({ action: "save_task", task_id: taskId }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("drive", j.error); return null; }
    return j.url || null;
  } catch (e) { console.error("drive", (e as Error).message); return null; }
}

// ---------- 3. review & conclude ----------
async function conclude(T: any, st: any, keys: Keys) {
  const as = await agents(); const pm = pickPM(as);
  const { data: subs } = await db.from("subtasks").select("title,output,agent_id,error").eq("task_id", T.id).order("seq");
  // 截断标记写在标题行，不能只靠正文末尾的 —— 下面 cut(s.output, 2500) 会把末尾裁掉。
  const body = (subs || []).map((s: any) =>
    `【${s.title}｜${as.find((a) => a.id === s.agent_id)?.name || ""}${s.error ? ` ⚠️ ${s.error}` : ""}】\n${cut(s.output, 2500)}`).join("\n\n");
  const anyCut = (subs || []).some((s: any) => s.error);
  const c = await callModel("smart", persona(pm) + "\n你是项目经理，负责验收并向 Dave 汇报。",
    `任务：${T.title}\n补充要求：${T.description || "无"}\n\n各成员交付：\n${body}\n\n用 3–6 句话告诉 Dave：做成了什么、关键产出、风险或需要他知道的事。不要客套，不要重复全文。`
    + (anyCut ? "\n\n注意：上面带 ⚠️ 的交付是残的，不要当成完整内容验收，必须在结论里明确告诉 Dave 哪一步不完整。" : ""),
    1500, st, keys);
  await logCall(c, pm?.id || null, T.id, "review", st);
  const conclusion = c.cut ? `${c.text}\n\n⚠️ 这份验收结论本身也被截断了，不是完整的。` : c.text;
  await say(T.id, pm?.id || null, `验收结论：${conclusion}`, c.model);
  await remember(pm?.id, `验收「${T.title}」：${cut(conclusion, 160)}`);
  await db.from("tasks").update({ conclusion }).eq("id", T.id);
  const drive = await saveToDrive(T.id);
  const where = drive ? `完整交付已存进 Google Drive：\n${drive}` : "完整交付在 AI Office 任务台。";
  if (T.needs_final) {
    await db.from("tasks").update({ status: "review", conclusion }).eq("id", T.id);
    await addDecision({
      kind: "final", agent: pm, taskId: T.id, title: `最终审批：${cut(T.title, 40)}`, detail: `${conclusion}\n\n${where}`,
      review: "各成员已交付，项目经理已验收", options: [["通过，执行", "yes"], ["打回重做", "no"]],
    });
  } else {
    await db.from("tasks").update({ status: "done", conclusion }).eq("id", T.id);
    await tg("report", { ref: `done-${T.id}-${Date.now()}`, title: `任务完成：${T.title}`, from: pm?.name || "系统", text: `${conclusion}\n\n花费 RM ${(+T.cost).toFixed(2)}。${where}` });
  }
}

// ---------- 4. apply Dave's decisions ----------
async function applyDecisions(st: any) {
  const { data: ds } = await db.from("decisions").select("*").in("status", ["approved", "rejected"]).eq("handled", false).limit(20);
  const as = (ds || []).length ? await agents() : []; const pm = pickPM(as);
  for (const d of ds || []) {
    const yes = d.status === "approved";
    if (d.kind === "final" && d.task_id) {
      if (yes) {
        await db.from("tasks").update({ status: "done" }).eq("id", d.task_id);
        await remember(pm?.id, `Dave 通过了「${d.title}」`);
      } else {
        const { data: T } = await db.from("tasks").select("conclusion").eq("id", d.task_id).single();
        await db.from("subtasks").delete().eq("task_id", d.task_id);
        const { data: V } = await db.from("tasks").select("version").eq("id", d.task_id).single();
        await db.from("tasks").update({
          status: "planning", conclusion: null, version: (V?.version || 1) + 1,
          rework_note: cut(`${d.note || "没写原因"}（上一版结论：${T?.conclusion || ""}）`, 800),
        }).eq("id", d.task_id);
        await remember(pm?.id, `Dave 打回「${d.title}」：${d.note || "没写原因"}`);
      }
    } else if (d.kind === "budget" && d.task_id) {
      if (yes) {
        const { data: T } = await db.from("tasks").select("budget_rm").eq("id", d.task_id).single();
        const add = +(st.task_topup_rm || 20), before = +(T?.budget_rm || 0);
        await db.from("tasks").update({ status: "active", budget_rm: before + add }).eq("id", d.task_id);
        await db.from("budget_log").insert({ kind: "topup_task", amount: add, before_rm: before, after_rm: before + add, task_id: d.task_id, decision_id: d.id, note: `Dave 批准追加：${d.title}` });
      } else {
        await db.from("tasks").update({ status: "stopped" }).eq("id", d.task_id);
      }
    } else if (d.kind === "monthly" && yes) {
      const add = +(st.month_topup_rm || 1000), before = +st.monthly_cap_rm || 0;
      st.monthly_cap_rm = before + add;
      await db.from("budget_log").insert({ kind: "topup_month", amount: add, before_rm: before, after_rm: before + add, decision_id: d.id, note: "Dave 批准本月追加" });
      await db.from("runtime_settings").update({ data: st, updated_at: new Date().toISOString() }).eq("id", 1);
    }
    await db.from("decisions").update({ handled: true }).eq("id", d.id);
  }
}

// ---------- 5. daily brief ----------
async function dailyBrief(st: any) {
  const sgt = new Date(Date.now() + 8 * 3600e3);
  if (sgt.getUTCHours() < (st.daily_brief_hour ?? 18)) return;
  const day = sgt.toISOString().slice(0, 10);
  const { data: sent } = await db.from("telegram_messages").select("ref").eq("ref", `daily-${day}`).maybeSingle();
  if (sent) return;
  const start = new Date(Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - 8 * 3600e3).toISOString();
  const { data: tasks } = await db.from("tasks").select("title,status,updated_at");
  const all = tasks || [];
  const doneToday = all.filter((t: any) => t.status === "done" && t.updated_at >= start);
  const n = (s: string) => all.filter((t: any) => t.status === s).length;
  const { count: pending } = await db.from("decisions").select("id", { count: "exact", head: true }).eq("status", "pending");
  const dayRm = +((await db.rpc("rt_day_spend")).data || 0), monthRm = +((await db.rpc("rt_month_spend")).data || 0);
  const lines = [
    `今天完成 ${doneToday.length} 个任务${doneToday.length ? "：" + doneToday.slice(0, 8).map((t: any) => `「${t.title}」`).join("、") : ""}。`,
    `进行中 ${n("active") + n("planning") + n("planning_run") + n("concluding")} 个，等你审批 ${pending || 0} 项${n("blocked") ? `，卡住 ${n("blocked")} 个` : ""}${n("paused") ? `，预算暂停 ${n("paused")} 个` : ""}。`,
    `今日模型花费 RM ${dayRm.toFixed(2)}，本月 RM ${monthRm.toFixed(2)} / RM ${(+st.monthly_cap_rm).toFixed(0)}。`,
  ];
  const as = await agents();
  await tg("daily", { ref: `daily-${day}`, title: `每日简报 · ${day}`, from: pickPM(as)?.name || "系统", text: lines.join("\n") });
}

// ---------- 6. stuck watch ----------
// 任务卡在某个状态不动超过阈值就提醒一次。
//
// ref 里带 updated_at：卡着的时候这个值不变，所以同一次卡死只会发一条；
// 一旦有进展 updated_at 就变了，之后再卡是新的 ref，能重新提醒。
//
// 只看「本来应该在动」的状态。review（等你审批）、paused（等你加预算）、
// blocked（已经单独报过警）都是在等人，不算卡住。
async function stuckWatch(st: any) {
  const mins = +(st.stuck_after_min ?? 30);
  if (!(mins > 0)) return;
  const cutoff = new Date(Date.now() - mins * 60000).toISOString();
  const { data: ts } = await db.from("tasks").select("id,title,status,updated_at")
    .in("status", ["planning", "planning_run", "active", "concluding"])
    .lt("updated_at", cutoff).limit(5);
  for (const t of ts || []) {
    const age = Math.round((Date.now() - new Date(t.updated_at).getTime()) / 60000);
    const { data: subs } = await db.from("subtasks").select("title,status,error").eq("task_id", t.id);
    const left = (subs || []).filter((s: any) => s.status !== "done");
    const err = left.map((s: any) => s.error).filter(Boolean)[0];
    await tg("report", {
      ref: `stuck-${t.id}-${t.updated_at}`,
      title: `任务没有进展：${cut(t.title, 40)}`,
      from: "系统",
      text: `状态「${t.status}」已经 ${age} 分钟没动静。\n`
        + (left.length ? `还没做完：${left.map((s: any) => s.title).join("、")}` : "没有待办步骤，可能是验收那一步卡住了。")
        + (err ? `\n最近一次报错：${cut(err, 200)}` : ""),
    });
  }
}

// ---------- main ----------
let running = false;
async function tick() {
  if (running) return { busy: true };
  running = true;
  try {
    const st = await settings();
    await applyDecisions(st);
    await dailyBrief(st).catch((e) => console.error("brief", e.message));
    if (st.paused) return { paused: true };
    const keys: Keys = { anthropic: await secret("p_claude_key"), openai: await secret("p_openai_key") };
    if (!keys.anthropic && !keys.openai) return { idle: "no model keys" };
    const spent = +((await db.rpc("rt_month_spend")).data || 0);
    if (spent >= +st.monthly_cap_rm) {
      const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
      await addDecision({
        id: `month-${month}-${Math.round(+st.monthly_cap_rm)}`, kind: "monthly", agent: pickPM(await agents()),
        title: `本月模型预算 RM ${(+st.monthly_cap_rm).toFixed(0)} 已用完`, detail: `本月已花 RM ${spent.toFixed(2)}，所有任务已暂停。`,
        review: "项目经理已暂停全部模型调用", options: [[`本月上限加 RM ${st.month_topup_rm || 1000}`, "yes"], ["暂停到下个月", "no"]],
      });
      return { idle: "monthly cap" };
    }
    // 放在这里：系统没暂停、预算没用完、有 Key，也就是「本来能干活」的时候，
    // 任务还不动才算真卡住。
    await stuckWatch(st).catch((e) => console.error("stuck", e.message));
    const t0 = Date.now(); let steps = 0;
    while (Date.now() - t0 < 50000) {
      const p = (await db.rpc("rt_claim_plan")).data?.[0];
      if (p) {
        try { await plan(p, st, keys); } catch (e) {
          const msg = (e as Error).message; console.error("plan", msg);
          await db.from("tasks").update({ status: "blocked", plan_note: cut(`拆解失败：${msg}`, 300) }).eq("id", p.id);
          await tg("report", { ref: `planfail-${p.id}-${Date.now()}`, title: `任务卡住：${p.title}`, from: "系统", text: `项目经理拆解失败。\n原因：${cut(msg, 300)}` });
        }
        steps++; continue;
      }
      const s = (await db.rpc("rt_claim_sub")).data?.[0];
      if (s) { await execute(s, st, keys); steps++; continue; }
      const c = (await db.rpc("rt_claim_conclude")).data?.[0];
      if (c) {
        try { await conclude(c, st, keys); } catch (e) {
          console.error("conclude", (e as Error).message);
          await db.from("tasks").update({ status: "active" }).eq("id", c.id);
          break;
        }
        steps++; continue;
      }
      break;
    }
    return { ok: true, steps };
  } finally { running = false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!((await isAdmin(req)) || (await isOwner(req)))) return json({ error: "forbidden" }, 403);
  const job = tick().then((r) => console.log("tick", JSON.stringify(r))).catch((e) => console.error("tick failed", e.message));
  // keep working after replying so cron/browser calls return immediately
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(job);
  return json({ ok: true, started: true });
});
