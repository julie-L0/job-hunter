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
const resumes = [
  { code: "R1", versionName: "AI 产品", direction: "产品", content: "复旦大学 中国语言文学系 硕士在读；专业技能：AI 产品、RAG、Prompt Engineering" },
];

function context(overrides = {}) {
  return buildComparisonContext({
    recordIds: ["job-2", "job-1", "job-2"],
    criterion: "更适合练手",
    jobs,
    experiences,
    resumes,
    ...overrides,
  });
}

function rawResult() {
  return {
    summary: "岗位各有侧重",
    contrasts: [{ topic: "工作重心", observation: "一个偏平台，一个偏策略" }],
    jobs: jobs.map((job, index) => ({
      recordId: job.recordId,
      careerValueScore: 70 + index,
      practiceValueScore: 70 + index,
      fallbackValueScore: 60 + index,
      criterionScore: 70 + index,
      experienceScore: 60 + index,
      technicalRequirement: {
        level: "preferred",
        penalty: -4,
        evidence: "JD 提到理工科优先",
        assessment: "存在技术倾向",
      },
      careerValueSummary: "求职价值一般",
      practiceValueSummary: "适合练习产品表达",
      fallbackValueSummary: "推进概率中等",
      criterionSummary: "符合部分标准",
      experienceSummary: "有相关经历",
      recommendedUse: "练手优先",
      conflictNotes: [],
      bestFor: "验证产品能力",
      scoreBreakdown: [
        { dimension: "求职价值", score: 70 + index, reason: "长期方向部分符合" },
        { dimension: "练手价值", score: 70 + index, reason: "能训练产品表达" },
        { dimension: "兜底价值", score: 60 + index, reason: "推进概率中等" },
      ],
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
  assert.equal(result.promptResumes[0].code, "R1");
  assert.match(result.promptResumes[0].content, /中国语言文学系/);
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
  Object.assign(raw.jobs[0], {
    careerValueScore: 90,
    practiceValueScore: 90,
    fallbackValueScore: 90,
    criterionScore: 90,
    experienceScore: 90,
  });
  raw.jobs[0].technicalRequirement = {
    level: "none",
    penalty: 0,
    evidence: "JD 未要求专业背景",
    assessment: "不扣分",
  };
  Object.assign(raw.jobs[1], {
    careerValueScore: 80,
    practiceValueScore: 80,
    fallbackValueScore: 80,
    criterionScore: 80,
    experienceScore: 80,
  });

  const result = normalizeComparisonResult(raw, [jobs[1], jobs[0]]);

  assert.deepEqual(result.jobs.map((job) => job.recordId), ["job-1", "job-2"]);
  assert.deepEqual(result.jobs.map((job) => job.overallScore), [90, 76]);
});

test("comparison result keeps selection order when overall scores tie", () => {
  const raw = rawResult();
  Object.assign(raw.jobs[0], {
    careerValueScore: 80,
    practiceValueScore: 80,
    fallbackValueScore: 80,
    criterionScore: 80,
    experienceScore: 80,
  });
  raw.jobs[0].technicalRequirement.penalty = 0;
  Object.assign(raw.jobs[1], {
    careerValueScore: 80,
    practiceValueScore: 80,
    fallbackValueScore: 80,
    criterionScore: 88,
    experienceScore: 80,
  });
  raw.jobs[1].technicalRequirement.penalty = 0;

  const result = normalizeComparisonResult(raw, [jobs[1], jobs[0]]);

  assert.deepEqual(result.jobs.map((job) => job.recordId), ["job-2", "job-1"]);
  assert.deepEqual(result.jobs.map((job) => job.overallScore), [80, 80]);
});

test("comparison result preserves detailed analysis fields", () => {
  const raw = rawResult();
  raw.jobs[0].quickTake = "岗位偏策略，已有增长项目可以支撑，但行业知识要补。";
  raw.jobs[0].scoreRationale = [
    { dimension: "标准符合度", score: 82, reason: "JD 要求策略分析，符合练手标准。" },
  ];
  raw.jobs[0].matchedExperiences = [
    {
      experienceTitle: "增长项目",
      jdRequirement: "数据分析能力",
      proof: "用数据定位增长问题并推动方案落地。",
      strength: "strong",
    },
  ];
  raw.jobs[0].jdChecklist = [
    {
      requirement: "负责策略分析",
      jdEvidence: "JD 写明负责策略分析",
      status: "fit",
      matchedExperienceTitle: "增长项目",
      proof: "用数据定位问题并推动方案落地。",
      gap: "",
      action: "准备增长项目的分析框架。",
    },
  ];
  raw.jobs[0].risks = ["缺少行业深度证据"];
  raw.jobs[0].prepFocus = ["准备增长项目如何对应策略分析要求"];

  const result = normalizeComparisonResult(raw, jobs);
  const job = result.jobs.find((item) => item.recordId === "job-1");

  assert.equal(job.quickTake, "岗位偏策略，已有增长项目可以支撑，但行业知识要补。");
  assert.equal(job.scoreRationale[0].reason, "JD 要求策略分析，符合练手标准。");
  assert.equal(job.matchedExperiences[0].strength, "strong");
  assert.equal(job.jdChecklist[0].status, "fit");
  assert.equal(job.jdChecklist[0].requirement, "负责策略分析");
  assert.deepEqual(job.risks, ["缺少行业深度证据"]);
  assert.deepEqual(job.prepFocus, ["准备增长项目如何对应策略分析要求"]);
});

test("comparison result allows positive background adjustment", () => {
  const raw = rawResult();
  Object.assign(raw.jobs[0], {
    careerValueScore: 98,
    practiceValueScore: 96,
    fallbackValueScore: 94,
    criterionScore: 98,
    experienceScore: 96,
  });
  raw.jobs[0].technicalRequirement = {
    level: "preferred",
    backgroundFit: "match",
    penalty: 6,
    evidence: "JD 写明中文、新闻传播等专业优先",
    assessment: "简历显示中国语言文学背景，落在要求范围内，应形成加分。",
  };

  const result = normalizeComparisonResult(raw, jobs);
  const job = result.jobs.find((item) => item.recordId === "job-1");

  assert.equal(job.technicalRequirement.backgroundFit, "match");
  assert.equal(job.technicalRequirement.penalty, 6);
  assert.equal(job.overallScore, 100);
});

test("comparison result tolerates malformed score rationale scores", () => {
  const raw = rawResult();
  Object.assign(raw.jobs[0], {
    careerValueScore: "82",
    practiceValueScore: 74.6,
    fallbackValueScore: 68,
    criterionScore: "82",
    experienceScore: 74.6,
  });
  raw.jobs[0].scoreRationale = [
    { dimension: "标准符合度", score: "82分", reason: "字符串分数应被解析。" },
    { dimension: "经历匹配度", score: 74.6, reason: "小数分数应被四舍五入。" },
    { dimension: "专业/技术倾向", score: -4, reason: "模型有时会把扣分写成负数。" },
  ];

  const result = normalizeComparisonResult(raw, jobs);
  const job = result.jobs.find((item) => item.recordId === "job-1");

  assert.equal(job.criterionScore, 82);
  assert.equal(job.experienceScore, 75);
  assert.deepEqual(job.scoreRationale.map((item) => item.score), [82, 75, 60]);
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
  invalidScore.jobs[0].careerValueScore = 101;
  assert.throws(() => normalizeComparisonResult(invalidScore, jobs), /0–100/);

  const invalidPenalty = rawResult();
  invalidPenalty.jobs[0].technicalRequirement.penalty = -11;
  assert.throws(() => normalizeComparisonResult(invalidPenalty, jobs), /-10–10/);

  const invalidLevel = rawResult();
  invalidLevel.jobs[0].technicalRequirement.level = "optional";
  assert.throws(() => normalizeComparisonResult(invalidLevel, jobs), /level 非法/);
});
