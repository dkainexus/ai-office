#!/usr/bin/env node
// AI Office · pre-release checks
// Loads the page in headless Chromium (CDN libraries served from a local copy), drives every panel,
// and compares rendering cost / size / load time against checks/baseline.json.
//
//   node checks/run.js                    run checks against ./index.html
//   node checks/run.js --url https://...  run checks against a deployed page (login screen only)
//   node checks/run.js --update-baseline  record the current numbers as the new baseline
//
// Exit code 0 = pass, 1 = fail. Prints a JSON summary on the last line.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(__dirname, ".cache");
const BASE = path.join(__dirname, "baseline.json");
const args = process.argv.slice(2);
const url = args.includes("--url") ? args[args.indexOf("--url") + 1] : null;
const update = args.includes("--update-baseline");

function libs() {
  const nm = path.join(CACHE, "node_modules");
  if (!fs.existsSync(path.join(nm, "three/build/three.min.js")) || !fs.existsSync(path.join(nm, "@supabase/supabase-js/dist/umd/supabase.js"))) {
    fs.mkdirSync(CACHE, { recursive: true });
    execSync("npm i --silent --no-audit --no-fund --prefix . three@0.147.0 @supabase/supabase-js@2.45.4", { cwd: CACHE, stdio: "ignore" });
  }
  return nm;
}

(async () => {
  const nm = libs();
  const fails = [], notes = [];
  const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://cdn.jsdelivr.net/npm/**", (r) => {
    const u = r.request().url();
    const f = u.includes("supabase-js") ? "@supabase/supabase-js/dist/umd/supabase.js" : "three/" + u.split(/three@[\d.]+\//)[1];
    r.fulfill({ path: path.join(nm, f) });
  });
  await page.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ body: "", contentType: "text/css" }));
  await page.route("https://fonts.gstatic.com/**", (r) => r.abort());

  const t0 = Date.now();
  await page.goto(url || "file://" + path.join(ROOT, "index.html"), { waitUntil: "domcontentloaded" });
  const ev = (fn, a) => page.evaluate(fn, a);
  const result = { mode: url ? "deployed" : "local" };

  if (url) {
    // deployed: the login screen must render without errors
    await page.waitForTimeout(4000);
    const login = await ev(() => { const l = document.querySelector("#login"); return !!l && !l.hidden; });
    if (!login) fails.push("线上页面没有显示登录页");
  } else {
    try { await page.waitForFunction(() => window.__office && window.__office.ready, null, { timeout: 30000 }); }
    catch { fails.push("页面 30 秒内没有加载完成"); }
    result.loadMs = Date.now() - t0;
    await page.waitForTimeout(4000);

    // rendering cost: worst of several samples
    let worst = { calls: 0, tris: 0, geometries: 0, textures: 0 }, fps = [];
    for (let i = 0; i < 5; i++) {
      const st = await ev(() => window.__office && window.__office.stats());
      if (st) { for (const k of Object.keys(worst)) worst[k] = Math.max(worst[k], st[k] || 0); fps.push(st.fps); result.agents = st.agents; result.day = st.day; result.clock = st.clock; }
      await page.waitForTimeout(800);
    }
    Object.assign(result, worst, { fps: Math.min(...fps) });

    // clock follows real Singapore time
    const sgt = new Date(Date.now() + 8 * 3600e3);
    const realMin = sgt.getUTCHours() * 60 + sgt.getUTCMinutes();
    const diff = Math.abs((result.clock ?? -999) - realMin);
    if (Math.min(diff, 1440 - diff) > 2)
      fails.push(`办公室时间 ${result.clock} 和新加坡时间 ${realMin} 不一致`);
    if (!result.agents) fails.push("场景里没有 Agent");

    // every panel opens and renders content
    for (const tab of ["dec", "task", "team", "bld", "back", "log"]) {
      const len = await ev((t) => {
        const b = document.querySelector(`button[data-tab="${t}"]`); if (!b) return -1; b.click();
        const p = document.querySelector(`#pane-${t}`); return p ? p.innerText.trim().length : -1;
      }, tab);
      if (len <= 0) fails.push(`面板「${tab}」打不开或是空的`);
      await page.waitForTimeout(300);
    }
    // publishing a task works
    const ok = await ev(() => {
      document.querySelector('button[data-tab="task"]').click();
      const t = document.querySelector("#tTitle"); if (!t) return false;
      t.value = "自动检查任务"; document.querySelector("#tForm").requestSubmit();
      return true;
    });
    await page.waitForTimeout(800);
    const listed = ok && (await ev(() => document.querySelector("#pane-task").innerText.includes("自动检查任务")));
    if (!listed) fails.push("发布任务失败");
    result.htmlKB = Math.round(fs.statSync(path.join(ROOT, "index.html")).size / 1024);
  }

  if (errors.length) fails.push("页面报错：" + errors.slice(0, 3).join(" | "));
  await browser.close();

  // compare with baseline ("不能变慢")
  if (!url) {
    if (update) {
      fs.writeFileSync(BASE, JSON.stringify({ calls: result.calls, tris: result.tris, geometries: result.geometries, textures: result.textures, loadMs: result.loadMs, htmlKB: result.htmlKB, recorded: new Date().toISOString() }, null, 2) + "\n");
      notes.push("已更新基线");
    } else if (fs.existsSync(BASE)) {
      const b = JSON.parse(fs.readFileSync(BASE, "utf8"));
      const lim = { calls: b.calls * 1.1 + 5, tris: b.tris * 1.1 + 500, geometries: b.geometries * 1.15 + 5, textures: b.textures * 1.15 + 2, loadMs: b.loadMs * 1.6 + 1500, htmlKB: b.htmlKB * 1.25 + 10 };
      const name = { calls: "绘制次数", tris: "三角面数", geometries: "几何体数量", textures: "贴图数量", loadMs: "加载时间", htmlKB: "页面大小" };
      for (const k of Object.keys(lim)) if (result[k] > lim[k]) fails.push(`${name[k]}变多了：${result[k]}（基线 ${b[k]}，上限 ${Math.round(lim[k])}）`);
    } else notes.push("还没有基线，先运行 --update-baseline");
  }

  const summary = { pass: fails.length === 0, fails, notes, ...result };
  console.log(JSON.stringify(summary));
  process.exit(summary.pass ? 0 : 1);
})().catch((e) => { console.log(JSON.stringify({ pass: false, fails: ["检查脚本出错：" + e.message] })); process.exit(1); });
