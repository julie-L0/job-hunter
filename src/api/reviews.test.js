import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { fromRecord, toFields } from "../storage/schema.js";
import { listRecords } from "../storage/bitable.js";
import { reviewRoutes } from "./reviews.js";

function route(method, path) {
  return reviewRoutes.find((candidate) => candidate.method === method && candidate.path === path);
}

/** mock 数据源里挑一个真岗位：POST /api/reviews 会走 buildJobContext，岗位必须真的存在且有 JD。 */
async function firstMockJobId() {
  const jobs = await listRecords("main");
  const job = jobs.find((item) => item.jd);
  assert.ok(job, "mock 数据里应该有带 JD 的岗位");
  return job.recordId;
}

async function withMock(run) {
  const originalLark = config.lark.mock;
  const originalLlm = config.llm.mock;
  config.lark.mock = true;
  config.llm.mock = true;
  try {
    await run();
  } finally {
    config.lark.mock = originalLark;
    config.llm.mock = originalLlm;
  }
}

const SEGMENTS = [
  { start: 0, end: 8, text: "先自我介绍一下", role: "面试官" },
  { start: 9, end: 40, text: "我在字节做内容运营，负责活动策划和效果复盘", role: "我" },
];

test("review fields map to the Feishu review table", () => {
  assert.deepEqual(toFields("review", {
    title: "字节跳动-产品运营 一面 2026-09-02",
    jobRecordId: "job-1",
    company: "字节跳动",
    position: "产品运营",
    round: "一面",
    interviewedAt: 1787061600000,
    source: "本地转写",
    docUrl: "https://feishu.cn/docx/doc-1",
    audioName: "一面.m4a",
    durationSec: 3120,
    transcriptChars: 8600,
    takeaway: "指标口径没说清",
    commentStatus: "已点评",
    updatedAt: 1787065200000,
  }), {
    "复盘标题": "字节跳动-产品运营 一面 2026-09-02",
    "岗位记录ID": "job-1",
    "公司名": "字节跳动",
    "岗位名": "产品运营",
    "面试轮次": "一面",
    "面试时间": 1787061600000,
    "内容来源": "本地转写",
    "复盘文档链接": "https://feishu.cn/docx/doc-1",
    "录音文件名": "一面.m4a",
    "录音时长秒": 3120,
    "转写字数": 8600,
    "一句话结论": "指标口径没说清",
    "点评状态": "已点评",
    "更新时间": 1787065200000,
  });

  const record = fromRecord("review", {
    record_id: "review-1",
    fields: { "复盘标题": "标题", "岗位记录ID": "job-1", "面试轮次": "二面", "转写字数": 1200 },
  });
  assert.equal(record.recordId, "review-1");
  assert.equal(record.jobRecordId, "job-1");
  assert.equal(record.round, "二面");
  assert.equal(record.transcriptChars, 1200);
});

test("GET /api/reviews filters by job and sorts newest first", async () => {
  await withMock(async () => {
    const all = await route("GET", "/api/reviews").handler({ query: {} });
    assert.ok(all.length >= 2, "mock 数据里应该有种子复盘");

    const jobRecordId = all[0].jobRecordId;
    const mine = await route("GET", "/api/reviews").handler({ query: { jobRecordId } });
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((review) => review.jobRecordId === jobRecordId));

    const times = all.map((review) => review.interviewedAt || 0);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });
});

test("GET /api/reviews/transcribe/:jobId reports 400 when transcription is off", async () => {
  const original = { ...config.asr };
  try {
    Object.assign(config.asr, { pythonPath: "", scriptPath: "", modelDir: "" });
    await assert.rejects(
      async () => route("GET", "/api/reviews/transcribe/:jobId").handler({ params: { jobId: "x" } }),
      /本地转写未启用/,
    );
  } finally {
    Object.assign(config.asr, original);
  }
});

test("POST /api/reviews/comment requires a job and some transcript", async () => {
  await withMock(async () => {
    const jobRecordId = await firstMockJobId();
    await assert.rejects(
      () => route("POST", "/api/reviews/comment").handler({ body: { segments: SEGMENTS } }),
      /缺少参数：jobRecordId/,
    );
    await assert.rejects(
      () => route("POST", "/api/reviews/comment").handler({ body: { jobRecordId, segments: [] } }),
      /没有可用的转写内容/,
    );
  });
});

test("POST /api/reviews/comment returns the structured mock shape", async () => {
  await withMock(async () => {
    const result = await route("POST", "/api/reviews/comment").handler({
      body: {
        jobRecordId: await firstMockJobId(),
        round: "一面",
        segments: SEGMENTS,
        myNote: "被追问指标时慌了",
      },
    });
    assert.equal(result.mock, true);
    // 没有 mockShape 的话前端永远走不到解析分支，这条断言就是在守那个约定
    assert.ok(Array.isArray(result.comment.highlights));
    assert.ok(Array.isArray(result.comment.problems));
    assert.ok(result.comment.takeaway);
  });
});

test("POST /api/reviews rejects an invalid round or source before touching Lark", async () => {
  await withMock(async () => {
    const jobRecordId = await firstMockJobId();
    await assert.rejects(
      () => route("POST", "/api/reviews").handler({
        body: { jobRecordId, round: "四面", source: "粘贴文本", segments: SEGMENTS },
      }),
      /面试轮次非法/,
    );
    await assert.rejects(
      () => route("POST", "/api/reviews").handler({
        body: { jobRecordId, round: "一面", source: "自己编的", segments: SEGMENTS },
      }),
      /内容来源非法/,
    );
    await assert.rejects(
      () => route("POST", "/api/reviews").handler({
        body: { round: "一面", source: "粘贴文本", segments: SEGMENTS },
      }),
      /缺少参数：jobRecordId/,
    );
  });
});

test("POST /api/reviews rejects an unparseable interview time", async () => {
  await withMock(async () => {
    const jobRecordId = await firstMockJobId();
    await assert.rejects(
      () => route("POST", "/api/reviews").handler({
        body: {
          jobRecordId,
          round: "一面",
          source: "粘贴文本",
          segments: SEGMENTS,
          interviewedAt: "上周三下午",
        },
      }),
      /面试时间 不是有效时间/,
    );
  });
});

test("POST /api/reviews creates a doc, records metadata, and then appends to it", async () => {
  await withMock(async () => {
    const jobRecordId = await firstMockJobId();
    const created = await route("POST", "/api/reviews").handler({
      body: {
        jobRecordId,
        round: "二面",
        source: "粘贴文本",
        segments: SEGMENTS,
        interviewedAt: "2026-09-02T09:00:00",
        myNote: "指标定义没说清",
        comment: { takeaway: "先说定义再说结果", highlights: [], problems: [] },
        audioName: "",
        durationSec: 0,
      },
    });

    assert.equal(created.writeBackError, null);
    assert.equal(created.truncated, false);
    assert.match(created.docUrl, /docMOCK/);
    assert.equal(created.review.jobRecordId, jobRecordId);
    assert.equal(created.review.round, "二面");
    assert.equal(created.review.commentStatus, "已点评");
    assert.equal(created.review.takeaway, "先说定义再说结果");
    // 正文不进表，表里只记字数
    assert.equal(
      created.review.transcriptChars,
      SEGMENTS.reduce((sum, segment) => sum + segment.text.length, 0),
    );

    const appended = await route("POST", "/api/reviews/:recordId/append").handler({
      params: { recordId: created.review.recordId },
      body: { myNote: "事后又想到一个更好的答案" },
    });
    assert.equal(appended.recordId, created.review.recordId);
    assert.ok(appended.updatedAt > 0);

    await assert.rejects(
      () => route("POST", "/api/reviews/:recordId/append").handler({
        params: { recordId: created.review.recordId },
        body: {},
      }),
      /没有要追加的内容/,
    );
  });
});

test("POST /api/reviews without a comment stays 未点评", async () => {
  await withMock(async () => {
    const created = await route("POST", "/api/reviews").handler({
      body: {
        jobRecordId: await firstMockJobId(),
        round: "笔试",
        source: "粘贴文本",
        segments: SEGMENTS,
      },
    });
    assert.equal(created.review.commentStatus, "未点评");
    assert.equal(created.review.takeaway, "");
  });
});
