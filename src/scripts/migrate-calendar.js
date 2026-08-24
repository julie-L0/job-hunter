import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { larkRequest } from "../storage/lark-client.js";

const confirmed = process.argv.includes("--yes");
const writeEnv = process.argv.includes("--write-env");
const tableName = "日历";
const fieldSpecs = [
  { name: "标题", type: 1 },
  { name: "岗位记录ID", type: 1 },
  { name: "类型", type: 1 },
  { name: "开始时间", type: 5 },
  { name: "结束时间", type: 5 },
  { name: "绑定状态", type: 1 },
  { name: "备注", type: 1 },
  { name: "状态已写回时间", type: 5 },
  { name: "客户端ID", type: 1 },
  { name: "更新时间", type: 5 },
];

if (config.lark.mock) {
  console.error("迁移脚本不能在 LARK_MOCK=1 下执行");
  process.exit(1);
}

function tablePath(tableId, suffix = "") {
  return `/bitable/v1/apps/${config.lark.baseToken}/tables/${tableId}${suffix}`;
}

async function listTables() {
  const { data } = await larkRequest("GET", `/bitable/v1/apps/${config.lark.baseToken}/tables`, {
    query: { page_size: 100 },
  });
  return data.items || [];
}

async function createCalendarTable() {
  const { data } = await larkRequest("POST", `/bitable/v1/apps/${config.lark.baseToken}/tables`, {
    body: {
      table: {
        name: tableName,
        default_view_name: "默认视图",
        fields: fieldSpecs.map((field) => ({ field_name: field.name, type: field.type })),
      },
    },
  });
  return data.table?.table_id || data.table_id;
}

async function rawFields(tableId) {
  const { data } = await larkRequest("GET", tablePath(tableId, "/fields"), { query: { page_size: 100 } });
  return (data.items || []).map((field) => ({
    id: field.field_id,
    name: field.field_name,
    type: field.type,
  }));
}

async function createMissingFields(tableId, missing) {
  for (const field of missing) {
    await larkRequest("POST", tablePath(tableId, "/fields"), {
      body: { field_name: field.name, type: field.type },
    });
  }
}

function updateEnv(tableId) {
  const file = ".env";
  const line = `BITABLE_TABLE_CALENDAR=${tableId}`;
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const next = text.match(/^BITABLE_TABLE_CALENDAR=/m)
    ? text.replace(/^BITABLE_TABLE_CALENDAR=.*$/m, line)
    : `${text.replace(/\s*$/, "\n")}${line}\n`;
  writeFileSync(file, next);
}

let tableId = config.lark.tables.calendar;
if (!tableId) {
  const existing = (await listTables()).find((table) => table.name === tableName);
  tableId = existing?.table_id;
}

console.log(`目标表：${tableName}`);
console.log(`当前 table_id：${tableId || "未配置/未找到"}`);

if (!tableId) {
  if (!confirmed) {
    console.log("\n当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-calendar -- --yes --write-env");
    process.exit(0);
  }
  tableId = await createCalendarTable();
  if (!tableId) throw new Error("飞书没有返回新建表 table_id");
  console.log(`已创建表：${tableId}`);
  if (writeEnv) updateEnv(tableId);
}

const fields = await rawFields(tableId);
const byName = new Map(fields.map((field) => [field.name, field]));
const missingFields = fieldSpecs.filter((field) => !byName.has(field.name));
const wrongTypes = fieldSpecs.filter((field) => byName.has(field.name) && byName.get(field.name).type !== field.type);
if (wrongTypes.length) throw new Error(`字段类型错误，必须先处理：${wrongTypes.map((field) => field.name).join("、")}`);

console.log(`缺少字段：${missingFields.map((field) => field.name).join("、") || "无"}`);

if (!confirmed) {
  console.log("\n当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-calendar -- --yes --write-env");
  process.exit(0);
}

await createMissingFields(tableId, missingFields);
if (writeEnv) updateEnv(tableId);
console.log(`完成。BITABLE_TABLE_CALENDAR=${tableId}`);
