import { HttpError, requireBody } from "../http/app.js";
import { createRecord, listRecords, updateRecord } from "../storage/bitable.js";
import { chatCompletion } from "../llm/provider.js";
import { loadPrompt } from "../llm/prompts.js";
import { nextResumeCode, recomputeApplyRecords } from "../services/resume.js";

const WRITABLE = ["versionName", "direction", "content"];

export const resumeRoutes = [
  {
    method: "GET",
    path: "/api/resumes",
    handler: () => listRecords("resume"),
  },
  {
    // 只出草稿，不落库。保存要走 POST /api/resumes（PRD 原则 4）
    method: "POST",
    path: "/api/resumes/generate",
    handler: async ({ body }) => {
      requireBody(body, ["jd"]);
      const experiences = await listRecords("experience");
      const prompt = await loadPrompt("resume-generate", {
        jd: body.jd,
        experiences: experiences
          .map((exp) => `## ${exp.title}\n${exp.star || exp.short100 || ""}`)
          .join("\n\n"),
      });
      const message = await chatCompletion({ messages: [{ role: "user", content: prompt }] });
      return { draft: message.content, mock: Boolean(message.mock) };
    },
  },
  {
    method: "POST",
    path: "/api/resumes",
    handler: async ({ body }) => {
      requireBody(body, ["versionName", "content"]);
      const code = await nextResumeCode();
      const patch = { code, createdAt: Date.now() };
      for (const key of WRITABLE) if (body[key] !== undefined) patch[key] = body[key];
      return createRecord("resume", patch);
    },
  },
  {
    method: "PATCH",
    path: "/api/resumes/:recordId",
    handler: async ({ params, body }) => {
      const patch = {};
      for (const key of WRITABLE) if (body[key] !== undefined) patch[key] = body[key];
      if (!Object.keys(patch).length) throw new HttpError(400, `可改字段：${WRITABLE.join(", ")}`);
      return updateRecord("resume", params.recordId, patch);
    },
  },
  {
    // 兜底：手动触发投递记录全量重算
    method: "POST",
    path: "/api/resumes/recompute-apply-record",
    handler: () => recomputeApplyRecords(),
  },
];
