import { HttpError } from "../http/app.js";

export const MIN_COMPARISON_JOBS = 2;
export const MAX_COMPARISON_JOBS = 20;
export const MAX_COMPARISON_CRITERION = 500;
const MAX_EXPERIENCE_CONTENT = 2400;

const cleanText = (value) => String(value || "").trim();

function clip(value, limit) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function buildComparisonContext({ recordIds, criterion, jobs, experiences }) {
  if (!Array.isArray(recordIds)) throw new HttpError(400, "请选择要比较的岗位");
  const ids = [...new Set(recordIds.map(cleanText).filter(Boolean))];
  if (ids.length < MIN_COMPARISON_JOBS || ids.length > MAX_COMPARISON_JOBS) {
    throw new HttpError(400, `单次请选择 ${MIN_COMPARISON_JOBS}–${MAX_COMPARISON_JOBS} 个岗位`);
  }

  const cleanedCriterion = cleanText(criterion);
  if (!cleanedCriterion) throw new HttpError(400, "请填写本次比较标准");
  if (cleanedCriterion.length > MAX_COMPARISON_CRITERION) {
    throw new HttpError(400, `比较标准不能超过 ${MAX_COMPARISON_CRITERION} 字`);
  }

  const jobsById = new Map(jobs.map((job) => [job.recordId, job]));
  const selectedJobs = ids.map((recordId) => jobsById.get(recordId));
  const missingIds = ids.filter((_, index) => !selectedJobs[index]);
  if (missingIds.length) throw new HttpError(404, "部分岗位不存在，请刷新后重新选择");

  const missingJd = selectedJobs.filter((job) => !cleanText(job.jd));
  if (missingJd.length) {
    throw new HttpError(
      400,
      `以下岗位缺少 JD：${missingJd.map((job) => `${job.company} · ${job.position}`).join("、")}`,
    );
  }

  const usableExperiences = experiences
    .filter((experience) => cleanText(experience.title))
    .filter((experience) => cleanText(experience.summary || experience.content))
    .map((experience) => ({
      title: cleanText(experience.title),
      tags: Array.isArray(experience.tags) ? experience.tags.map(cleanText).filter(Boolean) : [],
      summary: cleanText(experience.summary),
      content: clip(experience.content || experience.summary, MAX_EXPERIENCE_CONTENT),
    }));
  if (!usableExperiences.length) throw new HttpError(400, "经历库没有可用于比较的经历");

  return {
    criterion: cleanedCriterion,
    selectedJobs,
    promptJobs: selectedJobs.map((job) => ({
      recordId: job.recordId,
      company: cleanText(job.company),
      position: cleanText(job.position),
      status: cleanText(job.status),
      jd: cleanText(job.jd),
    })),
    promptExperiences: usableExperiences,
  };
}

function requiredText(value, field) {
  const text = cleanText(value);
  if (!text) throw new Error(`岗位比较结果缺少 ${field}`);
  return text;
}

function score(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`岗位比较结果的 ${field} 必须是 0–100 的整数`);
  }
  return value;
}

function textList(value, field) {
  if (!Array.isArray(value)) throw new Error(`岗位比较结果的 ${field} 必须是数组`);
  return value.map((item, index) => requiredText(item, `${field}[${index}]`));
}

function objectList(value, fields, label) {
  if (!Array.isArray(value)) throw new Error(`岗位比较结果的 ${label} 必须是数组`);
  return value.map((item, index) => Object.fromEntries(
    fields.map((field) => [field, requiredText(item?.[field], `${label}[${index}].${field}`)]),
  ));
}

function technicalRequirement(value) {
  const level = requiredText(value?.level, "technicalRequirement.level");
  if (!["none", "preferred", "required"].includes(level)) {
    throw new Error("岗位比较结果的 technicalRequirement.level 非法");
  }
  const penalty = value?.penalty;
  if (!Number.isInteger(penalty) || penalty < -10 || penalty > 0) {
    throw new Error("岗位比较结果的 technicalRequirement.penalty 必须是 -10–0 的整数");
  }
  return {
    level,
    penalty,
    evidence: requiredText(value?.evidence, "technicalRequirement.evidence"),
    assessment: requiredText(value?.assessment, "technicalRequirement.assessment"),
  };
}

export function normalizeComparisonResult(raw, selectedJobs) {
  if (!raw || typeof raw !== "object") throw new Error("岗位比较结果不是有效对象");
  if (!Array.isArray(raw.jobs)) throw new Error("岗位比较结果缺少 jobs");

  const selectedIds = selectedJobs.map((job) => job.recordId);
  const returnedById = new Map();
  for (const item of raw.jobs) {
    const recordId = cleanText(item?.recordId);
    if (!selectedIds.includes(recordId)) throw new Error("岗位比较结果包含未选择的岗位");
    if (returnedById.has(recordId)) throw new Error("岗位比较结果包含重复岗位");
    returnedById.set(recordId, item);
  }
  if (returnedById.size !== selectedIds.length) throw new Error("岗位比较结果缺少部分岗位");

  const selectionOrder = new Map(selectedIds.map((recordId, index) => [recordId, index]));
  const normalizedJobs = selectedJobs.map((job) => {
    const item = returnedById.get(job.recordId);
    const criterionScore = score(item.criterionScore, "criterionScore");
    const experienceScore = score(item.experienceScore, "experienceScore");
    const technical = technicalRequirement(item.technicalRequirement);
    return {
      recordId: job.recordId,
      company: cleanText(job.company),
      position: cleanText(job.position),
      status: cleanText(job.status),
      overallScore: Math.max(0, Math.round((criterionScore + experienceScore) / 2 + technical.penalty)),
      criterionScore,
      experienceScore,
      technicalRequirement: technical,
      criterionSummary: requiredText(item.criterionSummary, "criterionSummary"),
      experienceSummary: requiredText(item.experienceSummary, "experienceSummary"),
      bestFor: requiredText(item.bestFor, "bestFor"),
      criterionEvidence: objectList(
        item.criterionEvidence,
        ["requirement", "evidence", "assessment"],
        "criterionEvidence",
      ),
      experienceEvidence: objectList(
        item.experienceEvidence,
        ["requirement", "experienceTitle", "evidence"],
        "experienceEvidence",
      ),
      gaps: textList(item.gaps, "gaps"),
      uncertainties: textList(item.uncertainties, "uncertainties"),
    };
  }).sort((a, b) =>
    b.overallScore - a.overallScore
    || selectionOrder.get(a.recordId) - selectionOrder.get(b.recordId));

  return {
    summary: requiredText(raw.summary, "summary"),
    contrasts: objectList(raw.contrasts, ["topic", "observation"], "contrasts"),
    jobs: normalizedJobs,
  };
}

export function mockComparisonResult(selectedJobs, experiences = []) {
  const experienceTitle = experiences[0]?.title || "经历库示例";
  return {
    summary: "MOCK：这些岗位的侧重点不同，请结合下方证据自行判断。",
    contrasts: [
      { topic: "岗位侧重点", observation: "MOCK：部分岗位偏策略分析，部分岗位偏执行落地。" },
    ],
    jobs: selectedJobs.map((job, index) => ({
      recordId: job.recordId,
      criterionScore: 60 + (index % 4) * 5,
      experienceScore: 55 + (index % 3) * 7,
      criterionSummary: "MOCK：与本次标准有部分明确重合。",
      experienceSummary: "MOCK：经历库中存在可迁移经验，但仍需补足岗位特定能力。",
      bestFor: "MOCK：适合用于验证相关能力与岗位兴趣。",
      technicalRequirement: index % 3 === 0
        ? { level: "preferred", penalty: -4, evidence: "MOCK：JD 提到理工科或技术背景优先", assessment: "存在一定技术倾向" }
        : { level: "none", penalty: 0, evidence: "MOCK：JD 未提出专业背景要求", assessment: "不因专业背景扣分" },
      criterionEvidence: [
        { requirement: "JD 核心要求", evidence: `${job.company} · ${job.position} 的岗位描述`, assessment: "MOCK：部分符合" },
      ],
      experienceEvidence: [
        { requirement: "岗位相关能力", experienceTitle, evidence: "MOCK：已有经历可提供初步证据" },
      ],
      gaps: ["MOCK：需要进一步确认岗位业务深度要求"],
      uncertainties: ["MOCK：招聘信息未说明团队具体分工"],
    })),
  };
}
