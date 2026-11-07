// 「模型这次是写完了，还是写到上限被掐断」的判断检查。
//
// 直接从 supabase/functions/runtime/index.ts 抠出 truncated() 来跑，
// 所以改了 runtime 就会在这里反映出来，不会出现测试和线上两套逻辑。
//
// 背景：这个信号原本两家都没看。半截文稿被原样存进 subtasks.output、标成 done，
// 项目经理拿着残稿验收，Dave 收不到任何提示。实测撞到过一次：
// 阿杰那次调用 tokens_out 正好等于 max_tokens 6000。
//
// 判错的代价不对称：把完整的误判成截断，只是多一句没必要的警告；
// 把截断的漏判成完整，就是拿残稿当成品交付。所以漏判比误判危险。
//   node checks/truncation.js
const fs = require("fs");
const path = require("path");

const RT = path.join(__dirname, "..", "supabase", "functions", "runtime", "index.ts");
const src = fs.readFileSync(RT, "utf8");
const block = src.match(/function truncated\([\s\S]*?\n\}/);
if (!block) { console.log(JSON.stringify({ pass: false, fails: ["runtime/index.ts 里找不到 truncated()"] })); process.exit(1); }
const truncated = new Function(
  block[0].replace(/: string/g, "").replace(/: any/g, "") + "\nreturn truncated;"
)();

// [要不要判成截断, 说明, host, 响应体]
const CASES = [
  // Anthropic
  [true,  "Claude 写到上限",        "anthropic", { stop_reason: "max_tokens" }],
  [false, "Claude 正常写完",        "anthropic", { stop_reason: "end_turn" }],
  [false, "Claude 命中停止序列",    "anthropic", { stop_reason: "stop_sequence" }],
  [false, "Claude 没给 stop_reason","anthropic", {}],
  [false, "Claude 响应是 null",     "anthropic", null],
  // OpenAI
  [true,  "GPT 写到上限",           "openai",    { choices: [{ finish_reason: "length" }] }],
  [false, "GPT 正常写完",           "openai",    { choices: [{ finish_reason: "stop" }] }],
  [false, "GPT 被内容过滤拦下",     "openai",    { choices: [{ finish_reason: "content_filter" }] }],
  [false, "GPT choices 是空数组",   "openai",    { choices: [] }],
  [false, "GPT 没给 choices",       "openai",    {}],
  [false, "GPT 响应是 null",        "openai",    null],
  // 两家的字段不能串用：拿 Anthropic 的字段去判 OpenAI 不该命中，反之亦然
  [false, "用 Claude 字段判 GPT",   "openai",    { stop_reason: "max_tokens" }],
  [false, "用 GPT 字段判 Claude",   "anthropic", { choices: [{ finish_reason: "length" }] }],
  // 实测那次的真实形状（tokens_out 正好顶到 max_tokens）
  [true,  "实测撞到的那次",         "anthropic", { stop_reason: "max_tokens", usage: { input_tokens: 6146, output_tokens: 6000 } }],
];

const fails = [];
for (const [want, why, host, body] of CASES) {
  let got;
  try { got = truncated(host, body); } catch (e) { fails.push(`${why}：抛异常 ${e.message}`); continue; }
  if (!!got !== want) fails.push(`${want ? "该判截断却没判" : "不该判截断却判了"}：${why}`);
}
console.log(JSON.stringify({ pass: !fails.length, fails, checked: CASES.length }));
process.exit(fails.length ? 1 : 0);
