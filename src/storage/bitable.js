import { config } from "../config.js";
import { larkRequest } from "./lark-client.js";
import * as mock from "./mock-store.js";
import { fromRecord, tableIdOf, toFields } from "./schema.js";

const PAGE_SIZE = 200;
const BATCH_LIMIT = 200;

function recordsPath(tableKey, suffix = "") {
  return `/bitable/v1/apps/${config.lark.baseToken}/tables/${tableIdOf(tableKey)}/records${suffix}`;
}

function ensureCreatedAt(record, createdAt = Date.now()) {
  return record.createdAt ? record : { ...record, createdAt };
}

export async function listRecords(tableKey, { viewId } = {}) {
  if (config.lark.mock) return mock.listRecords(tableKey);
  const items = [];
  let pageToken;
  do {
    // 用 search 而不是 GET 列表：只有 search 支持 automatic_fields，
    // 才能读到记录自带的创建时间（看板的「躺了多久没投」靠它，不用加字段）
    const { data } = await larkRequest("POST", recordsPath(tableKey, "/search"), {
      query: { page_size: PAGE_SIZE, page_token: pageToken },
      body: { view_id: viewId, automatic_fields: true },
    });
    for (const record of data.items || []) items.push(fromRecord(tableKey, record));
    pageToken = data.has_more ? data.page_token : undefined;
  } while (pageToken);
  return items;
}

export async function getRecord(tableKey, recordId) {
  if (config.lark.mock) return mock.getRecord(tableKey, recordId);
  const { data } = await larkRequest("GET", recordsPath(tableKey, `/${recordId}`));
  return fromRecord(tableKey, data.record);
}

export async function createRecord(tableKey, patch) {
  if (config.lark.mock) return ensureCreatedAt(mock.createRecord(tableKey, patch));
  const { data } = await larkRequest("POST", recordsPath(tableKey), {
    body: { fields: toFields(tableKey, patch) },
  });
  return ensureCreatedAt(fromRecord(tableKey, data.record));
}

export async function updateRecord(tableKey, recordId, patch) {
  if (config.lark.mock) return mock.updateRecord(tableKey, recordId, patch);
  const { data } = await larkRequest("PUT", recordsPath(tableKey, `/${recordId}`), {
    body: { fields: toFields(tableKey, patch) },
  });
  return fromRecord(tableKey, data.record);
}

export async function deleteRecord(tableKey, recordId) {
  if (config.lark.mock) return mock.deleteRecord(tableKey, recordId);
  await larkRequest("DELETE", recordsPath(tableKey, `/${recordId}`));
  return { recordId, deleted: true };
}

export async function batchCreateRecords(tableKey, patches) {
  const createdAt = Date.now();
  if (config.lark.mock) {
    return mock.batchCreateRecords(tableKey, patches).map((record) => ensureCreatedAt(record, createdAt));
  }
  const created = [];
  for (let i = 0; i < patches.length; i += BATCH_LIMIT) {
    const chunk = patches.slice(i, i + BATCH_LIMIT);
    const { data } = await larkRequest("POST", recordsPath(tableKey, "/batch_create"), {
      body: { records: chunk.map((patch) => ({ fields: toFields(tableKey, patch) })) },
    });
    for (const record of data.records || []) {
      created.push(ensureCreatedAt(fromRecord(tableKey, record), createdAt));
    }
  }
  return created;
}

/** 每条记录写不同值的批量更新，一批最多 200 条。 */
export async function batchUpdateRecords(tableKey, updates) {
  if (config.lark.mock) return mock.batchUpdateRecords(tableKey, updates);
  const updated = [];
  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const chunk = updates.slice(i, i + BATCH_LIMIT);
    const { data } = await larkRequest("POST", recordsPath(tableKey, "/batch_update"), {
      body: {
        records: chunk.map(({ recordId, patch }) => ({
          record_id: recordId,
          fields: toFields(tableKey, patch),
        })),
      },
    });
    for (const record of data.records || []) updated.push(fromRecord(tableKey, record));
  }
  return updated;
}

/** 排查用：返回飞书里的真实字段类型和选项，比对 schema.js 是否漂移。 */
export async function listFields(tableKey) {
  if (config.lark.mock) return mock.listFields(tableKey);
  const { data } = await larkRequest(
    "GET",
    `/bitable/v1/apps/${config.lark.baseToken}/tables/${tableIdOf(tableKey)}/fields`,
    { query: { page_size: 100 } },
  );
  return (data.items || []).map((field) => ({
    id: field.field_id,
    name: field.field_name,
    type: field.type,
    options: field.property?.options?.map((option) => option.name) || null,
  }));
}
