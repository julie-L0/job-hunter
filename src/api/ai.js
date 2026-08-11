import { HttpError, requireBody } from "../http/app.js";
import { listRecords } from "../storage/bitable.js";
import { chatCompletion, chatJson } from "../llm/provider.js";
import { loadPrompt } from "../llm/prompts.js";
import { buildJobContext } from "../services/context.js";
import { listJobs } from "../services/companies.js";
import {
  buildComparisonContext,
  mockComparisonResult,
  normalizeComparisonResult,
} from "../services/job-comparison.js";
import { appendDocText } from "../services/prep-doc.js";

const INTRO_VARIANTS = {
  "1min": { duration: "1分钟", language_line: "", field: "intro1min" },
  "3min": { duration: "3分钟", language_line: "", field: "intro3min" },
  "5min": { duration: "5分钟", language_line: "", field: "intro5min" },
  en: { duration: "2-3分钟", language_line: "语言：英文", field: "introEn" },
};

function asHistory(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, "history 必须是非空数组");
  return raw.map(({ role, content }) => ({ role, content: String(content ?? "") }));
}

function transcript(history) {
  const label = { system: "系统", assistant: "面试官", user: "候选人" };
  return history
    .filter((m) => m.role !== "system")
    .map((m) => `**${label[m.role] || m.role}**：${m.content}`)
    .join("\n\n");
}

function experienceLibrary(experiences) {
  return experiences
    .filter((experience) => experience.title && (experience.summary || experience.content))
    .map((experience) => [
      `## ${experience.title}`,
      `能力标签：${(experience.tags || []).join("、") || "未标注"}`,
      `经历摘要：${experience.summary || "未填写"}`,
      `经历正文：\n${experience.content || "未填写"}`,
    ].join("\n"))
    .join("\n\n");
}

export const aiRoutes = [
  {
    method: "POST",
    path: "/api/job-comparison",
    handler: async ({ body }) => {
      const [jobs, experiences] = await Promise.all([listJobs(), listRecords("experience")]);
      const context = buildComparisonContext({
        recordIds: body.recordIds,
        criterion: body.criterion,
        jobs,
        experiences,
      });
      const prompt = await loadPrompt("job-comparison", {
        criterion: context.criterion,
        jobs_json: JSON.stringify(context.promptJobs, null, 2),
        experiences_json: JSON.stringify(context.promptExperiences, null, 2),
      });
      const raw = await chatJson({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        mockShape: mockComparisonResult(context.selectedJobs, context.promptExperiences),
      });
      return {
        ...normalizeComparisonResult(raw, context.selectedJobs),
        mock: Boolean(raw.mock),
      };
    },
  },
  {
    // 第一步：把网页复制来的原始文本拆成题目，交给用户确认后再逐题生成
    method: "POST",
    path: "/api/fill-form/split",
    handler: async ({ body }) => {
      requireBody(body, ["rawText"]);
      const prompt = await loadPrompt("fill-form-split", { raw_text: body.rawText });
      return chatJson({
        messages: [{ role: "user", content: prompt }],
        mockShape: {
          questions: [
            { question: "请描述一次你推动跨部门协作的经历（MOCK 占位题）", limit: 300 },
            { question: "你为什么选择这个岗位？（MOCK 占位题）", limit: 200 },
            { question: "还有什么希望我们了解的？（MOCK 占位题）", limit: null },
          ],
        },
      });
    },
  },
  {
    method: "POST",
    path: "/api/fill-form/answer",
    handler: async ({ body }) => {
      requireBody(body, ["recordId", "question"]);
      const [{ vars }, experiences] = await Promise.all([
        buildJobContext(body.recordId, { resumeCode: body.resumeCode }),
        listRecords("experience"),
      ]);
      const prompt = await loadPrompt("fill-form", {
        limit: body.limit || "",
        jd: vars.jd,
        resume_content: vars.resume_content,
        experiences: experienceLibrary(experiences),
        question: body.question,
      });
      const history = [{ role: "user", content: prompt }];
      const message = await chatCompletion({ messages: history });
      return {
        answer: message.content,
        history: [...history, { role: "assistant", content: message.content }],
        mock: Boolean(message.mock),
      };
    },
  },
  {
    // 多轮改稿：前端把上一轮 history 原样带回来
    method: "POST",
    path: "/api/fill-form/revise",
    handler: async ({ body }) => {
      requireBody(body, ["instruction"]);
      const history = [...asHistory(body.history), { role: "user", content: body.instruction }];
      const message = await chatCompletion({ messages: history });
      return {
        answer: message.content,
        history: [...history, { role: "assistant", content: message.content }],
        mock: Boolean(message.mock),
      };
    },
  },
  {
    method: "POST",
    path: "/api/interview-prep",
    handler: async ({ body }) => {
      requireBody(body, ["recordId"]);
      const { job, vars } = await buildJobContext(body.recordId, { resumeCode: body.resumeCode });
      const prompt = await loadPrompt("interview-prep", {
        jd: vars.jd,
        resume_content: vars.resume_content,
      });
      const message = await chatCompletion({ messages: [{ role: "user", content: prompt }] });

      // 追加写飞书文档不需要确认，只追加不覆盖。
      // 写文档失败不能把已经生成好的材料丢掉——那是一次真实的 API 花费。
      let appended = null;
      if (body.appendToDoc && job.prepDocUrl) {
        const documentId = job.prepDocUrl.split("/").filter(Boolean).pop();
        appended = await appendDocText(documentId, `\n## 面试准备（${new Date().toISOString().slice(0, 10)}）\n${message.content}`)
          .then(() => ({ documentId }))
          .catch((error) => ({ documentId, error: error.message }));
      }
      return { material: message.content, appended, mock: Boolean(message.mock) };
    },
  },
  {
    method: "POST",
    path: "/api/intro/generate",
    handler: async ({ body }) => {
      requireBody(body, ["recordId", "variant"]);
      const variant = INTRO_VARIANTS[body.variant];
      if (!variant) throw new HttpError(400, `variant 必须是：${Object.keys(INTRO_VARIANTS).join("/")}`);
      const { vars } = await buildJobContext(body.recordId, { resumeCode: body.resumeCode });
      const prompt = await loadPrompt("intro-generate", { ...vars, ...variant });
      const message = await chatCompletion({ messages: [{ role: "user", content: prompt }] });
      // 落库要前端确认后走 PATCH /api/jobs/:recordId，字段名见 field
      return { draft: message.content, field: variant.field, mock: Boolean(message.mock) };
    },
  },
  {
    method: "POST",
    path: "/api/mock/start",
    handler: async ({ body }) => {
      requireBody(body, ["recordId"]);
      const { vars } = await buildJobContext(body.recordId, { resumeCode: body.resumeCode });
      const system = await loadPrompt("mock-system", vars);
      const history = [
        { role: "system", content: system },
        { role: "user", content: body.opening || "面试官你好，我准备好了。" },
      ];
      const message = await chatCompletion({ messages: history, temperature: 0.8 });
      return {
        history: [...history, { role: "assistant", content: message.content }],
        message: message.content,
        mock: Boolean(message.mock),
      };
    },
  },
  {
    method: "POST",
    path: "/api/mock/chat",
    handler: async ({ body }) => {
      requireBody(body, ["message"]);
      const history = [...asHistory(body.history), { role: "user", content: body.message }];
      const reply = await chatCompletion({ messages: history, temperature: 0.8 });
      return {
        history: [...history, { role: "assistant", content: reply.content }],
        message: reply.content,
        mock: Boolean(reply.mock),
      };
    },
  },
  {
    // 只产出摘要和追问建议，写回哪条经历由用户确认
    method: "POST",
    path: "/api/mock/end",
    handler: async ({ body }) => {
      const history = asHistory(body.history);
      const experiences = await listRecords("experience");
      const prompt = await loadPrompt("mock-summary", {
        experience_titles: experiences.map((exp) => exp.title).filter(Boolean).join("\n"),
        transcript: transcript(history),
      });
      const result = await chatJson({
        messages: [{ role: "user", content: prompt }],
        // 两条：一条标题对得上（下拉预选），一条故意对不上（必须让用户自己选）
        mockShape: {
          summary: "【MOCK 复盘】答得比较稳的是项目背景，追问深度上还可以再补细节。",
          followups: [
            {
              experience_title: experiences[0]?.title ?? "",
              question: "这个结果具体是怎样量化的？（MOCK）",
              answer_direction: "补充指标口径、基线和最终结果。（MOCK）",
            },
            {
              experience_title: "一条标题故意写歪的建议",
              question: "方案中最大的取舍是什么？（MOCK）",
              answer_direction: "说明备选方案、约束和最终选择依据。（MOCK）",
            },
          ],
        },
      });
      const byTitle = new Map(experiences.map((exp) => [exp.title, exp.recordId]));
      const followups = (result.followups || []).map((item) => ({
        ...item,
        recordId: byTitle.get(item.experience_title) || null,
      }));
      return { summary: result.summary || "", followups, mock: Boolean(result.mock) };
    },
  },
  {
    method: "POST",
    path: "/api/mock/export",
    handler: async ({ body }) => {
      const history = asHistory(body.history);
      return {
        markdown: `# Mock 面试记录 ${new Date().toISOString().slice(0, 16)}\n\n${transcript(history)}\n`,
      };
    },
  },
];
