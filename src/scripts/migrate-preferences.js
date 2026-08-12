import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { larkRequest } from "../storage/lark-client.js";
import { COMPARISON_STAGES } from "../storage/schema.js";
import { DEFAULT_COMPARISON_CONFIG, defaultComparisonPreference } from "../services/preferences.js";

const confirmed = process.argv.includes("--yes");
const writeEnv = process.argv.includes("--write-env");
const tableName = "偏好设置";
const fieldSpecs = [
  { name: "配置名", type: 1 },
  { name: "阶段策略", type: 3, property: { options: COMPARISON_STAGES.map((name) => ({ name })) } },
  { name: "求职价值权重", type: 2 },
  { name: "练手价值权重", type: 2 },
  { name: "兜底价值权重", type: 2 },
  { name: "价值取向", type: 1 },
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

async function createPreferenceTable() {
  const { data } = await larkRequest("POST", `/bitable/v1/apps/${config.lark.baseToken}/tables`, {
    body: {
      table: {
        name: tableName,
        default_view_name: "默认视图",
        fields: fieldSpecs.map((field) => ({ field_name: field.name, type: field.type, property: field.property })),
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
    options: field.property?.options?.map((option) => option.name) || null,
  }));
}

async function createMissingFields(tableId, missing) {
  for (const field of missing) {
    await larkRequest("POST", tablePath(tableId, "/fields"), {
      body: { field_name: field.name, type: field.type, property: field.property },
    });
  }
}

async function ensureStageOptions(tableId, field, missingOptions) {
  if (!missingOptions.length) return;
  await larkRequest("PUT", tablePath(tableId, `/fields/${field.id}`), {
    body: {
      field_name: "阶段策略",
      type: 3,
      property: { options: [...(field.options || []), ...missingOptions].map((name) => ({ name })) },
    },
  });
}

async function rawRecords(tableId) {
  const records = [];
  let pageToken;
  do {
    const { data } = await larkRequest("POST", tablePath(tableId, "/records/search"), {
      query: { page_size: 200, page_token: pageToken },
      body: {},
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return records;
}

async function ensureDefaultPreference(tableId) {
  const records = await rawRecords(tableId);
  const exists = records.some((record) => String(record.fields?.["配置名"] || "").trim() === DEFAULT_COMPARISON_CONFIG);
  if (exists) return false;
  const preference = defaultComparisonPreference();
  await larkRequest("POST", tablePath(tableId, "/records"), {
    body: {
      fields: {
        "配置名": preference.configName,
        "阶段策略": preference.stage,
        "求职价值权重": preference.careerWeight,
        "练手价值权重": preference.practiceWeight,
        "兜底价值权重": preference.fallbackWeight,
        "价值取向": preference.valueOrientation,
        "更新时间": preference.updatedAt,
      },
    },
  });
  return true;
}

function updateEnv(tableId) {
  const file = ".env";
  const line = `BITABLE_TABLE_PREFERENCE=${tableId}`;
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const next = text.match(/^BITABLE_TABLE_PREFERENCE=/m)
    ? text.replace(/^BITABLE_TABLE_PREFERENCE=.*$/m, line)
    : `${text.replace(/\s*$/, "\n")}${line}\n`;
  writeFileSync(file, next);
}

let tableId = config.lark.tables.preference;
if (!tableId) {
  const existing = (await listTables()).find((table) => table.name === tableName);
  tableId = existing?.table_id;
}

console.log(`目标表：${tableName}`);
console.log(`当前 table_id：${tableId || "未配置/未找到"}`);

if (!tableId) {
  if (!confirmed) {
    console.log("\n当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-preferences -- --yes --write-env");
    process.exit(0);
  }
  tableId = await createPreferenceTable();
  if (!tableId) throw new Error("飞书没有返回新建表 table_id");
  console.log(`已创建表：${tableId}`);
  if (writeEnv) updateEnv(tableId);
}

const fields = await rawFields(tableId);
const byName = new Map(fields.map((field) => [field.name, field]));
const missingFields = fieldSpecs.filter((field) => !byName.has(field.name));
const wrongTypes = fieldSpecs.filter((field) => byName.has(field.name) && byName.get(field.name).type !== field.type);
if (wrongTypes.length) throw new Error(`字段类型错误，必须先处理：${wrongTypes.map((field) => field.name).join("、")}`);
const stageField = byName.get("阶段策略");
const missingStageOptions = stageField ? COMPARISON_STAGES.filter((stage) => !(stageField.options || []).includes(stage)) : [];

console.log(`缺少字段：${missingFields.map((field) => field.name).join("、") || "无"}`);
console.log(`阶段策略缺少选项：${missingStageOptions.join("、") || "无"}`);

if (!confirmed) {
  console.log("\n当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-preferences -- --yes --write-env");
  process.exit(0);
}

await createMissingFields(tableId, missingFields);
if (stageField) await ensureStageOptions(tableId, stageField, missingStageOptions);
const createdDefault = await ensureDefaultPreference(tableId);
if (writeEnv) updateEnv(tableId);
console.log(`默认偏好：${createdDefault ? "已创建" : "已存在"}`);
console.log(`完成。BITABLE_TABLE_PREFERENCE=${tableId}`);
