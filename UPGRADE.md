# AI Office · 自动升级流程

这份文件是「系统自动升级」定时任务的工作说明。Dave 定的规则：

- **只有发现问题才改**，不为了改而改。
- 改之前先把「要做什么、解决什么问题」发给 Dave，**他批准一次**才动手。
- 批准后自己开发、自己测试、自己上线，**不能弄坏现有功能，不能变慢**；做不到就不上线，并告诉他原因。

## 环境

| 项目 | 值 |
|---|---|
| GitHub 仓库 | `dkainexus/ai-office`（`main` 推送后 Vercel 自动部署正式版） |
| 正式网址 | https://office.dkglobal.group （需要登录） |
| Vercel | team `team_Rg7PiiNKTvwWjrqIFnWs3nVb`，项目 `ai-office` |
| Supabase | 项目 `nabuuerjahwjsxsfgiuy`（新加坡） |
| Edge Functions | 源码在 `supabase/functions/<name>/index.ts`，用 Supabase 的 deploy_edge_function 部署，`verify_jwt: false`（函数自己验身份） |
| 上线前检查 | `node checks/run.js`（本地页面）/ `node checks/run.js --url https://office.dkglobal.group`（线上） |

Supabase 里和升级有关的东西：

- `feedback`：Dave 提的问题（Telegram 打字、网站后台），`status = open` 是没处理的。
- `upgrade_proposals`：升级提案，状态 `pending → approved / rejected → building → shipped / failed`。
- `select public.propose_upgrade(问题, 证据, 方案, 影响范围, 预计时间, array[feedback id]::bigint[])`：建提案并推 Telegram 审批（带按钮）。
- `select public.upgrade_report(提案 id, 状态, 结果说明, commit sha)`：更新状态；`shipped` / `failed` 会推 Telegram。

## 每次运行做什么

### A. 先做已批准的升级（每次最多一个）

1. `select * from upgrade_proposals where status = 'approved' order by id limit 1;` 没有就跳到 B。
2. `select upgrade_report(<id>, 'building', '开始开发');`
3. 从最新 `main` 开分支 `upgrade/<id>`，按提案的方案做**最小改动**。不碰无关功能，不加收费服务，不改密钥、登录、owner 权限，不放宽 RLS，不删数据。数据库只做增量迁移。
4. 跑 `node checks/run.js`。不通过就修，最多再试两次；还不通过：删分支，`upgrade_report(<id>, 'failed', '没上线：<原因>')`，结束。
   - 检查里的性能上限就是「不能变慢」的标准，**不许为了通过去调高基线**。只有指标变好（更低）时才可以 `--update-baseline` 一起提交。
5. 推送分支，等 Vercel 预览部署 READY（看构建日志没有错误）。
6. 合并到 `main` 并推送，等正式部署 READY。改了 Edge Function 的，合并后立刻部署对应函数；改了数据库的，用迁移执行。
7. 跑 `node checks/run.js --url https://office.dkglobal.group`。不通过就 `git revert` 合并提交并推送（Edge Function 也部署回旧版本），`upgrade_report(<id>, 'failed', '上线后检查没通过，已自动回滚：<原因>')`，结束。
8. `upgrade_report(<id>, 'shipped', '<一两句话：改了什么、怎么验证的>', '<commit sha>')`。

### B. 巡检（只在没有 pending / approved / building 的提案时做）

看这些地方，只找**真实存在的问题**：

- `feedback` 里 `open` 的问题。
- Supabase 过去 24 小时的 Edge Function 错误日志（runtime / telegram / gdrive）。
- `tasks` 里 `blocked` 的任务、`subtasks` 里 `failed` 或反复出错的步骤。
- Vercel 项目 `ai-office` 的运行错误。
- 当前 `main` 跑 `node checks/run.js` 是否通过。

处理方式：

- 发现问题：挑最重要的**一个**，写一份提案调用 `propose_upgrade`，把相关的 feedback id 一起传进去。问题、证据、方案、影响范围都用简短的中文，让 Dave 一眼看懂，比如「问题：3 个任务卡在拆解失败，原因是…；方案：…；影响：只改 runtime 函数的拆解部分；预计：30 分钟」。
- 反馈其实是要办公室**做的工作**（不是改系统）：插一条 `tasks`（`status = 'planning'`，`priority = '普通'`），把这条 feedback 标为 `done`。
- 反馈不需要改动（已经解决、重复）：标为 `ignored`。
- **什么问题都没有就什么都不做**，不发任何消息。

## 规则

- 无人值守，不要提问；拿不准的改动不要做，写进提案让 Dave 决定。
- 提交信息用中文说清楚改了什么。
- 不要输出或记录任何密钥。
