import { HttpError, requireBody } from "../http/app.js";
import {
  batchCreateRecords,
  createRecord,
  deleteRecord,
  getRecord,
  listFields,
  listRecords,
  updateRecord,
} from "../storage/bitable.js";
import { chatCompletion } from "../llm/provider.js";
import { loadPrompt } from "../llm/prompts.js";

const EXPERIENCE_FIELDS = ["title", "summary", "content", "links", "followups"];

const cleanText = (value) => String(value ?? "").trim();

export async function listExperienceTags() {
  const fields = await listFields("experience");
  const target = fields.find((field) => field.name === "技能标签");
  if (!target) throw new HttpError(500, "飞书经历库缺少技能标签字段");
  return Array.isArray(target.options) ? target.options.map(cleanText).filter(Boolean) : [];
}

export function validateExperienceTags(tags, allowedTags) {
  if (tags === undefined) return undefined;
  const values = Array.isArray(tags) ? tags : [tags];
  const list = [...new Set(values.map(cleanText).filter(Boolean))];
  const allowed = new Set(allowedTags);
  const unknown = list.filter((tag) => !allowed.has(tag));
  if (unknown.length) {
    throw new HttpError(400, `技能标签已不在飞书可选项中：${unknown.join("、")}。请刷新后重新选择`);
  }
  return list;
}

function normalizeItem(item, allowedTags, index) {
  const title = cleanText(item?.title);
  if (!title) throw new HttpError(400, `第 ${index + 1} 条缺少 title`);
  return {
    title,
    summary: cleanText(item.summary),
    tags: validateExperienceTags(item.tags || [], allowedTags),
    content: cleanText(item.content),
    links: cleanText(item.links),
    followups: cleanText(item.followups),
  };
}

export function appendInterviewQuestion(followups, { question, answerDirection, source, date }) {
  const original = cleanText(followups);
  const stamp = cleanText(date) || new Date().toISOString().slice(0, 10);
  const label = [stamp, cleanText(source)].filter(Boolean).join(" · ");
  const block = [
    `### ${label}`,
    "",
    `Q：${cleanText(question)}`,
    "",
    `A：${cleanText(answerDirection)}`,
  ].join("\n");
  return [original, block].filter(Boolean).join("\n\n");
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
    handler: () => listExperienceTags(),
  },
  {
    method: "POST",
    path: "/api/experiences",
    handler: async ({ body }) => {
      const tags = await listExperienceTags();
      return createRecord("experience", normalizeItem(body, tags, 0));
    },
  },
  {
    method: "POST",
    path: "/api/experiences/import",
    handler: async ({ body }) => {
      const items = body.items;
      if (!Array.isArray(items) || !items.length) throw new HttpError(400, "items 必须是非空数组");
      const tags = await listExperienceTags();
      return batchCreateRecords(
        "experience",
        items.map((item, index) => normalizeItem(item, tags, index)),
      );
    },
  },
  {
    method: "POST",
    path: "/api/experiences/generate-summary",
    handler: async ({ body }) => {
      requireBody(body, ["recordId"]);
      const experience = await getRecord("experience", body.recordId);
      const content = cleanText(body.content ?? experience.content);
      if (!content) throw new HttpError(400, "该条经历没有正文");
      const prompt = await loadPrompt("experience-summary", { content });
      const message = await chatCompletion({
        messages: [{ role: "user", content: prompt }],
        mockText: `${content.slice(0, 120)}（MOCK 摘要草稿）`,
      });
      return { recordId: body.recordId, draft: message.content, mock: Boolean(message.mock) };
    },
  },
  {
    method: "PATCH",
    path: "/api/experiences/:recordId",
    handler: async ({ params, body }) => {
      const patch = {};
      for (const key of EXPERIENCE_FIELDS) {
        if (body[key] !== undefined) patch[key] = cleanText(body[key]);
      }
      if (body.tags !== undefined) {
        patch.tags = validateExperienceTags(body.tags, await listExperienceTags());
      }
      if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
      if ("title" in patch && !patch.title) throw new HttpError(400, "经历标题不能为空");
      return updateRecord("experience", params.recordId, patch);
    },
  },
  {
    method: "DELETE",
    path: "/api/experiences/:recordId",
    handler: ({ params }) => deleteRecord("experience", params.recordId),
  },
  {
    method: "POST",
    path: "/api/experiences/:recordId/interview-question",
    handler: async ({ params, body }) => {
      requireBody(body, ["question"]);
      const experience = await getRecord("experience", params.recordId);
      const followups = appendInterviewQuestion(experience.followups, {
        question: body.question,
        answerDirection: body.answerDirection,
        source: body.source,
      });
      return updateRecord("experience", params.recordId, { followups });
    },
  },
];
