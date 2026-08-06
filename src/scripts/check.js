import { config } from "../config.js";
import { chatCompletion, isMock } from "../llm/provider.js";
import { listFields, listRecords } from "../storage/bitable.js";
import { SCHEMAS } from "../storage/schema.js";

// 飞书字段类型枚举 → schema.js 里用的名字
const TYPE_NAMES = { 1: "text", 2: "number", 3: "select", 4: "multiselect", 5: "datetime", 17: "attachment" };

function line(ok, text) {
  console.log(`${ok ? "✓" : "✗"} ${text}`);
  return ok;
}

async function checkTable(tableKey) {
  const expected = SCHEMAS[tableKey].fields;
  const actual = await listFields(tableKey);
  const byName = new Map(actual.map((field) => [field.name, field]));

  let ok = true;
  for (const [key, field] of Object.entries(expected)) {
    const real = byName.get(field.name);
    if (!real) ok = line(false, `${tableKey}.${key} → 飞书里找不到字段「${field.name}」`) && ok;
    else if (TYPE_NAMES[real.type] !== field.type) {
      ok = line(false, `${tableKey}.${key} 类型不符：schema=${field.type} 飞书=${TYPE_NAMES[real.type] || real.type}`) && ok;
    }
  }
  const extra = actual.filter((field) => !Object.values(expected).some((f) => f.name === field.name));
  if (extra.length) console.log(`  （表里另有未纳管字段：${extra.map((f) => f.name).join("、")}）`);

  const records = await listRecords(tableKey);
  line(true, `${tableKey}：${actual.length} 字段，${records.length} 条记录`);
  return ok;
}

console.log("— 环境 —");
let allOk = true;
const mark = (ok) => {
  allOk = ok && allOk;
};

if (config.lark.mock) {
  console.log("⚠ LARK_MOCK=1，下面查的是内存假数据，不代表飞书真实结构。去掉它再跑一遍才算验过。");
}

mark(line(Boolean(config.lark.appId && config.lark.appSecret), "LARK_APP_ID / LARK_APP_SECRET"));
mark(line(Boolean(config.lark.userOpenId), "LARK_USER_OPEN_ID（准备文档授权用）"));
mark(line(Boolean(config.auth.password), "APP_PASSWORD（公网部署必须设）"));

if (isMock()) {
  mark(line(false, "LLM：MOCK 模式，未配置可用 key"));
} else {
  const ping = await chatCompletion({ messages: [{ role: "user", content: "hi" }] })
    .then(() => null)
    .catch((error) => error.message);
  mark(line(!ping, `LLM ${config.llm.model}${ping ? `：${ping.slice(0, 200)}` : " 连通"}`));
}

console.log("\n— 飞书表结构 —");
for (const tableKey of Object.keys(SCHEMAS)) {
  mark(await checkTable(tableKey).catch((error) => line(false, `${tableKey}：${error.message}`)));
}

console.log(allOk ? "\n全部通过" : "\n有问题，见上方 ✗");
process.exit(allOk ? 0 : 1);
