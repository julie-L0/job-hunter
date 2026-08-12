import { config } from "../config.js";
import { larkRequest } from "../storage/lark-client.js";
import { listFields } from "../storage/bitable.js";
import { EXPERIENCE_TYPES, tableIdOf } from "../storage/schema.js";
import { buildExperienceMigrationPatch, larkText } from "../services/experience-migration.js";

const confirmed = process.argv.includes("--yes");
const tableId = tableIdOf("experience");
const basePath = `/bitable/v1/apps/${config.lark.baseToken}/tables/${tableId}`;
const requiredFields = [
  { name: "经历类型", type: 3, property: { options: EXPERIENCE_TYPES.map((name) => ({ name })) } },
  { name: "经历摘要", type: 1 },
  { name: "经历正文", type: 1 },
  { name: "相关链接", type: 1 },
  { name: "追问记录", type: 1 },
];

if (config.lark.mock) {
  console.error("迁移脚本不能在 LARK_MOCK=1 下执行");
  process.exit(1);
}

async function rawRecords() {
  const records = [];
  let pageToken;
  do {
    const { data } = await larkRequest("POST", `${basePath}/records/search`, {
      query: { page_size: 200, page_token: pageToken },
      body: {},
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return records;
}

async function createMissingFields(missing) {
  for (const field of missing) {
    await larkRequest("POST", `${basePath}/fields`, {
      body: { field_name: field.name, type: field.type, property: field.property },
    });
  }
}

async function updateExperienceTypeOptions(field, missingOptions) {
  if (!missingOptions.length) return;
  const options = [...(field.options || []), ...missingOptions];
  await larkRequest("PUT", `${basePath}/fields/${field.id}`, {
    body: {
      field_name: "经历类型",
      type: 3,
      property: { options: options.map((name) => ({ name })) },
    },
  });
}

async function writePatches(updates) {
  for (let index = 0; index < updates.length; index += 200) {
    await larkRequest("POST", `${basePath}/records/batch_update`, {
      body: { records: updates.slice(index, index + 200) },
    });
  }
}

const [fields, records] = await Promise.all([listFields("experience"), rawRecords()]);
const byName = new Map(fields.map((field) => [field.name, field]));
const missingFields = requiredFields.filter((field) => !byName.has(field.name));
const wrongTypes = requiredFields.filter((field) => byName.has(field.name) && byName.get(field.name).type !== field.type);
if (wrongTypes.length) {
  console.error(`字段类型错误，必须先处理：${wrongTypes.map((field) => field.name).join("、")}`);
  process.exit(1);
}
const typeField = byName.get("经历类型");
const missingTypeOptions = typeField ? EXPERIENCE_TYPES.filter((type) => !(typeField.options || []).includes(type)) : [];

const updates = records
  .map((record) => ({
    record_id: record.record_id,
    title: larkText(record.fields?.["经历标题"]) || record.record_id,
    fields: buildExperienceMigrationPatch(record.fields || {}),
  }))
  .filter((record) => Object.keys(record.fields).length);

console.log(`经历记录：${records.length} 条`);
console.log(`缺少字段：${missingFields.map((field) => field.name).join("、") || "无"}`);
console.log(`经历类型缺少选项：${missingTypeOptions.join("、") || "无"}`);
console.log(`待迁移记录：${updates.length} 条`);
for (const update of updates.slice(0, 5)) {
  console.log(`- ${update.title}：${Object.keys(update.fields).join("、")}`);
}
if (updates.length > 5) console.log(`- 其余 ${updates.length - 5} 条省略`);

if (!confirmed) {
  console.log("\n当前为 dry-run，没有写入飞书。确认后执行：npm run migrate-experiences -- --yes");
  process.exit(0);
}

await createMissingFields(missingFields);
await updateExperienceTypeOptions(typeField, missingTypeOptions);
await writePatches(updates.map(({ record_id, fields: patch }) => ({ record_id, fields: patch })));

const verifyRecords = await rawRecords();
const remaining = verifyRecords.filter((record) =>
  Object.keys(buildExperienceMigrationPatch(record.fields || {})).length > 0,
);
if (remaining.length) {
  console.error(`迁移后仍有 ${remaining.length} 条记录未完成，请勿切换应用字段`);
  process.exit(1);
}
console.log(`迁移完成并复核：${verifyRecords.length} 条记录，未完成 0 条`);
