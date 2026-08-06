import { HttpError, requireBody } from "../http/app.js";
import { batchCreateRecords, getRecord, listRecords, updateRecord } from "../storage/bitable.js";
import { EXPERIENCE_TAGS } from "../storage/schema.js";
import { chatCompletion } from "../llm/provider.js";
import { loadPrompt } from "../llm/prompts.js";

// 多选写入不存在的选项会 800030005，新增选项属于表结构变更（红线），这里直接拒绝
function checkTags(tags) {
  if (!tags) return undefined;
  const list = Array.isArray(tags) ? tags : [tags];
  const unknown = list.filter((tag) => !EXPERIENCE_TAGS.includes(tag));
  if (unknown.length) {
    throw new HttpError(400, `未定义的技能标签：${unknown.join("、")}。需先在飞书里加选项`);
  }
  return list;
}

// 相关链接是一段多行文本，每行「说明 | URL」。导入时允许传数组，统一拼成同一种形状，
// 免得同一个字段在库里出现两种格式
function normalizeLinks(links) {
  if (!links) return "";
  if (typeof links === "string") return links;
  const list = Array.isArray(links) ? links : [links];
  return list
    .map((item) =>
      typeof item === "string" ? item : [item.label, item.url].filter(Boolean).join(" | "),
    )
    .filter(Boolean)
    .join("\n");
}

export const experienceRoutes = [
  {
    method: "GET",
    path: "/api/experiences",
    handler: () => listRecords("experience"),
  },
  {
    method: "GET",
    path: "/api/experiences/tags",
    handler: () => EXPERIENCE_TAGS,
  },
  {
    method: "POST",
    path: "/api/experiences/import",
    handler: async ({ body }) => {
      const items = body.items;
      if (!Array.isArray(items) || !items.length) throw new HttpError(400, "items 必须是非空数组");
      const patches = items.map((item, i) => {
        if (!item.title) throw new HttpError(400, `第 ${i + 1} 条缺少 title`);
        return {
          title: item.title,
          star: item.star || "",
          short50: item.short50 || "",
          short100: item.short100 || "",
          links: normalizeLinks(item.links),
          tags: checkTags(item.tags),
        };
      });
      return batchCreateRecords("experience", patches);
    },
  },
  {
    // 只出草稿，用户确认后走 PATCH 落库
    method: "POST",
    path: "/api/experiences/generate-short",
    handler: async ({ body }) => {
      requireBody(body, ["recordId"]);
      const experience = await getRecord("experience", body.recordId);
      if (!experience.star) throw new HttpError(400, "该条经历没有 STAR 全文");
      const prompt = await loadPrompt("experience-short", { full_text: experience.star });
      const message = await chatCompletion({
        messages: [{ role: "user", content: prompt }],
        // 占位内容也要照 prompt 约定的两段格式出，否则前端那套确定性拆分永远走不到
        mockText: [
          `【50字版】${experience.star.slice(0, 50)}（MOCK 占位）`,
          `【100字版】${experience.star.slice(0, 100)}（MOCK 占位）`,
        ].join("\n"),
      });
      return { recordId: body.recordId, draft: message.content, mock: Boolean(message.mock) };
    },
  },
  {
    method: "PATCH",
    path: "/api/experiences/:recordId",
    handler: async ({ params, body }) => {
      const patch = {};
      for (const key of ["title", "star", "short50", "short100"]) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      if (body.links !== undefined) patch.links = normalizeLinks(body.links);
      if (body.tags !== undefined) patch.tags = checkTags(body.tags);
      if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
      return updateRecord("experience", params.recordId, patch);
    },
  },
  {
    // 追问记录只追加不覆盖，目标经历由用户在前端确认后传进来
    method: "POST",
    path: "/api/experiences/:recordId/followup",
    handler: async ({ params, body }) => {
      requireBody(body, ["note"]);
      const experience = await getRecord("experience", params.recordId);
      const stamp = new Date().toISOString().slice(0, 10);
      const entry = `【${stamp}${body.source ? ` ${body.source}` : ""}】${body.note}`;
      const next = [experience.followups, entry].filter(Boolean).join("\n");
      return updateRecord("experience", params.recordId, { followups: next });
    },
  },
];
