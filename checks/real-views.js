// 登录后「任务卡」和「员工抽屉」的渲染检查（WP-3 / WP-4）。
//
// 和 backend-real.js 同一个思路：checks/run.js 用 file:// 打开页面，REAL() 永远是 false，
// 所以这两处登录后才走的代码一行都跑不到。这里把 index.html 复制一份打补丁、
// 喂固定假数据，断言：
//   - 任务卡的「过程与花费」把 messages 和 model_calls 原样显示出来，合计对得上
//   - 员工抽屉的记忆来自 agent_memories，统计数字等于表里的聚合
//   - 登录后不出现演示用的记忆格式和「今日花费」
//
// 不连 Supabase，不碰线上，不改仓库里的 index.html。
//   node checks/real-views.js
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const CACHE = path.join(ROOT, "checks", ".cache", "node_modules");

// 一个做完的任务：4 条时间线、2 次模型调用，合计 RM 0.2165 → 显示 RM 0.22
const TASK = {
  id: "t-fix-001", title: "整理九月投诉工单", desc: "分类并给出前三个原因", prio: "普通",
  day: 20764, at: "10:30", real: true, status: "done", cost: 0.2165, conclusion: "已分类 142 条，前三原因：发货慢、包装破损、客服响应。",
  note: "", drive: "",
  subs: [
    { id: "s1", dept: "运营", title: "拉取并分类工单", agentId: "a2", agentName: "林薇", status: "done", output: "共 142 条，按原因分 7 类。", model: "gpt-5-mini", err: "", seq: 1, task: "t-fix-001", real: true },
    // 被截断的那一步：状态仍是 done，但必须在卡上看得见残缺
    { id: "s2", dept: "技术", title: "复核准确性", agentId: "a3", agentName: "阿杰", status: "done", output: "第 1 条：…", model: "claude-sonnet-5-5", err: "这一步的交付在写到长度上限时被掐断，不是完整内容。", seq: 2, task: "t-fix-001", real: true },
  ],
  msgs: [
    { who: "陈默", txt: "拆解「整理九月投诉工单」：先分类再归因\n1. 拉取并分类工单 → 林薇", model: "claude-sonnet-5-5", at: "10:31" },
    { who: "林薇", txt: "完成「拉取并分类工单」", model: "gpt-5-mini", at: "10:33" },
    { who: "陈默", txt: "验收结论：已分类 142 条，前三原因：发货慢、包装破损、客服响应。", model: "claude-sonnet-5-5", at: "10:35" },
  ],
  calls: [
    { who: "陈默", model: "claude-sonnet-5-5", purpose: "plan", cost: 0.1299, tin: 1149, tout: 1808, at: "10:31" },
    { who: "林薇", model: "gpt-5-mini", purpose: "execute", cost: 0.0866, tin: 1328, tout: 1093, at: "10:33" },
  ],
};

// 员工抽屉的后台统计与记忆
const AGENT = {
  mem: [
    { content: "完成「整理九月投诉工单」中的「拉取并分类工单」：共 142 条，按原因分 7 类。", created_at: "2026-11-07T02:33:00Z" },
    { content: "被分配「整理九月投诉工单」中的「拉取并分类工单」", created_at: "2026-11-07T02:31:00Z" },
  ],
  done: 3, failed: 1, calls: 5, cost: 0.4312,
};

const WANT = [
  ["过程与花费标题", /过程与花费 · 3 条记录 · 2 次模型调用 · RM 0\.22/],
  ["时间线·拆解", /10:31[\s\S]{0,60}陈默[\s\S]{0,80}拆解「整理九月投诉工单」/],
  ["时间线·完成", /10:33[\s\S]{0,40}林薇[\s\S]{0,40}完成「拉取并分类工单」/],
  ["时间线·验收", /10:35[\s\S]{0,40}陈默[\s\S]{0,60}验收结论/],
  ["成本明细·plan 译成拆解", /陈默 · claude-sonnet-5-5 · 拆解 · RM 0\.13 · 1149\+1808 tokens/],
  ["成本明细·execute 译成执行", /林薇 · gpt-5-mini · 执行 · RM 0\.09 · 1328\+1093 tokens/],
  ["抽屉·真实记忆", /共 142 条，按原因分 7 类/],
  ["抽屉·完成步骤数", /完成步骤[\s\S]{0,20}3 个 · 失败 1 个/],
  ["抽屉·累计花费", /累计花费[\s\S]{0,20}5 次调用 · RM 0\.43/],
  ["截断的步骤要看得见", /⚠️ 这一步的交付在写到长度上限时被掐断/],
];
const FORBID = [
  ["演示记忆格式残留", /D20764/],
  ["登录后仍显示今日花费", /今日花费/],
  ["未翻译的 purpose", /· plan ·|· execute ·/],
];

function patch() {
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  let out = src.replace("const REAL=()=>!!(sbc&&authed);", "const REAL=()=>window.__real||!!(sbc&&authed);");
  out = out.replace("window.__office={ready:true,",
    "window.__hook={task:t=>{S.tasks=[t];renderTasks(true);},agent:(id,g)=>{AG[id]=g;selectAgent(id);},ids:()=>S.agents.map(a=>a.id)};window.__office={ready:true,");
  if (out === src || !out.includes("window.__hook")) throw new Error("index.html 里找不到补丁锚点（REAL() 或 __office 改过了？）");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aio-views-"));
  const file = path.join(dir, "index.html");
  fs.writeFileSync(file, out);
  return { file, dir };
}

(async () => {
  const { file, dir } = patch();
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.route("https://cdn.jsdelivr.net/npm/**", (r) => {
    const u = r.request().url();
    const f = u.includes("supabase-js") ? "@supabase/supabase-js/dist/umd/supabase.js" : "three/" + u.split(/three@[\d.]+\//)[1];
    r.fulfill({ path: path.join(CACHE, f) });
  });
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());

  await page.goto("file://" + file, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__office && window.__office.ready, null, { timeout: 60000 });

  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button,[role=tab],.tab")].find((x) => /任务/.test(x.textContent || ""));
    if (b) b.click();
    return !!b && !document.querySelector("#pane-task").hidden;
  });
  await page.evaluate((t) => { window.__real = true; window.__hook.task(t); }, TASK);
  // 展开「过程与花费」，否则 innerText 读不到里面的内容
  await page.evaluate(() => { document.querySelectorAll("#pane-task details").forEach((d) => (d.open = true)); });
  const taskTxt = await page.evaluate(() => document.querySelector("#pane-task").innerText);

  const drawerTxt = await page.evaluate((g) => {
    const id = window.__hook.ids()[0];
    window.__hook.agent(id, g);
    const d = document.querySelector("#drawer");
    return d && !d.hidden ? d.innerText : "";
  }, AGENT);

  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });

  const txt = taskTxt + "\n" + drawerTxt;
  const fails = [];
  if (!opened) fails.push("打不开「任务」标签页");
  if (!drawerTxt) fails.push("员工抽屉没有打开");
  WANT.forEach(([n, re]) => { if (!re.test(txt)) fails.push("缺少真实数据：" + n); });
  FORBID.forEach(([n, re]) => { if (re.test(txt)) fails.push("混入演示数据：" + n); });
  errors.forEach((e) => fails.push(e));

  console.log(JSON.stringify({ pass: !fails.length, fails, checked: WANT.length + FORBID.length }));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log(JSON.stringify({ pass: false, fails: [e.message] })); process.exit(1); });
