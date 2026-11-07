// 「这个任务要不要 Dave 亲自审批」的判断检查。
//
// 直接从 supabase/functions/runtime/index.ts 里抠出 FINAL_RE / NEG_RE / needsApproval 来跑，
// 所以改了 runtime 就会在这里反映出来，不会出现测试和线上两套逻辑。
//
// 背景：旧版是纯子串匹配，任务描述里写「不能付款」也会命中「付款」，
// 把一个纯内部的文档任务挂起来等人工审批。漏拦比多拦危险，所以只有
// 命中词前面紧跟明确的否定说法时才放行。
//   node checks/approval.js
const fs = require("fs");
const path = require("path");

const RT = path.join(__dirname, "..", "supabase", "functions", "runtime", "index.ts");
const src = fs.readFileSync(RT, "utf8");
const block = src.match(/const FINAL_RE = [\s\S]*?\nfunction needsApproval[\s\S]*?\n\}/);
if (!block) { console.log(JSON.stringify({ pass: false, fails: ["runtime/index.ts 里找不到 needsApproval"] })); process.exit(1); }
const needsApproval = new Function(
  block[0].replace(/: string/g, "").replace(/: RegExpExecArray \| null/g, "") + "\nreturn needsApproval;"
)();

// [要不要人工审批, 任务文本]
const CASES = [
  // 必须拦下来：真的要动外面的世界
  [true,  "把新版官网上线"],
  [true,  "做完直接发布到 Facebook 主页"],
  [true,  "这个月的广告投放方案，执行后付款给供应商"],
  [true,  "和供应商签约"],
  [true,  "部署到生产环境"],
  [true,  "采购三台服务器"],
  [true,  "写一封对外公告"],
  [true,  "整理报价单，发送给客户"],
  [true,  "先写文案。写完请上线"],
  [true,  "不能用旧素材。做完直接发布"],
  [true,  "预算不够不要紧，照样要付款给设计外包"],
  [true,  "不要拖，这周必须上线"],
  [true,  "上个月还没有付款，去付掉"],
  // 必须放行：只是在交代边界，并没有真要做这些事
  [false, "DK Global Group · AI Office 内部使用说明一页纸。写给老板 Dave 一个人看：这个 AI Office 现在能做什么、它做不到什么（不能上网、不能付款、不能操作外部系统）、花钱怎么控制。"],
  [false, "整理一份竞品分析。本任务不涉及上线和对外发送。"],
  [false, "写一份内部流程说明，无需付款，也不会对外发布。"],
  [false, "调研一下短视频工具。禁止采购，只要结论。"],
  [false, "写周报"],
  [false, "帮我把会议纪要整理成要点"],
];

const fails = [];
for (const [want, txt] of CASES) {
  const got = needsApproval(txt);
  if (got !== want) fails.push(`${want ? "应拦未拦" : "应放行却拦了"}：${txt.slice(0, 40)}`);
}
console.log(JSON.stringify({ pass: !fails.length, fails, checked: CASES.length }));
process.exit(fails.length ? 1 : 0);
