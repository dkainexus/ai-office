# DK Global Group · AI Office

3D AI Agent 办公室。前端为单页 `index.html`（three.js），后台为 Supabase 项目 `ai-office`（数据库、登录、金库）。

- 正式地址：https://office.dkainexus.com
- 部署：推送到 `main` 后由 Vercel 自动部署

## 本地准备

网站本身不需要构建，直接用浏览器打开 `index.html` 就能看（本地模式免登录，数据是模拟的）。
但**上线前检查和测试需要 playwright**，装一次即可：

```
npm run setup
```

（等同于 `npm install` 再 `npx playwright install chromium chromium-headless-shell`。）

## 检查与测试

| 命令 | 跑什么 |
|---|---|
| `npm run check` | 上线前检查：本地打开页面，比对 `checks/baseline.json` 的性能上限（绘制调用、三角面、几何体、贴图、加载时间、页面体积）。**不许为了通过去调高基线。** |
| `npm run check:live` | 同上，但打的是线上地址。合并到 `main`、Vercel 部署完成后应当跑一次。 |
| `npm test` | 两个功能检查，见下。 |

`npm test` 包含：

- **`checks/backend-real.js`** — 后台「登录后」渲染检查。`checks/run.js` 用 `file://` 打开页面，`REAL()` 永远是 false，后台登录后那半边代码一行都跑不到；这个检查把 `index.html` 复制一份打补丁后喂固定假数据，断言页面只显示真实数据、不混入任何 3D 演示用的模拟数字。不连 Supabase，不碰线上。
- **`checks/real-views.js`** — 登录后「任务卡」和「员工抽屉」的渲染检查。同样打补丁喂假数据，断言任务卡的「过程与花费」把 `messages` 和 `model_calls` 原样显示出来、合计对得上，员工抽屉的记忆来自 `agent_memories`、统计等于表里的聚合，并且不出现演示用的记忆格式。
- **`checks/approval.js`** — 判断「这个任务要不要 Dave 亲自审批」的逻辑检查。直接从 `supabase/functions/runtime/index.ts` 抠出实际代码来跑，改了 runtime 就会在这里反映出来。
- **`checks/truncation.js`** — 判断「模型这次写完了，还是写到上限被掐断」的逻辑检查。同样直接从 `supabase/functions/runtime/index.ts` 抠出实际代码来跑。漏判比误判危险：漏判就是拿残稿当成品交付。
- **`checks/schema-rebuild.js`** — 数据库基线重建检查。起一个全新的空 Postgres，把 `supabase/schema/` 的基线真跑一遍，再数建出来的表/函数/策略对不对得上线上。本机没装 Postgres（或装了跑不起来）就跳过，不算失败。

## 后台

`supabase/functions/` 下三个 Edge Function：

- `runtime` — 核心。每分钟由 pg_cron 触发，也可由 Owner 手动触发。项目经理拆解任务 → 各成员执行 → 项目经理验收 → 需要时推审批给 Dave → 交付存进 Google Drive。记成本、管预算、维护每个员工的记忆、发每日简报。
- `telegram` — 审批推送与回传、每日简报、问题收集。
- `gdrive` — 交付归档到 Google Drive。

改完要用 Supabase 的 `deploy_edge_function` 部署，`verify_jwt` 必须保持 `false`（函数自己做鉴权：`x-admin-key` 或 Owner 的 JWT；pg_cron 用前者）。

## 数据库结构

`supabase/schema/` 是线上库结构的基线快照：18 张表、15 个函数、17 条 RLS 策略、1 个定时任务。
在这之前这些东西只存在于线上那一个库里，仓库里没有，库没了就重建不出来。

说明和重建步骤见 [supabase/schema/README.md](supabase/schema/README.md)。
**它是快照不是待执行的迁移**，所以没放在 `supabase/migrations/`（那个目录会被 `supabase db push` 推去线上）。
以后结构改动照 UPGRADE.md 走增量迁移，改完重新导一次基线。

## 日常改动的规矩

见 [UPGRADE.md](UPGRADE.md)。
