# 数据库基线

线上 Supabase 项目 `nabuuerjahwjsxsfgiuy`（新加坡）的结构快照，2026-11-07 从 `pg_catalog` 导出。

**为什么有这个目录**：在这之前，表结构、RPC 函数体、RLS 策略只存在于线上那一个库里，仓库里一份都没有。
意味着库没了就重建不出来，也没法 review 谁改了什么。`design/ROADMAP.md` 把这件事列为「缺口 0」。

**导出是只读的**，没有对线上执行任何变更。

## 为什么不是 `supabase/migrations/`

`design/ROADMAP.md` 的 WP-1 原话是放进 `supabase/migrations/`。这里改放 `supabase/schema/`，原因是：
`supabase/migrations/` 是 Supabase CLI 认的目录，一旦有人（或 `UPGRADE.md` 里那条自动升级流程）
跑了 `supabase db push`，这些文件会被当成「还没执行的迁移」推去线上。这是一份已经在线上跑着的结构的
快照，不是待执行的变更，放错地方的代价是动到生产库。

已执行的 11 个迁移仍然在线上的 `supabase_migrations.schema_migrations` 表里，名单见下。
以后的增量改动照 `UPGRADE.md` 的规矩走迁移，这个目录只在结构变了之后重新导一次。

## 文件

按编号顺序执行。

| 文件 | 内容 | 空库重建时 |
|---|---|---|
| `01_extensions.sql` | 7 个扩展 | 依赖 Supabase 平台 |
| `02_tables.sql` | 18 张表、29 个约束、3 个自建索引 | 可直接用 |
| `03_functions.sql` | 15 个函数、1 个触发器 | 可直接用 |
| `04_rls.sql` | 18 张表开 RLS、17 条策略、表与函数授权 | 可直接用 |
| `05_cron.sql` | 每分钟触发 runtime 的定时任务 | 依赖 pg_cron + Vault |

全部可重复执行（`if not exists` / `create or replace` / 先 `drop policy if exists`）。

## 在一个空的 Supabase 项目上重建

1. 按 01 → 05 的顺序跑。
2. `05_cron.sql` 之前要先有 `tg_admin` 这个密钥，否则定时任务取不到 `x-admin-key`：
   先建一个 Owner 账号并写进 `owners` 表，再调 `set_secret('tg_admin', ...)`。
3. 三个 Edge Function（`runtime` / `telegram` / `gdrive`）单独部署，`verify_jwt` 必须是 `false`。
4. `runtime_settings` 要有 `id = 1` 那一行（预算上限、模型路由、价目表），
   这是**数据**不是结构，不在这个目录里。

## 已执行的迁移（线上，按时间）

```
20261026133212  init_office_schema
20261026133258  owner_only_access
20261026185006  telegram_bridge
20261026185916  agent_runtime
20261026190023  agent_runtime_helpers
20261026190418  runtime_cron
20261026191249  runtime_search_path
20261026191741  budget_and_drive
20261026194248  self_upgrade
20261026194318  self_upgrade_functions
20261026194439  upgrade_decision_trigger
```

## 鉴权结构（导出时核实过）

- 18 张表全部开着 RLS。17 张挂 owner-only 策略；`oauth_states` 开了 RLS 但**故意没有策略**，
  等于对 anon / authenticated 全拒绝，只有 service_role 能碰。
- `authenticated` 只能执行 6 个函数：`is_owner`、`rt_day_spend`、`rt_month_spend`、
  `secret_status`、`set_budget`、`set_secret`。后两个会改数据，函数体里自己查 `is_owner()`。
- `tg_secret()` 会返回**解密后的密钥明文**，只授权给 `service_role`，网页端拿不到。
  `rt_set_secret()` 同样只给 `service_role`（它没有 `is_owner()` 检查，靠授权挡）。
- 15 个函数全部设了 `search_path = ''`。
- 三个 `rt_claim_*` 都用 `for update skip locked`，多个 runtime 实例同时跑不会认领到同一条；
  都带 10 分钟超时回收。（`design/ROADMAP.md` 的 REQ-072 把这点标为「证据不足」，现在有答案了。）

## 这份基线验证到什么程度

用 `md5` 把基线文件和线上 `pg_catalog` 逐项比对，全部一致：

| 对象 | 数量 | 结果 |
|---|---|---|
| 表 | 18 | 一致 |
| 列（含精确类型） | 148 | 一致 |
| 列默认值 | 52 | 一致 |
| 约束 | 29 | 一致 |
| 索引 | 21 | 一致 |
| 函数名 | 15 | 一致 |
| 函数体（逐个比） | 15 | 一致 |
| 策略 | 17 | 一致 |

**还没验证的**：这些 SQL 在一个真正的空库上跑不跑得通。
`checks/schema-rebuild.js` 就是干这个的 —— 起一个空 Postgres 把基线跑一遍再数对象。
但写这份基线的那台机器上 Windows 缺 UCRT，本地 Postgres 二进制起不来，所以这个检查**被跳过了**，
不是通过了。哪天有一台能跑 Postgres 的机器，`npm test` 会自动把它跑起来。

授权语句（`grant` / `revoke`）是照线上的 ACL 写的，但没有做哈希比对。
