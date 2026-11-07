-- AI Office · 基线：表、约束、索引
-- 从线上项目 nabuuerjahwjsxsfgiuy 导出（只读导出，没有对线上执行任何变更）。
-- 可重复执行。

-- ---------- 表 ----------

create table if not exists public.agent_memories (
  id bigint generated always as identity not null,
  agent_id text not null,
  content text not null,
  embedding vector(1536),
  created_at timestamp with time zone default now() not null
);

create table if not exists public.agents (
  id text not null,
  name text not null,
  role text not null,
  prompt text default ''::text,
  look jsonb default '{}'::jsonb not null,
  desk text,
  created_at timestamp with time zone default now() not null,
  dept text,
  title text,
  level integer default 1 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.budget_log (
  id bigint generated always as identity not null,
  kind text not null,
  amount numeric(12,2),
  before_rm numeric(12,2),
  after_rm numeric(12,2),
  task_id text,
  decision_id text,
  note text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.decisions (
  id text not null,
  agent_id text,
  title text not null,
  detail text,
  review text,
  options jsonb default '[["批准", "yes"], ["驳回", "no"]]'::jsonb not null,
  status text default 'pending'::text not null,
  choice text,
  note text,
  task_id text,
  created_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  kind text default 'final'::text not null,
  handled boolean default false not null
);

create table if not exists public.feedback (
  id bigint generated always as identity not null,
  source text default 'web'::text not null,
  content text not null,
  status text default 'open'::text not null,
  proposal_id bigint,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.integrations (
  id text not null,
  name text not null,
  kind text not null,
  status text default '待配置'::text not null,
  requested_by text,
  config jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.messages (
  id bigint generated always as identity not null,
  thread text not null,
  agent_id text,
  content text not null,
  model text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.model_calls (
  id bigint generated always as identity not null,
  agent_id text,
  model text not null,
  host text not null,
  cost numeric(12,4) default 0 not null,
  task_id text,
  verdict text default 'approve'::text not null,
  created_at timestamp with time zone default now() not null,
  tokens_in integer,
  tokens_out integer,
  usd numeric(12,6),
  purpose text
);

create table if not exists public.oauth_states (
  state text not null,
  provider text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.office_state (
  id text default 'main'::text not null,
  data jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.owners (
  user_id uuid not null,
  username text not null
);

create table if not exists public.runtime_settings (
  id integer default 1 not null,
  data jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.subtasks (
  id text not null,
  task_id text not null,
  dept text not null,
  title text not null,
  agent_id text,
  status text default 'todo'::text not null,
  output_url text,
  created_at timestamp with time zone default now() not null,
  seq integer default 1 not null,
  instructions text,
  output text,
  attempts integer default 0 not null,
  error text,
  model text,
  cost numeric(12,4) default 0 not null,
  started_at timestamp with time zone,
  finished_at timestamp with time zone
);

create table if not exists public.tasks (
  id text not null,
  title text not null,
  description text default ''::text,
  priority text default '普通'::text not null,
  status text default 'planning'::text not null,
  conclusion text,
  cost numeric(12,4) default 0 not null,
  drive_folder_url text,
  created_at timestamp with time zone default now() not null,
  needs_final boolean default false not null,
  plan_note text,
  rework_note text,
  budget_rm numeric(12,2) default 20 not null,
  started_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  version integer default 1 not null
);

create table if not exists public.telegram_actions (
  id bigint generated always as identity not null,
  decision_id text not null,
  choice text not null,
  kind text not null,
  applied_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.telegram_messages (
  ref text not null,
  kind text not null,
  message_id bigint,
  status text default 'pending'::text not null,
  choice text,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.upgrade_proposals (
  id bigint generated always as identity not null,
  problem text not null,
  evidence text,
  plan text not null,
  impact text,
  eta text,
  status text default 'pending'::text not null,
  decision_id text,
  result text,
  commit_sha text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- secret_id 指向 Supabase Vault 里的密钥；密钥本身不在这张表里，也不在这个仓库里。
create table if not exists public.vault_items (
  id text not null,
  name text not null,
  kind text not null,
  roles text[] default '{}'::text[] not null,
  needs_approval boolean default false not null,
  secret_id uuid,
  uses integer default 0 not null,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

-- ---------- 主键 ----------

do $$ begin
  alter table public.agent_memories add constraint agent_memories_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.agents add constraint agents_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.budget_log add constraint budget_log_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.decisions add constraint decisions_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.feedback add constraint feedback_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.integrations add constraint integrations_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.messages add constraint messages_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.model_calls add constraint model_calls_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.oauth_states add constraint oauth_states_pkey primary key (state);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.office_state add constraint office_state_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.owners add constraint owners_pkey primary key (user_id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.runtime_settings add constraint runtime_settings_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.subtasks add constraint subtasks_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.telegram_actions add constraint telegram_actions_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.telegram_messages add constraint telegram_messages_pkey primary key (ref);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.upgrade_proposals add constraint upgrade_proposals_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;
do $$ begin
  alter table public.vault_items add constraint vault_items_pkey primary key (id);
exception when duplicate_object or duplicate_table or invalid_table_definition then null; end $$;

-- ---------- 检查约束 ----------
-- runtime_settings 只允许一行。

do $$ begin
  alter table public.runtime_settings add constraint runtime_settings_id_check check ((id = 1));
exception when duplicate_object then null; end $$;

-- ---------- 外键 ----------
-- 删任务时：子任务跟着删（cascade），花费/预算/审批记录保留但解除关联（set null），
-- 这样钱花过的记录不会因为删任务而消失。

do $$ begin
  alter table public.agent_memories add constraint agent_memories_agent_id_fkey
    foreign key (agent_id) references public.agents(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.budget_log add constraint budget_log_task_id_fkey
    foreign key (task_id) references public.tasks(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.decisions add constraint decisions_agent_id_fkey
    foreign key (agent_id) references public.agents(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.decisions add constraint decisions_task_id_fkey
    foreign key (task_id) references public.tasks(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.messages add constraint messages_agent_id_fkey
    foreign key (agent_id) references public.agents(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.model_calls add constraint model_calls_agent_id_fkey
    foreign key (agent_id) references public.agents(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.model_calls add constraint model_calls_task_id_fkey
    foreign key (task_id) references public.tasks(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.owners add constraint owners_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.subtasks add constraint subtasks_agent_id_fkey
    foreign key (agent_id) references public.agents(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.subtasks add constraint subtasks_task_id_fkey
    foreign key (task_id) references public.tasks(id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ---------- 索引 ----------

create index if not exists agent_memories_agent_idx on public.agent_memories using btree (agent_id, created_at desc);
create index if not exists messages_thread_idx on public.messages using btree (thread, created_at);
create index if not exists subtasks_task_idx on public.subtasks using btree (task_id);
