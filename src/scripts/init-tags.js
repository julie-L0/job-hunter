import { config } from "../config.js";
import { larkRequest } from "../storage/lark-client.js";
import { listFields } from "../storage/bitable.js";
import { EXPERIENCE_TAGS, tableIdOf } from "../storage/schema.js";

// 一次性初始化「技能标签」选项集。改字段结构属于红线，必须显式加 --yes。
const confirmed = process.argv.includes("--yes");

const fields = await listFields("experience");
const target = fields.find((field) => field.name === "技能标签");
if (!target) {
  console.error("经历库里没有「技能标签」字段");
  process.exit(1);
}

const existing = target.options || [];
const missing = EXPERIENCE_TAGS.filter((tag) => !existing.includes(tag));

console.log(`现有选项：${existing.join("、") || "（空）"}`);
console.log(`将新增：${missing.join("、") || "（无）"}`);

if (!missing.length) process.exit(0);
if (!confirmed) {
  console.log("\n这是飞书表结构变更。确认后重新执行：node src/scripts/init-tags.js --yes");
  process.exit(0);
}

await larkRequest(
  "PUT",
  `/bitable/v1/apps/${config.lark.baseToken}/tables/${tableIdOf("experience")}/fields/${target.id}`,
  {
    body: {
      field_name: "技能标签",
      type: 4,
      property: { options: [...existing, ...missing].map((name) => ({ name })) },
    },
  },
);
console.log("已写入");
