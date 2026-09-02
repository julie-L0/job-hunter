import { HttpError, requireBody } from "../http/app.js";
import { createRecord, getRecord, listRecords, updateRecord } from "../storage/bitable.js";
import { chatJson } from "../llm/provider.js";
import { loadPrompt } from "../llm/prompts.js";
import { buildJobContext } from "../services/context.js";
import { appendDocText, createLarkDoc } from "../services/lark-doc.js";
import { getTranscribeJob, isTranscribeEnabled } from "../services/transcribe.js";
import {
  buildAppendContent,
  buildReviewDocContent,
  buildReviewTitle,
  fillMissingRoles,
  guessRoles,
  normalizeSegments,
  segmentsToTranscript,
  validateReviewInput,
} from "../services/review.js";
import { REVIEW_COMMENT_STATUSES } from "../storage/schema.js";

const clean = (value) => String(value ?? "").trim();

function hydrateReview(record) {
  return {
    recordId: record.recordId,
    title: record.title || "",
    jobRecordId: record.jobRecordId || "",
    company: record.company || "",
    position: record.position || "",
    round: record.round || "",
    interviewedAt: record.interviewedAt || null,
    source: record.source || "",
    docUrl: record.docUrl || "",
    audioName: record.audioName || "",
    durationSec: record.durationSec || 0,
    transcriptChars: record.transcriptChars || 0,
    takeaway: record.takeaway || "",
    commentStatus: record.commentStatus || REVIEW_COMMENT_STATUSES[0],
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
  };
}

function asMillis(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(String(value));
  if (!Number.isNaN(parsed)) return parsed;
  throw new HttpError(400, `${fieldName} 不是有效时间`);
}

/** 分段既可能来自本地转写，也可能来自用户粘贴的文本（前端按行切好再送上来）。 */
function prepareSegments(raw) {
  const { segments, truncated } = normalizeSegments(raw);
  if (!segments.length) throw new HttpError(400, "没有可用的转写内容");
  // 只给没标角色的段补，用户在前端确认过的一律不覆盖
  return { segments: fillMissingRoles(segments), truncated };
}

async function generateComment({ recordId, resumeCode, round, segments, myNote }) {
  const { vars } = await buildJobContext(recordId, { resumeCode });
  const prompt = await loadPrompt("review-comment", {
    jd: vars.jd,
    resume_content: vars.resume_content,
    round: round || "未填",
    transcript: segmentsToTranscript(segments),
    my_note: clean(myNote) || "（无）",
  });
  return chatJson({
    messages: [{ role: "user", content: prompt }],
    // 没有 mockShape 的话 LLM_MOCK=1 下前端永远走不到解析分支（见 provider.js 的约定）
    mockShape: {
      highlights: ["项目背景讲得完整（MOCK）"],
      problems: [
        {
          point: "指标口径说不清（MOCK）",
          evidence: segments[0]?.text?.slice(0, 40) || "",
          fix: "先说指标定义再说结果（MOCK）",
        },
      ],
      answerRewrites: [{ question: "介绍一下你的项目（MOCK）", betterAnswer: "背景-动作-结果三段式（MOCK）" }],
      nextActions: ["把北极星指标的定义写成一句话（MOCK）"],
      takeaway: "指标口径要能一句话讲清（MOCK）",
    },
  });
}

export const reviewRoutes = [
  {
    // 按岗位按需加载，不进 loadAll——和 calendar-events 一致
    method: "GET",
    path: "/api/reviews",
    handler: async ({ query }) => {
      const jobRecordId = clean(query.jobRecordId);
      const records = (await listRecords("review")).map(hydrateReview);
      const filtered = jobRecordId
        ? records.filter((review) => review.jobRecordId === jobRecordId)
        : records;
      return filtered.sort((a, b) => (b.interviewedAt || 0) - (a.interviewedAt || 0));
    },
  },
  {
    method: "GET",
    path: "/api/reviews/transcribe/:jobId",
    handler: ({ params }) => {
      if (!isTranscribeEnabled()) throw new HttpError(400, "本地转写未启用");
      const job = getTranscribeJob(params.jobId);
      if (job.status !== "done") return job;
      const { segments, truncated } = normalizeSegments(job.segments);
      return { ...job, segments: guessRoles(segments), truncated };
    },
  },
  {
    // 只出点评草稿，不落库也不建文档。保存要走 POST /api/reviews（PRD 原则 4）
    method: "POST",
    path: "/api/reviews/comment",
    handler: async ({ body }) => {
      requireBody(body, ["jobRecordId"]);
      const { segments } = prepareSegments(body.segments);
      const result = await generateComment({
        recordId: clean(body.jobRecordId),
        resumeCode: body.resumeCode,
        round: clean(body.round),
        segments,
        myNote: body.myNote,
      });
      return { comment: result, mock: Boolean(result.mock) };
    },
  },
  {
    // 这一次点击就是 PRD 原则 4 要求的写回确认：建文档 → 写正文 → 建 review 记录
    method: "POST",
    path: "/api/reviews",
    handler: async ({ body }) => {
      const { jobRecordId, round, source } = validateReviewInput(body);
      const { job } = await buildJobContext(jobRecordId, { resumeCode: body.resumeCode });
      const { segments, truncated } = prepareSegments(body.segments);
      const interviewedAt = asMillis(body.interviewedAt, "面试时间") || Date.now();
      const comment = body.comment || null;

      const doc = await createLarkDoc({
        title: buildReviewTitle({ company: job.company, position: job.position, round, interviewedAt }),
        content: buildReviewDocContent({
          job,
          round,
          interviewedAt,
          segments,
          myNote: body.myNote,
          comment,
        }).join("\n"),
      });

      const patch = {
        title: buildReviewTitle({ company: job.company, position: job.position, round, interviewedAt }),
        jobRecordId,
        company: job.company || "",
        position: job.position || "",
        round,
        interviewedAt,
        source,
        docUrl: doc.url,
        audioName: clean(body.audioName),
        durationSec: Number(body.durationSec) || 0,
        transcriptChars: segments.reduce((sum, segment) => sum + segment.text.length, 0),
        takeaway: clean(body.takeaway) || clean(comment?.takeaway),
        commentStatus: comment ? "已点评" : "未点评",
        updatedAt: Date.now(),
      };

      // 文档已经建成了，写表失败不能把内容一起丢掉——沿用 prep-doc 的降级方式
      let review = null;
      let writeBackError = null;
      try {
        review = hydrateReview(await createRecord("review", patch));
      } catch (error) {
        writeBackError = error.message;
      }

      return { review, docUrl: doc.url, documentId: doc.documentId, truncated, writeBackError };
    },
  },
  {
    // 后续补充或重新点评：追加写文档（不覆盖），只更新表里的元数据
    method: "POST",
    path: "/api/reviews/:recordId/append",
    handler: async ({ params, body }) => {
      const review = hydrateReview(await getRecord("review", params.recordId));
      if (!review.docUrl) throw new HttpError(400, "这条复盘还没有文档，无法追加");

      const myNote = clean(body.myNote);
      const comment = body.comment || null;
      if (!myNote && !comment) throw new HttpError(400, "没有要追加的内容");

      // 文档 id 从 url 尾段取：建文档时就是用 docUrlBase + documentId 拼的
      const documentId = review.docUrl.split("/").filter(Boolean).pop();
      await appendDocText(documentId, buildAppendContent({ myNote, comment }).join("\n"));

      const patch = {
        updatedAt: Date.now(),
        ...(comment ? { commentStatus: "已点评" } : {}),
        ...(clean(body.takeaway) || clean(comment?.takeaway)
          ? { takeaway: clean(body.takeaway) || clean(comment?.takeaway) }
          : {}),
      };
      return hydrateReview(await updateRecord("review", params.recordId, patch));
    },
  },
];
