import { config } from "../config.js";
import { larkRequest } from "../storage/lark-client.js";
import { listFields } from "../storage/bitable.js";
import { JOB_STAR_VALUE, tableIdOf } from "../storage/schema.js";

const confirmed = process.argv.includes("--yes");
const tableId = tableIdOf("main");
const basePath = `/bitable/v1/apps/${config.lark.baseToken}/tables/${tableId}`;

if (config.lark.mock) {
  console.error("迁移脚本不能在 LARK_MOCK=1 下执行");
  process.exit(1);
}

async function createStarField() {
  await larkRequest("POST", `${basePath}/fields`, {
    body: {
      field_name: "星标",
      type: 3,
      property: { options: [{ name: JOB_STAR_VALUE }] },
    },
  });
}

async function createTextField(name) {
  await larkRequest("POST", `${basePath}/fields`, {
    body: {
      field_name: name,
      type: 1,
    },
  });
}

async function updateStarOptions(field, options) {
  await larkRequest("PUT", `${basePath}/fields/${field.id}`, {
    body: {
      field_name: "星标",
      type: 3,
      property: { options: options.map((name) => ({ name })) },
    },
  });
}

const fields = await listFields("main");
const target = fields.find((field) => field.name === "星标");
const statusHistory = fields.find((field) => field.name === "状态记录");
let wrote = false;

if (!target) {
  console.log("缺少字段：星标（select，选项：星标）");
  if (!confirmed) {
    console.log("当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-jobs -- --yes");
  } else {
    await createStarField();
    wrote = true;
    console.log("已创建字段：星标");
  }
}

if (target && target.type !== 3) {
  console.error(`字段「星标」类型错误：当前 type=${target.type}，需要 select(type=3)`);
  process.exit(1);
}

if (target) {
  const existing = target.options || [];
  const missing = existing.includes(JOB_STAR_VALUE) ? [] : [JOB_STAR_VALUE];
  console.log(`字段已存在：星标；现有选项：${existing.join("、") || "（空）"}`);
  console.log(`将新增选项：${missing.join("、") || "无"}`);

  if (missing.length) {
    if (!confirmed) console.log("当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-jobs -- --yes");
    else {
      await updateStarOptions(target, [...existing, ...missing]);
      wrote = true;
      console.log("已更新字段选项：星标");
    }
  }
}

if (!statusHistory) {
  console.log("缺少字段：状态记录（text）");
  if (!confirmed) console.log("当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-jobs -- --yes");
  else {
    await createTextField("状态记录");
    wrote = true;
    console.log("已创建字段：状态记录");
  }
} else if (statusHistory.type !== 1) {
  console.error(`字段「状态记录」类型错误：当前 type=${statusHistory.type}，需要 text(type=1)`);
  process.exit(1);
} else {
  console.log("字段已存在：状态记录");
}

if (!confirmed && (!target || !statusHistory)) process.exit(0);
if (!wrote) console.log("岗位表字段已就绪");
