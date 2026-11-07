// 后台「登录后」渲染检查。
//
// checks/run.js 用 file:// 打开页面，REAL() 永远是 false，所以后台登录后的那半边代码
// 它一行都跑不到。这个检查补上那一半：把 index.html 复制一份、打上三个小补丁
// （放开 REAL()、把 BUD 和 renderBack 暴露出来），喂进一份固定的假数据，
// 然后断言页面只显示真实数据，不出现任何模拟数字。
//
// 不连 Supabase，不碰线上，不改仓库里的 index.html。
//   node checks/backend-real.js
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const CACHE = path.join(ROOT, "checks", ".cache", "node_modules");

// 固定输入：一个任务的四次真实模型调用 + 金库里三条凭证。
const BUD = {
  st: {
    monthly_cap_rm: 3000, task_budget_rm: 20, task_topup_rm: 20, month_topup_rm: 1000,
    models: { smart: ["anthropic:claude-sonnet-5-5", "openai:gpt-5"], fast: ["openai:gpt-5-mini", "anthropic:claude-haiku-5-5"] },
  },
  month: 0.5145, day: 0.5145, log: [], ups: [], fb: [],
  calls: [
    { model: "claude-sonnet-5-5", host: "anthropic", purpose: "review",  cost: 0.0546, tokens_in: 2586, tokens_out: 339,  task_id: "t1", created_at: "2026-11-07T03:50:04Z" },
    { model: "claude-sonnet-5-5", host: "anthropic", purpose: "execute", cost: 0.1687, tokens_in: 1943, tokens_out: 2257, task_id: "t1", created_at: "2026-11-07T03:49:53Z" },
    { model: "gpt-5-mini",        host: "openai",    purpose: "execute", cost: 0.0866, tokens_in: 1328, tokens_out: 1093, task_id: "t1", created_at: "2026-11-07T03:49:37Z" },
    { model: "claude-sonnet-5-5", host: "anthropic", purpose: "plan",    cost: 0.1299, tokens_in: 1149, tokens_out: 1808, task_id: "t1", created_at: "2026-11-07T03:49:17Z" },
  ],
  vault: [
    { id: "p_claude_key", name: "Claude（Anthropic） · API Key", kind: "apikey", needs_approval: false, uses: 0, last_used_at: null },
    { id: "p_openai_key", name: "GPT（OpenAI） · API Key",       kind: "apikey", needs_approval: false, uses: 0, last_used_at: null },
    { id: "p1_token",     name: "Telegram 机器人 · Bot Token",   kind: "bot",    needs_approval: true,  uses: 0, last_used_at: null },
  ],
};

// 必须出现：全部来自上面的真实数据
const WANT = [
  ["真实花费 KPI",         /今日[\s\S]{0,40}RM 0\.51/],
  ["真实模型用量标题",     /模型用量（真实，最近 4 次调用）/],
  ["按模型聚合 claude",    /claude-sonnet-5-5[\s\S]{0,80}3 次 · RM 0\.35/],
  ["按模型聚合 gpt",       /gpt-5-mini[\s\S]{0,80}1 次 · RM 0\.09/],
  ["真实路由 smart",       /重要 \/ 技术[\s\S]{0,60}claude-sonnet-5-5 → gpt-5/],
  ["真实路由 fast",        /日常[\s\S]{0,60}gpt-5-mini → claude-haiku-5-5/],
  ["调用记录",             /验收[\s\S]{0,80}claude-sonnet-5-5 · RM 0\.0546/],
  ["真实金库名",           /Claude（Anthropic） · API Key/],
  ["Key 用量来自真实流水", /最近 4 次模型调用里，这把 Key 用了 3 次/],
  ["无法统计的凭证如实说", /后台暂未统计这类凭证的使用次数/],
];
// 不得出现：这些全是 3D 演示用的模拟数据
const FORBID = [
  ["模拟 KPI 自建占比",   /自建占比/],
  ["模拟 GPU 开关",       /自建 GPU 服务器/],
  ["模拟模型 Claude Opus",/Claude Opus/],
  ["模拟路由 视频生成",   /视频生成/],
  ["模拟金库 公司网银",   /公司网银登录/],
  ["模拟金库登记表单",    /登记新凭证/],
  ["演示字样残留",        /（演示）/],
];

function patch() {
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  let out = src.replace("const REAL=()=>!!(sbc&&authed);", "const REAL=()=>window.__real||!!(sbc&&authed);");
  out = out.replace("let BUD=null;", "let BUD=null;window.__setBUD=b=>{BUD=b;};window.__back=()=>renderBack(true);");
  if (out === src) throw new Error("index.html 里找不到补丁锚点（REAL() 或 BUD 的定义改过了？）");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aio-back-"));
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
    const b = [...document.querySelectorAll("button,[role=tab],.tab")].find((x) => /后台/.test(x.textContent || ""));
    if (b) b.click();
    return !!b && !document.querySelector("#pane-back").hidden;
  });
  await page.evaluate((b) => { window.__real = true; window.__setBUD(b); window.__back(); }, BUD);
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const e = document.querySelector("#pane-back");
    return {
      txt: e.innerText,
      // 模型行在登录后没有开关按钮，确认布局没有因此塌掉
      mrow: [...e.querySelectorAll(".mrow")].map((x) => x.children.length),
      overflow: [...e.querySelectorAll("*")].filter((x) => x.scrollWidth > x.clientWidth + 2 && getComputedStyle(x).overflowX !== "auto").length,
    };
  });
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });

  const fails = [];
  if (!opened) fails.push("打不开「后台」标签页");
  WANT.forEach(([n, re]) => { if (!re.test(r.txt)) fails.push("缺少真实数据：" + n); });
  FORBID.forEach(([n, re]) => { if (re.test(r.txt)) fails.push("混入模拟数据：" + n); });
  if (r.overflow) fails.push(`有 ${r.overflow} 个元素横向溢出`);
  errors.forEach((e) => fails.push(e));

  console.log(JSON.stringify({ pass: !fails.length, fails, checked: WANT.length + FORBID.length, mrow: r.mrow }));
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.log(JSON.stringify({ pass: false, fails: [e.message] })); process.exit(1); });
