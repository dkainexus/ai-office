// 基线重建检查。
//
// supabase/schema/ 里的基线是从线上导出的。导出对不对，不能靠看 —— 这个检查
// 起一个全新的空 Postgres，把基线真跑一遍，再数一遍建出来的东西，
// 和线上的数量对不上就报错。
//
// 跑的是 02_tables / 03_functions / 04_rls 这三份「我们自己的结构」。
// 01_extensions 和 05_cron 依赖 Supabase 平台（pg_cron / pg_net / Vault），
// 本地装不了，改用 checks/schema-stubs.sql 的替身顶替，见那个文件的说明。
// 唯一替换掉的类型是 vector(1536) → text（本地没有 pgvector）。
//
// 没装 Postgres 就跳过，不算失败 —— 这台机器上装不装 psql 不该决定代码能不能上线。
//   node checks/schema-rebuild.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCHEMA = path.join(ROOT, "supabase", "schema");

// 线上实际数量（由 pg_catalog 查出，见 supabase/schema/README.md）
const EXPECT = { tables: 18, functions: 15, policies: 17, indexes: 21, triggers: 1, rls_tables: 18 };

const out = (o) => { console.log(JSON.stringify(o)); process.exit(o.pass ? 0 : 1); };

function bin(name) {
  const exe = process.platform === "win32" ? name + ".exe" : name;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [exe], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
}

const initdb = bin("initdb"), pg_ctl = bin("pg_ctl"), psql = bin("psql");
if (!initdb || !pg_ctl || !psql) out({ pass: true, skipped: "本机没有 Postgres（initdb/pg_ctl/psql），跳过基线重建检查" });

// 装了但跑不起来也要跳过，不要报成基线有问题。
// 已知一种：Windows 缺 UCRT 时 initdb.exe 会以 0xC0000135（找不到 DLL）退出。
{
  const r = spawnSync(initdb, ["--version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) {
    const why = (r.stderr || r.error?.message || `退出码 ${r.status}`).trim().split(/\r?\n/)[0];
    out({ pass: true, skipped: `本机 Postgres 跑不起来，跳过基线重建检查：${why}` });
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aio-schema-"));
const data = path.join(dir, "pg");
const sock = path.join(dir, "sock");
const port = 5000 + Math.floor(Math.random() * 2000);
let started = false;

const run = (file, args, opts = {}) =>
  execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

function sql(text, { quiet = false } = {}) {
  const f = path.join(dir, "q.sql");
  fs.writeFileSync(f, text);
  return run(psql, ["-v", "ON_ERROR_STOP=1", "-X", "-q", "-At",
    "-h", process.platform === "win32" ? "127.0.0.1" : sock, "-p", String(port),
    "-d", "postgres", "-U", "postgres", "-f", f], quiet ? { stdio: ["ignore", "pipe", "ignore"] } : {});
}

try {
  fs.mkdirSync(sock, { recursive: true });
  run(initdb, ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--no-sync"]);
  const logf = path.join(dir, "pg.log");
  const listen = process.platform === "win32"
    ? `-p ${port} -c listen_addresses=127.0.0.1`
    : `-p ${port} -c listen_addresses='' -c unix_socket_directories=${sock}`;
  run(pg_ctl, ["-D", data, "-l", logf, "-o", listen, "-w", "-t", "60", "start"]);
  started = true;

  const read = (f) => fs.readFileSync(path.join(SCHEMA, f), "utf8");
  sql(fs.readFileSync(path.join(__dirname, "schema-stubs.sql"), "utf8"));
  sql(read("02_tables.sql").replace(/vector\(1536\)/g, "text"));
  sql(read("03_functions.sql"));
  sql(read("04_rls.sql"));

  const got = JSON.parse(sql(`select json_build_object(
    'tables',    (select count(*) from pg_tables where schemaname='public'),
    'functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
    'policies',  (select count(*) from pg_policies where schemaname='public'),
    'indexes',   (select count(*) from pg_indexes where schemaname='public'),
    'triggers',  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
                   join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal),
    'rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relkind='r' and c.relrowsecurity))::text;`).trim());

  const fails = [];
  for (const [k, want] of Object.entries(EXPECT)) {
    if (got[k] !== want) fails.push(`${k}：基线建出 ${got[k]}，线上是 ${want}`);
  }

  // tg_secret 会返回密钥明文，必须只有 service_role 能调
  const leak = sql(`select coalesce(string_agg(r, ','), '') from (
    select unnest(array['anon','authenticated','public']) r) x
    where has_function_privilege(r, 'public.tg_secret(text)', 'execute');`).trim();
  if (leak) fails.push(`tg_secret 对 ${leak} 开放了执行权限（它会返回密钥明文）`);

  out({ pass: !fails.length, fails, built: got });
} catch (e) {
  out({ pass: false, fails: [(e.stderr || e.message || String(e)).trim().split(/\r?\n/).slice(-6).join(" / ")] });
} finally {
  try { if (started) run(pg_ctl, ["-D", data, "-m", "immediate", "-w", "-t", "30", "stop"]); } catch {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
