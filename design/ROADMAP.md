# AI Office 对照路线图：设计 80 条需求 vs 现有实现

写给 Dave。日期 2026-11-07。性质：**分析材料**，不是批准凭据。

## 进展（2026-11-07 晚补记）

§4 列的 5 个「可以立刻动手」的工作包**全部做完并上线**：

| | 内容 | 状态 |
|---|---|---|
| WP-1 | 数据库结构入仓 | 已上线 · `supabase/schema/`（放 schema 不放 migrations，理由见那边的 README） |
| WP-2 | 后台「真实 / 模拟」分离 | 已上线 · 登录后不再出现 `Math.random` 产生的花费与审核记录 |
| WP-3 | 任务时间线与成本明细 | 已上线 · 任务卡「过程与花费」读 `messages` + `model_calls` |
| WP-4 | 员工档案与真实记忆 | 已上线 · 抽屉读 `agent_memories`，统计来自表内聚合 |
| WP-5 | 卡住任务检测 | 已上线 · runtime `stuckWatch`，沿用现有 Telegram 通道 |

下面 §2 的 80 条评分**没有重算**。这 5 个工作包提升了若干「部分」条目的质量，
但没有把任何一条从「部分」翻成「已做」，所以 已做 1 / 部分 24 / 未做 55 的统计仍然成立。

两处原文标「未见 / 证据不足」的，导出 schema 时查清楚了，更正如下：

- **REQ-072**：`rt_claim_*` 的函数体确认使用 `for update skip locked` + 10 分钟超时回收，
  **防重复认领是成立的**（原文写「只能『证据不足』」）。
- **缺口 0 的「schema 不在仓库」已解决**；同一条里「三张真实表前端从未读取」也已解决
  （`messages`、`model_calls`、`agent_memories` 现在都读了）。

> 设计包仍处于 DESIGN LOCK（`CLAUDE.md` 与 `APPROVAL_RECORD` 口径：未批准开发）。本文只说"现有实现做到哪了"，不代表任何阶段或条目已获批。动手前仍需 Dave 在真实对话里指定基线版本、阶段和需求清单。
> 现有实现是设计包之外先行上线的（`office.dkainexus.com`）。设计包 `CLAUDE.md` 的"不建迁移、不连真实账户、不付费调用"对它并不成立，这一点需要 Dave 知道：后续开发要么纳入某个已批准基线，要么单独声明为"现状维护"。

## 0. 阅读方式与依据

- 设计来源：`AI_Office_Master_Design.md`（需求登记册、PRD、技术规格、数据库、API、计费、权限、记忆、运维、UI、分阶段计划、DEC、ADR）。原型 `AI_Office_Prototype.html` 与 `Architecture_Atlas.html` 未逐页比对，需求清单以主设计文档为准。
- 实现来源：`index.html`（下称 FE）、`supabase/functions/runtime|telegram|gdrive/index.ts`（下称 RT / TG / GD）、`UPGRADE.md`、`checks/run.js`，加上你提供的已建表清单与迁移名单。
- **没读到的东西一律写"未见"**：仓库里没有 `supabase/migrations`，所以表字段、RPC 函数体（`rt_claim_*`、`set_secret`、`is_owner`、RLS 策略）我没看到，只能从调用处推断。
- 状态：**已做** / **部分** / **未做**。"部分"按最宽的口径也要有可运行的代码或表作证据；纯前端随机模拟不算。

## 1. 一句话结论

现有实现约等于设计 **Phase 1A/1B 的"单 Owner 内部薄切片"**：Owner 发任务 → PM 模型拆解 → 员工模型执行 → PM 验收 → 最终审批（网页/Telegram）→ 交付存 Google Drive，外加预算上限、每日简报和系统自升级流程。**Phase 1C（Partner、钱包、账本、多用户隔离）、Phase 2、Phase 3 基本没有开始。**

按下表统计（见 §2 末尾）：80 条里 已做 1、部分 24、未做 55；其中 Phase 3（057-070）14 条全部未做，符合暂缓状态。

另有一个需要留意的事实：FE 里大量"公司运转"（会议、PM 代决、异常暂停、花费、金库使用次数）是前端随机模拟，真实数据在 Supabase 的表里，两者混在同一个后台页面（见 §3 缺口 0）。

## 2. 80 条需求对照表

阶段列写法："Phase 1 · 已确认" = 设计阶段 + 登记册业务状态（已确认/建议/待决定）。REQ-071~080 保持"待决定"（待确认），REQ-057~070 保持 Phase 3（暂缓），本文不改动这些状态。

| 编号 | 需求 | 设计阶段 | 现状 | 证据 | 备注 |
|---|---|---|---|---|---|
| REQ-001 | 自主 AI 企业与长期自主运作 | Phase 1 · 已确认 | 部分 | RT 头部注释 2-3 行（pg_cron 每分钟 + 手动触发）；`tick` RT:356-402；迁移 `runtime_cron` | 任务可无人值守跑完，但无 CoS 监督、无暂停/接管、无幂等保证 |
| REQ-002 | 长期 AI 员工 | Phase 1 · 已确认 | 部分 | 表 `agents`、`agent_memories`；FE:1573-1578 同步员工；RT:107-110 | 员工 ID 与模型脱钩（模型在 RT:83-95 轮换）；无履历/技能版本 |
| REQ-003 | Employee CRM 员工档案 | Phase 1 · 已确认 | 部分 | 表 `agents`（name/role/title/dept/level/prompt/look，见 FE:1574）；员工抽屉 FE:1705-1709 | 只有基础档案，无绩效、技能、近期交付、成本履历 |
| REQ-004 | Multimedia / Systems 两大生产中心 | Phase 1 · 已确认 | 未做 | FE:396 `DEPTS` 是 9 个扁平部门；FE:402-423 `ROLES` | 现为通用公司部门模型，没有两中心 + Global 的结构 |
| REQ-005 | Global 共享职能 | Phase 1 · 建议 | 未做 | 未见 | "管理层/项目管理"只是普通部门 |
| REQ-006 | 能力持续开发 | Phase 1 · 建议 | 未做 | 未见 | 系统自升级（UPGRADE.md）是改系统本身，不是员工能力；FE:1549 文案说"Agent 会自动开发插件"，代码里未见实现 |
| REQ-007 | 预算管理 | Phase 1 · 建议 | 已做（仅内部） | 表 `runtime_settings`、`budget_log`；`execute` 超额暂停+追加审批 RT:205-216；月上限 RT:366-375；`applyDecisions` RT:312-326；FE 预算表单 1620-1631、1642-1645；RPC `set_budget`、`rt_month_spend`、`rt_day_spend` | 单一 Owner 预算；无 Partner 周期预算（见 REQ-048） |
| REQ-008 | API 与模型管理 | Phase 1 · 建议 | 部分 | RT:51-95（价格表 `prices_usd_per_mtok` 来自 `runtime_settings`）；FE:484-486 Claude/GPT Key 入口；FE:1671 `set_secret` | 无模型目录、价目版本；FE 的 `MODELS0` 463-470 是模拟 |
| REQ-009 | Model Router | Phase 1 · 已确认 | 部分 | `callModel` RT:83-95：smart/fast 两档、跨 Anthropic/OpenAI 回退；调用选档 RT:232 | 无敏感度/质量阈值/成本比较，不记录路由理由；FE `ROUTES`(471)/`route`(1237) 是前端模拟 |
| REQ-010 | Compute Pool | Phase 1 · 建议 | 未做 | FE:1540 "自建 GPU 服务器"开关只改本地状态 S.selfOnline | 纯模拟，无真实节点 |
| REQ-011 | AI Chief of Staff | Phase 1 · 已确认 | 部分 | `pickPM` RT:111；`plan`/`conclude` RT:159-199, 266-290；`dailyBrief` RT:332-352 | PM 角色承担拆解/验收/汇报；没有"主动监督停滞、跨部门协调"的 CoS 逻辑 |
| REQ-012 | B 型交互式控制后台 | Phase 1 · 已确认 | 部分 | FE 任务/审批/预算面板 1481-1516、1536-1563；表 `messages` 由 RT:120-122 写入 | Owner 能发任务、批准、看交付；不能进入讨论、暂停、接管。`messages` 表有数据但 FE 从未读取（grep 无 `messages` 查询） |
| REQ-013 | 授权机制 | Phase 1 · 已确认 | 部分 | 表 `decisions`；`addDecision` RT:142-150；`applyDecisions` RT:293-329；TG 按钮回传 TG:122-155 | 有 Owner 审批链；无 payload_hash 绑定、过期、一次消费；FE 金库"每次需批准"(1555)仅是界面标签，后端强制未见 |
| REQ-014 | 需求管理系统 | Phase 1 · 已确认 | 部分 | 表 `tasks`（title/description/priority/version/rework_note）；返工 RT:302-311 | 只有任务，没有项目、需求登记、修订、范围状态 |
| REQ-015 | AI 独立长期记忆 | Phase 1 · 已确认 | 部分 | 表 `agent_memories`；`memories`/`remember` RT:112-118（取最近 12 条，截 500 字） | 无来源/作用域/可信度/有效期、无检索；FE 抽屉(1716)显示的是 office_state 里的本地记忆(1034)，不是此表 |
| REQ-016 | AI 自主学习与 Skill 更新 | Phase 2 · 已确认 | 未做 | 未见 | |
| REQ-017 | 中央 Skill Registry | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-018 | Global/Department/Personal Skills | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-019 | 公司统一标准与质量评估 | Phase 2 · 建议 | 未做 | 未见 | PM 验收是 LLM 自由文本(RT:270-273)，无标准 |
| REQ-020 | Skill 自动测试、发布与回滚 | Phase 2 · 建议 | 未做 | 未见 | 系统升级有回滚（UPGRADE.md 步骤 7），但对象不是 Skill |
| REQ-021 | Global Account Manager | Phase 1 · 已确认 | 部分 | 表 `vault_items`（经 RPC `set_secret`/`tg_secret`，FE:1671、RT:28-32）；FE 插件面板 1548-1551 | 只有密钥存取；无账号所有者/订阅到期/共享限制。FE `VAULT0`(472-481) 列表是本地模拟，FE:1553 自己注明"不保存真实密钥" |
| REQ-022 | 无 API 平台浏览器自动化 | Phase 1 · 已确认 | 未做 | RT:123-130 persona 明确"不能上网、不能操作外部系统" | |
| REQ-023 | 账号权限、Session 与凭证管理 | Phase 1 · 建议 | 部分 | Google OAuth：GD:150-171、176-188；refresh token 经 `rt_set_secret` 存入；失效提示 GD:61 | 仅 Google Drive 与 Telegram 一条链路；无 Session 状态、无按角色权限的服务端强制 |
| REQ-024 | 账号使用记录、订阅与成本统计 | Phase 1 · 建议 | 部分 | 表 `model_calls`（模型/tokens/RM/task_id/purpose，RT:96-104） | 只有模型成本，无账号/订阅成本；FE 金库"已调用次数"(1092、1260)是模拟 |
| REQ-025 | Account Scheduling 账号调度 | Phase 1 · 已确认 | 未做 | 未见 | |
| REQ-026 | Free Resource Hunter | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-027 | 免费 API/Credits 自动发现 | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-028 | 免费资源质量与可用性测试 | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-029 | 免费资源联动 Router | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-030 | AI Capacity Planning | Phase 2 · 已确认 | 未做 | 未见 | |
| REQ-031 | 算力负载与队列监控 | Phase 2 · 建议 | 未做 | 未见 | `rt_claim_*` 是任务认领，不是监控 |
| REQ-032 | 未来算力需求预测 | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-033 | 租用/自购/云端成本比较 | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-034 | 自动生成扩容提案与授权流程 | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-035 | 独立于模型设备的记忆与 VPS 主库 | Phase 1 · 已确认 | 部分 | 记忆/任务/账目都在 Supabase Postgres（表 `agent_memories`、`tasks` 等）；模型可换(RT:83-95) | 数据与模型脱钩已成立；但主库是 Supabase 托管（新加坡），不是设计写的 VPS（涉及 DEC-013，ADR-003） |
| REQ-036 | 自己的电脑仅作 Backup | Phase 1 · 已确认 | 未做 | 未见备份任务或恢复脚本 | Supabase 平台自身备份策略我没看到，不能算数 |
| REQ-037 | Multi-User 多用户登录与邀请 | Phase 1 · 建议 | 未做 | FE:1020-1029 用户名+密码单账号登录；表 `owners` | 只有 Owner |
| REQ-038 | Role & Permission | Phase 1 · 已确认 | 部分 | RPC `is_owner`（RT:38-44、TG:40-46、GD:30-36）；迁移 `owner_only_access`；全表 RLS owner-only | 只有"是不是 Owner"一个判断，无角色/权限枚举 |
| REQ-039 | Personal Workspace | Phase 1 · 已确认 | 未做 | 未见 | |
| REQ-040 | Shared Workspace | Phase 1 · 已确认 | 未做 | 未见 | |
| REQ-041 | Multi-Tenant 独立公司工作空间 | Phase 2 · 待决定 | 未做 | 未见 | 无 tenant_id（DEC-009） |
| REQ-042 | 用户操作、AI 授权及审计记录 | Phase 1 · 已确认 | 部分 | 分散的记录：`decisions`(decided_at)、`budget_log`、`telegram_messages`、`telegram_actions`、`model_calls` | 没有统一 `audit_events`，无 actor/trace_id，读取不留痕 |
| REQ-043 | Global Team 管理权限隔离 | Phase 1 · 已确认 | 未做 | 未见 | 无 Partner，隔离问题尚未出现 |
| REQ-044 | 授权用户只能调用开放能力与技能 | Phase 1 · 已确认 | 未做 | 未见 | 无 capability_grants |
| REQ-045 | Workspace/记忆/任务隔离 | Phase 1 · 已确认 | 未做 | 仅表级 owner-only RLS | 不是 Workspace 隔离 |
| REQ-046 | 统一 Partner 身份 | Phase 1 · 已确认 | 未做 | 未见（FE:397 `PARTNERS` 只是文案占位名） | |
| REQ-047 | Partner 独立 Subscription Fee（可 RM0） | Phase 1 · 已确认 | 未做 | 未见 | DEC-003/005 |
| REQ-048 | Partner 独立 AI Budget | Phase 1 · 已确认 | 未做 | 未见（现有预算是 Owner 的单一预算，见 REQ-007） | DEC-004 |
| REQ-049 | API Markup 计费 | Phase 1 · 已确认 | 未做 | 未见 | DEC-005 |
| REQ-050 | 平台 API + BYOK 双模式 | Phase 2 · 待决定 | 未做 | 未见 | DEC-007 |
| REQ-051 | 统一使用量计费与账单 | Phase 1 · 已确认 | 部分 | `model_calls` 有每次调用成本(RT:96-104)；`rt_add_cost` 累加到任务 | 只有内部成本计量；无 usage_event 去重、rate_version、收费、账单 |
| REQ-052 | Partner 预充值钱包 | Phase 1 · 已确认 | 未做 | 未见 | DEC-006/008 |
| REQ-053 | AI 资源使用自动扣费 | Phase 1 · 已确认 | 未做 | 未见 | |
| REQ-054 | 任务费用预留与实际结算 | Phase 1 · 已确认 | 未做 | 未见（现有为"到上限才暂停"，RT:205，不是预留） | |
| REQ-055 | 钱包交易账本与余额提醒 | Phase 1 · 已确认 | 未做 | 未见 | |
| REQ-056 | 免费赠送额度及特殊 Partner 定价 | Phase 2 · 建议 | 未做 | 未见 | |
| REQ-057 | 低成本 GPU 共享租赁池 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓；FE"自建 GPU"开关不属于此 |
| REQ-058 | 投资者与 GPU 资产管理 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-059 | 按实际使用量支付租金 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-060 | 每台 GPU 成本/利润/利用率分析 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-061 | 投资池联动 Compute Pool | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-062 | 每台 GPU 独立租金费率 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-063 | 使用时间追踪与自动释放 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-064 | 投资收益与回本进度 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-065 | 投资者家庭 GPU 节点 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-066 | 有任务才远程开机 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-067 | 空闲后自动关机 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-068 | 节点健康、网络与可用性监控 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-069 | 任务故障转移及重新调度 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-070 | 远程计算环境隔离与数据保护 | Phase 3（暂缓）· 建议 | 未做 | 未见 | 暂缓 |
| REQ-071 | AI Quality Assurance | Phase 1 基础/2 增强 · 待决定 | 部分 | `conclude` PM 验收 RT:266-290；`needs_final` 人工闸门 RT:190、21；打回返工 RT:302-311 | 只有 LLM 自评式验收 + 人工终审；无验收清单、自动检查、"失败测试阻止 completed" |
| REQ-072 | AI Workflow Engine | Phase 1 基础/2 增强 · 待决定 | 部分 | 步骤 seq 依赖 RT:169-170；认领 `rt_claim_plan/sub/conclude` RT:378-389；失败重试≤3 RT:241-247；任务状态存表 | 无 DAG 表、checkpoint、暂停/接管、外部动作 intent→receipt；`running` 标志(RT:355)只在单实例内有效。`rt_claim_*` 函数体未见，是否防重复认领只能"证据不足" |
| REQ-073 | AI Approval & Risk Engine | Phase 1 基础/2 增强 · 待决定 | 部分 | `FINAL_RE` 关键词触发终审 RT:21、190；预算/月度/终审三类审批 RT:293-329 | 无 A0–A3 分级、无 payload_hash/版本绑定、审批无过期 |
| REQ-074 | AI Evaluation System | Phase 1 基础/2 增强 · 待决定 | 未做 | 未见 | 原始数据已有（`model_calls.agent_id`、`subtasks.attempts/status`），但无评估逻辑或界面 |
| REQ-075 | AI Observability | Phase 1 基础/2 增强 · 待决定 | 部分 | `model_calls`（task_id/purpose）；失败推 Telegram RT:244、383；`checks/run.js` 上线前性能检查；UPGRADE.md B 巡检 | 无 trace_id、无告警分级、无对账；前端从不展示 `model_calls` |
| REQ-076 | AI Knowledge Management | Phase 1 基础/2 增强 · 待决定 | 未做 | 未见 | `agent_memories` 仅单员工流水记忆 |
| REQ-077 | AI Security & Isolation | Phase 1 基础/2 增强 · 待决定 | 部分 | 全表 RLS owner-only（迁移 `owner_only_access`）；密钥走 RPC 不进前端 FE:1553；TG 校验 chat id TG:126、137 与 webhook secret TG:163-166；Edge 函数 `isOwner/isAdmin` | 无注入边界/出网限制/沙箱；RLS 策略本体未见 |
| REQ-078 | AI Evolution & Experiment Lab | Phase 1 基础/2 增强 · 待决定 | 部分 | 表 `feedback`、`upgrade_proposals`；TG 收反馈 TG:130-133；FE:1632-1641；UPGRADE.md 完整提案→批准→检查→上线→回滚流程 | 覆盖"系统自己的升级"，不是 Skill/员工实验；与设计 078 的对象不同，只算相邻 |
| REQ-079 | AI Delivery & Publishing | Phase 1 基础/2 增强 · 待决定 | 部分 | `saveTask` GD:112-143 把交付存成 Drive 文档；终审后才标 done RT:280-289 | 无产物版本/sha256 清单、无对外发布 adapter 与 receipt |
| REQ-080 | AI Disaster Recovery | Phase 1 基础/2 增强 · 待决定 | 未做 | 未见备份/检查点/恢复演练 | 供应商回退只算 REQ-009 范围 |

**统计**（按上表逐行计数）：已做 1（REQ-007，仅内部范围）/ 部分 24 / 未做 55，合计 80。

## 3. 最大的缺口（按建议优先级）

### 缺口 0（先于一切的小事）：真实数据与前端模拟混在一起，且 schema 不在仓库
- **缺什么**：FE 的 `modelCall`/`charge`/`pmWatch`/`raiseDecision`（1238-1280、1148-1165）仍在 REAL 模式下随机生成"今日花费、自建占比、本月预算、PM 审核记录、金库调用次数"(1541、1547、1092)，而真实花费在 `model_calls`/`runtime_settings`。`messages`、`model_calls`、`agent_memories` 三张真实表前端从未读取。仓库没有 `supabase/migrations`，表结构和 RPC 函数体不受版本控制。
- **为什么重要**：Dave 看到的数字可能不是真的；也无法在空库上重建系统，REQ-080 与 Definition of Done 都做不到。
- **涉及**：REQ-075、024、051、012、015、042、080。**量级**：小。**被 DEC 卡住**：否。

### 缺口 1：身份、权限、审计底座
- **缺什么**：只有"是 Owner"一个判断。没有用户/角色/Workspace/capability_grants，没有统一 audit_events（actor、trace_id）。
- **为什么**：Partner、钱包、共享员工隔离都建立在它之上；不先做，后面全是返工。
- **涉及**：REQ-037~045、038、042、077、AC-03。**量级**：大。**DEC**：多公司范围受 DEC-009 限制（单 tenant 内的角色+审计本身不被阻塞，但属于新阶段，需单独批准）；DEC-010/011 影响角色定义。

### 缺口 2：任务可靠性与审批绑定
- **缺什么**：外部动作 intent→receipt、checkpoint、暂停/接管（fencing）、审批绑定 payload_hash 并可失效、风险分级。现在"通过"只是一个状态翻转（RT:293-329），改了内容也不会让旧审批失效。
- **为什么**：设计的核心价值（AC-01、AC-07、AC-08）；对外发布/付款之前必须有。
- **涉及**：REQ-072、073、013、071、001、012。**量级**：中到大。**DEC**：DEC-001（071-080 是否接受）、DEC-011、DEC-014（自动发布批准粒度）。

### 缺口 3：备份、恢复与监控
- **缺什么**：个人电脑/独立备份副本、恢复演练、卡住任务检测、告警分级、`model_calls` 可视化。
- **为什么**：现在所有任务、记忆、预算都只在一个托管库里，没有验证过的恢复路径。
- **涉及**：REQ-036、080、075、035。**量级**：中。**DEC**：DEC-013（备份位置、RPO/RTO，及 VPS vs Supabase）、DEC-018（告警渠道与接收人）。

### 缺口 4：计费、钱包、账本、预留
- **缺什么**：整套 Partner 商业链：合同、预算期、钱包科目、预留/结算、用量去重、支付验签、账单。
- **为什么**：设计的收入侧；但依赖缺口 1、2，且涉及金钱，必须最后做、最小范围先做。
- **涉及**：REQ-047~056、051、007（Partner 版）。**量级**：大。**DEC**：DEC-003、004、005、006、007、008、015、016 基本全卡。

### 缺口 5：员工与组织深度
- **缺什么**：两大中心 + Global 结构、CoS 主动监督、Employee CRM（履历/成绩/成本）、结构化记忆（来源/作用域/检索）、HR 自动扩编。
- **为什么**：让"长期员工"名副其实。
- **涉及**：REQ-002~005、011、015、074、076。**量级**：中到大。**DEC**：DEC-010（HR 扩编与工具权限）、DEC-011。现有 FE 的"缺部门就申请新建 Agent"(1118-1138、1195-1214) 是前端模拟，不算已做。

### 缺口 6：质量保证、评估、Skill 与进化
- **缺什么**：验收清单与自动检查、绩效评估、Skill Registry 与实验、免费资源、容量规划。
- **为什么**：Phase 2 的目标；基础设施（缺口 0、2）到位前价值有限。
- **涉及**：REQ-016~020、026~034、071、074、078。**量级**：大。**DEC**：DEC-001 卡 071-080；Phase 2 本身需单独批准。

### 缺口 7：Model Router / 账号 / 工具治理
- 现在只有 smart/fast 两档 + Anthropic/OpenAI 回退（RT:83-95）。无模型目录、质量阈值、租约式账号调度、浏览器自动化。涉及 REQ-008~010、021~025。量级中；DEC-007（BYOK）、DEC-010（工具安装权限）。

## 4. 可以立刻动手的下一步（候选，需 Dave 逐项批准）

下面 5 个都不涉及金钱、不放宽权限/RLS、不新建账号体系，也不被 DEC 阻塞。每项都应遵守 UPGRADE.md 的规矩：最小改动、`node checks/run.js` 通过、不调高性能基线。

### WP-1　把数据库结构纳入仓库（只导出，不改库）
- **目标**：用当前线上已有的 schema、RPC、cron、RLS 策略，生成可读的 `supabase/migrations/` 基线文件，与已执行的 11 个迁移名对应。
- **范围**：新增 `supabase/migrations/*.sql`（只读导出，不对线上执行任何变更）；`README.md` 补一段说明。
- **验收**：基线能在空 Supabase 项目上重建出同样的表/函数/策略；与线上逐表对比无差异；明确标出 `rt_claim_*`、`set_secret`、`is_owner` 的函数体，补齐本文标"未见"的证据。
- **关联**：REQ-080、077、072（核实防重复认领）。

### WP-2　后台"真实 / 模拟"分离
- **目标**：REAL 模式下，后台 KPI、模型/路由面板、PM 审核记录、金库使用次数要么读真实数据，要么清楚标注"演示"。
- **范围**：`index.html` 的 `modelCall`/`charge`/`pmWatch`/`raiseDecision`（约 1148-1280）、`renderBack`（1536-1563）；读取 `model_calls`、`runtime_settings`；不改表。
- **验收**：登录后（REAL）页面上不再出现由 `Math.random` 产生的花费或审核记录；今日/本月花费与 `rt_day_spend`/`rt_month_spend` 一致；`checks/run.js` 通过且不劣于 `baseline.json`。
- **关联**：REQ-075、024、051、012。

### WP-3　任务时间线与成本明细（只读）
- **目标**：任务卡上显示 `messages`（PM 拆解说明、完成记录、验收结论）和该任务每次 `model_calls`（模型、tokens、RM、用途）。
- **范围**：`index.html` 的 `rtSync`（1580-1611）与 `renderTasks`（1495-1516）；只读查询，沿用现有 RLS（owner-only）。
- **验收**：对一个真实完成的任务，时间线条目数与 `messages` 对得上，成本合计等于任务 `cost`；无新增写入。
- **关联**：REQ-012、075、042、051。

### WP-4　员工档案与真实记忆（只读 CRM 最小版）
- **目标**：员工抽屉改读 `agent_memories`，并汇总该员工已完成/失败步骤数、累计成本。
- **范围**：`index.html` 的 `renderDrawer`/`renderMem`（1693-1717）；只读 `agent_memories`、`subtasks`、`model_calls`。
- **验收**：抽屉里的记忆与 `agent_memories` 最近记录一致；统计数字与表内聚合一致；不显示/不写入任何密钥。
- **关联**：REQ-003、015、074（仅数据可见，不做评分）。

### WP-5　卡住任务检测（沿用现有 Telegram 渠道）
- **目标**：任务/步骤处于 `doing`/`active` 超过设定时间无进展时，发一条 Telegram 提醒给 Dave，并在后台标红。
- **范围**：`supabase/functions/runtime/index.ts` 增加一个检测函数（只读 `tasks`/`subtasks`、复用 `tg("report", …)`）；阈值放 `runtime_settings.data`。不新增接收人、不新建通知渠道。
- **验收**：构造一个超时的测试步骤，能收到且只收到一条（ref 去重）；正常任务不误报；不改变现有拆解/执行/验收行为。
- **关联**：REQ-075、011、072。说明：DEC-018 讨论的是试点阶段的告警渠道与接收人；本项只沿用现有对 Dave 的通道，如果 Dave 认为仍属 DEC-018 范围，应先搁置。

## 5. 必须先由 Dave 决定才能动的事

| DEC | 问什么 | 卡住什么 |
|---|---|---|
| DEC-001 | 是否接受 REQ-071~080 及其首期基础范围 | QA/Workflow/审批风险/评估/监控/知识/安全/进化/交付/恢复的正式立项 |
| DEC-002 | 001~070 的历史"建议"是否全部接受 | 逐条冻结（本表"建议"项都受影响） |
| DEC-003 | Partner 固定订阅是否从预充值钱包扣 | 订阅续费 |
| DEC-004 | 预算周期、滚存、跨期任务归属 | Partner 用量结算 |
| DEC-005 | 实际订阅价与 Markup 方式、比率、生效规则 | 收费上线 |
| DEC-006 | 现金/赠送消费顺序、有效期、退款、拒付 | 收款条款 |
| DEC-007 | 是否做 BYOK、平台费、可用模型 | BYOK 模块（默认关） |
| DEC-008 | 初始币种、汇率、税、舍入、支付供应商 | 正式收款 |
| DEC-009 | 多公司 Workspace 的上线范围 | 外部多租户（REQ-041） |
| DEC-010 | Global 岗位、HR 自主扩编与工具安装权限 | 自动扩权、缺部门自动招人 |
| DEC-011 | 员工 B 级自主性与 A0~A3 授权如何对应 | 日常自主执行策略 |
| DEC-012 | 每员工独立 Telegram Bot 的首期范围 | 多 Bot 消息集成（现为一个 Bot 对 Dave） |
| DEC-013 | 真实技术栈、VPS、备份位置、RPO/RTO | 基础设施：现状用 Supabase 托管而非 VPS+eve，是否追认需要你定 |
| DEC-014 | 自动发布/对外发送的批准粒度 | 自动交付 |
| DEC-015 | 盈利口径、固定成本分摊、收入归属 | 利润报表 |
| DEC-016 | 数据/审计保留期限与可删除范围 | 生产数据治理 |
| DEC-017 | Phase 3 计租、分润、唤醒硬件、责任 | 投资者节点（全部暂缓） |
| DEC-018 | 试点规模、预算阈值、告警渠道和接收人 | 试点发布 |

另有两件不在 DEC 清单里但同样要 Dave 拍板的事：
1. **设计基线批准本身**：指定基线版本（含 manifest 哈希）、要批的阶段和需求清单、排除项。本文不构成批准。
2. **现有线上实现的地位**：是追认为某个基线下的"现状"，还是按设计重做/重构。这决定缺口 1、2 是在现有代码上加，还是另起结构。
