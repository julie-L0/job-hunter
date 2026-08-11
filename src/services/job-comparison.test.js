import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMPARISON_JOBS,
  buildComparisonContext,
  normalizeComparisonResult,
} from "./job-comparison.js";

const jobs = [
  { recordId: "job-1", company: "甲公司", position: "策略产品", status: "待投", jd: "负责策略分析" },
  { recordId: "job-2", company: "乙公司", position: "平台产品", status: "待投", jd: "负责平台建设" },
];
const experiences = [
  { title: "增长项目", tags: ["数据分析"], summary: "完成增长分析", content: "用数据定位问题并推动方案落地" },
];

function context(overrides = {}) {
  return buildComparisonContext({
    recordIds: ["job-2", "job-1", "job-2"],
    criterion: "更适合练手",
    jobs,
    experiences,
    ...overrides,
  });
}

function rawResult() {
  return {
    summary: "岗位各有侧重",
    contrasts: [{ topic: "工作重心", observation: "一个偏平台，一个偏策略" }],
    jobs: jobs.map((job, index) => ({
      recordId: job.recordId,
      criterionScore: 70 + index,
      experienceScore: 60 + index,
      technicalRequirement: {
        level: "preferred",
        penalty: -4,
        evidence: "JD 提到理工科优先",
        assessment: "存在技术倾向",
      },
      criterionSummary: "符合部分标准",
      experienceSummary: "有相关经历",
      bestFor: "验证产品能力",
      criterionEvidence: [{ requirement: "分析能力", evidence: "JD 要求分析", assessment: "符合" }],
      experienceEvidence: [{ requirement: "分析能力", experienceTitle: "增长项目", evidence: "做过分析" }],
      gaps: ["行业知识"],
      uncertainties: [],
    })),
  };
}

test("comparison context deduplicates IDs and preserves selection order", () => {
  const result = context();
  assert.deepEqual(result.selectedJobs.map((job) => job.recordId), ["job-2", "job-1"]);
  assert.equal(result.criterion, "更适合练手");
  assert.equal(result.promptExperiences[0].title, "增长项目");
});

test("comparison context validates selection, jobs, JD, and experiences", () => {
  assert.throws(() => context({ recordIds: ["job-1"] }), /2–20/);
  assert.throws(
    () => context({ recordIds: Array.from({ length: MAX_COMPARISON_JOBS + 1 }, (_, index) => `job-${index}`) }),
    /2–20/,
  );
  assert.throws(() => context({ recordIds: ["job-1", "missing"] }), /部分岗位不存在/);
  assert.throws(
    () => context({ jobs: [{ ...jobs[0], jd: "" }, jobs[1]] }),
    /缺少 JD：甲公司 · 策略产品/,
  );
  assert.throws(() => context({ experiences: [] }), /经历库没有可用于比较的经历/);
});

test("comparison result calculates overall scores and sorts descending", () => {
  const raw = rawResult();
  raw.jobs[0].criterionScore = 90;
  raw.jobs[0].experienceScore = 90;
  raw.jobs[0].technicalRequirement = {
    level: "none",
    penalty: 0,
    evidence: "JD 未要求专业背景",
    assessment: "不扣分",
  };
  raw.jobs[1].criterionScore = 80;
  raw.jobs[1].experienceScore = 80;

  const result = normalizeComparisonResult(raw, [jobs[1], jobs[0]]);

  assert.deepEqual(result.jobs.map((job) => job.recordId), ["job-1", "job-2"]);
  assert.deepEqual(result.jobs.map((job) => job.overallScore), [90, 76]);
});

test("comparison result keeps selection order when overall scores tie", () => {
  const raw = rawResult();
  raw.jobs[0].criterionScore = 80;
  raw.jobs[0].experienceScore = 80;
  raw.jobs[0].technicalRequirement.penalty = 0;
  raw.jobs[1].criterionScore = 88;
  raw.jobs[1].experienceScore = 80;

  const result = normalizeComparisonResult(raw, [jobs[1], jobs[0]]);

  assert.deepEqual(result.jobs.map((job) => job.recordId), ["job-2", "job-1"]);
  assert.deepEqual(result.jobs.map((job) => job.overallScore), [80, 80]);
});

test("comparison result rejects unknown, duplicate, missing, and invalid jobs", () => {
  const unknown = rawResult();
  unknown.jobs[0].recordId = "unknown";
  assert.throws(() => normalizeComparisonResult(unknown, jobs), /未选择/);

  const duplicate = rawResult();
  duplicate.jobs[1].recordId = "job-1";
  assert.throws(() => normalizeComparisonResult(duplicate, jobs), /重复岗位/);

  const missing = rawResult();
  missing.jobs.pop();
  assert.throws(() => normalizeComparisonResult(missing, jobs), /缺少部分岗位/);

  const invalidScore = rawResult();
  invalidScore.jobs[0].criterionScore = 101;
  assert.throws(() => normalizeComparisonResult(invalidScore, jobs), /0–100/);

  const invalidPenalty = rawResult();
  invalidPenalty.jobs[0].technicalRequirement.penalty = -11;
  assert.throws(() => normalizeComparisonResult(invalidPenalty, jobs), /-10–0/);

  const invalidLevel = rawResult();
  invalidLevel.jobs[0].technicalRequirement.level = "optional";
  assert.throws(() => normalizeComparisonResult(invalidLevel, jobs), /level 非法/);
});
