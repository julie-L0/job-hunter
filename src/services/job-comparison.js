import { HttpError } from "../http/app.js";
import { defaultComparisonPreference, normalizeComparisonPreference, preferenceForPrompt } from "./preferences.js";

export const MIN_COMPARISON_JOBS = 2;
export const MAX_COMPARISON_JOBS = 20;
export const MAX_COMPARISON_CRITERION = 500;
const MAX_EXPERIENCE_CONTENT = 2400;
const MAX_RESUME_CONTENT = 2200;

const cleanText = (value) => String(value || "").trim();

function clip(value, limit) {
  const text = cleanText(value);
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function buildComparisonContext({ recordIds, criterion, jobs, experiences, resumes = [], preference }) {
  if (!Array.isArray(recordIds)) throw new HttpError(400, "请选择要比较的岗位");
  const ids = [...new Set(recordIds.map(cleanText).filter(Boolean))];
  if (ids.length < MIN_COMPARISON_JOBS || ids.length > MAX_COMPARISON_JOBS) {
    throw new HttpError(400, `单次请选择 ${MIN_COMPARISON_JOBS}–${MAX_COMPARISON_JOBS} 个岗位`);
  }

  const cleanedCriterion = cleanText(criterion) || "无额外补充标准，请按用户偏好和当前阶段判断。";
  if (cleanedCriterion.length > MAX_COMPARISON_CRITERION) {
    throw new HttpError(400, `本次补充标准不能超过 ${MAX_COMPARISON_CRITERION} 字`);
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
      type: cleanText(experience.type) || "未分类",
      tags: Array.isArray(experience.tags) ? experience.tags.map(cleanText).filter(Boolean) : [],
      summary: cleanText(experience.summary),
      content: clip(experience.content || experience.summary, MAX_EXPERIENCE_CONTENT),
    }));
  if (!usableExperiences.length) throw new HttpError(400, "经历库没有可用于比较的经历");

  const usableResumes = (Array.isArray(resumes) ? resumes : [])
    .filter((resume) => cleanText(resume.code || resume.versionName || resume.content))
    .map((resume) => ({
      code: cleanText(resume.code),
      versionName: cleanText(resume.versionName),
      direction: cleanText(resume.direction),
      content: clip(resume.content, MAX_RESUME_CONTENT),
    }));

  const comparisonPreference = normalizeComparisonPreference(preference || defaultComparisonPreference());

  return {
    criterion: cleanedCriterion,
    preference: comparisonPreference,
    promptPreference: preferenceForPrompt(comparisonPreference),
    selectedJobs,
    promptJobs: selectedJobs.map((job) => ({
      recordId: job.recordId,
      company: cleanText(job.company),
      position: cleanText(job.position),
      status: cleanText(job.status),
      jd: cleanText(job.jd),
    })),
    promptExperiences: usableExperiences,
    promptResumes: usableResumes,
  };
}

function requiredText(value, field) {
  const text = cleanText(value);
  if (!text) throw new Error(`岗位比较结果缺少 ${field}`);
  return text;
}

function numericScore(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = value.trim().match(/^-?\d+(?:\.\d+)?/);
    if (match) return Number(match[0]);
  }
  return null;
}

function score(value, field, fallback) {
  const parsed = numericScore(value);
  if (parsed !== null) {
    const rounded = Math.round(parsed);
    if (rounded >= 0 && rounded <= 100) return rounded;
  }
  if (fallback !== undefined) return fallback;
  if (value !== undefined && value !== null) {
    throw new Error(`岗位比较结果的 ${field} 必须是 0–100 的整数`);
  }
  throw new Error(`岗位比较结果缺少 ${field}`);
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function boundedInteger(value, field, min, max) {
  const parsed = numericScore(value);
  if (parsed === null) throw new Error(`岗位比较结果缺少 ${field}`);
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) {
    throw new Error(`岗位比较结果的 ${field} 必须是 ${min}–${max} 的整数`);
  }
  return rounded;
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

function optionalTextList(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
  return textList(value, "optionalTextList");
}

function optionalObjectList(value, fields, label, fallback = []) {
  if (value === undefined || value === null) return fallback;
  return objectList(value, fields, label);
}

function scoreRationaleList(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) throw new Error("岗位比较结果的 scoreRationale 必须是数组");
  return value.map((item, index) => ({
    dimension: requiredText(item?.dimension, `scoreRationale[${index}].dimension`),
    score: score(
      item?.score,
      `scoreRationale[${index}].score`,
      fallback.find((candidate) => candidate.dimension === cleanText(item?.dimension))?.score ?? fallback[index]?.score,
    ),
    reason: requiredText(item?.reason, `scoreRationale[${index}].reason`),
  }));
}

function scoreBreakdownList(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) throw new Error("岗位比较结果的 scoreBreakdown 必须是数组");
  return value.map((item, index) => ({
    dimension: requiredText(item?.dimension, `scoreBreakdown[${index}].dimension`),
    score: score(
      item?.score,
      `scoreBreakdown[${index}].score`,
      fallback.find((candidate) => candidate.dimension === cleanText(item?.dimension))?.score ?? fallback[index]?.score,
    ),
    reason: requiredText(item?.reason, `scoreBreakdown[${index}].reason`),
  }));
}

function matchedExperienceList(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) throw new Error("岗位比较结果的 matchedExperiences 必须是数组");
  return value.map((item, index) => {
    const strength = requiredText(item?.strength, `matchedExperiences[${index}].strength`);
    if (!["strong", "medium", "weak"].includes(strength)) {
      throw new Error("岗位比较结果的 matchedExperiences.strength 非法");
    }
    return {
      experienceTitle: requiredText(item?.experienceTitle, `matchedExperiences[${index}].experienceTitle`),
      jdRequirement: requiredText(item?.jdRequirement, `matchedExperiences[${index}].jdRequirement`),
      proof: requiredText(item?.proof, `matchedExperiences[${index}].proof`),
      strength,
    };
  });
}

function jdChecklistList(value, fallback = []) {
  if (value === undefined || value === null) return fallback;
  if (!Array.isArray(value)) throw new Error("岗位比较结果的 jdChecklist 必须是数组");
  return value.map((item, index) => {
    const status = requiredText(item?.status, `jdChecklist[${index}].status`);
    if (!["fit", "partial", "gap", "unclear"].includes(status)) {
      throw new Error("岗位比较结果的 jdChecklist.status 非法");
    }
    return {
      requirement: requiredText(item?.requirement, `jdChecklist[${index}].requirement`),
      jdEvidence: requiredText(item?.jdEvidence, `jdChecklist[${index}].jdEvidence`),
      status,
      matchedExperienceTitle: cleanText(item?.matchedExperienceTitle),
      proof: cleanText(item?.proof),
      gap: cleanText(item?.gap),
      action: cleanText(item?.action),
    };
  });
}

function technicalRequirement(value) {
  const level = requiredText(value?.level, "technicalRequirement.level");
  if (!["none", "preferred", "required"].includes(level)) {
    throw new Error("岗位比较结果的 technicalRequirement.level 非法");
  }
  const backgroundFit = cleanText(value?.backgroundFit || "unclear");
  if (!["none", "match", "adjacent", "mismatch", "unclear"].includes(backgroundFit)) {
    throw new Error("岗位比较结果的 technicalRequirement.backgroundFit 非法");
  }
  const penalty = boundedInteger(value?.penalty, "technicalRequirement.penalty", -10, 10);
  return {
    level,
    backgroundFit,
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
  const preference = normalizeComparisonPreference(raw.preference || raw.comparisonPreference || defaultComparisonPreference());
  const weightTotal = preference.careerWeight + preference.practiceWeight + preference.fallbackWeight;
  const normalizedJobs = selectedJobs.map((job) => {
    const item = returnedById.get(job.recordId);
    const careerValueScore = score(item.careerValueScore ?? item.criterionScore, "careerValueScore");
    const practiceValueScore = score(item.practiceValueScore ?? item.criterionScore, "practiceValueScore");
    const fallbackValueScore = score(item.fallbackValueScore ?? item.experienceScore, "fallbackValueScore");
    const criterionScore = score(item.criterionScore ?? careerValueScore, "criterionScore", careerValueScore);
    const experienceScore = score(item.experienceScore ?? fallbackValueScore, "experienceScore", fallbackValueScore);
    const technical = technicalRequirement(item.technicalRequirement);
    const criterionEvidence = objectList(
      item.criterionEvidence,
      ["requirement", "evidence", "assessment"],
      "criterionEvidence",
    );
    const experienceEvidence = objectList(
      item.experienceEvidence,
      ["requirement", "experienceTitle", "evidence"],
      "experienceEvidence",
    );
    const gaps = textList(item.gaps, "gaps");
    const scoreFallback = [
      { dimension: "求职价值", score: careerValueScore, reason: requiredText(item.careerValueSummary ?? item.criterionSummary, "careerValueSummary") },
      { dimension: "练手价值", score: practiceValueScore, reason: requiredText(item.practiceValueSummary ?? item.bestFor, "practiceValueSummary") },
      { dimension: "兜底价值", score: fallbackValueScore, reason: requiredText(item.fallbackValueSummary ?? item.experienceSummary, "fallbackValueSummary") },
      {
        dimension: "专业/技术倾向",
        score: clampScore(100 + technical.penalty * 10),
        reason: `${technical.evidence}；${technical.assessment}`,
      },
    ];
    const matchedFallback = experienceEvidence.map((evidence) => ({
      experienceTitle: evidence.experienceTitle,
      jdRequirement: evidence.requirement,
      proof: evidence.evidence,
      strength: "medium",
    }));
    const checklistFallback = criterionEvidence.map((evidence) => {
      const matched = experienceEvidence.find((item) => item.requirement === evidence.requirement);
      return {
        requirement: evidence.requirement,
        jdEvidence: evidence.evidence,
        status: matched ? "partial" : "unclear",
        matchedExperienceTitle: matched?.experienceTitle || "",
        proof: matched?.evidence || evidence.assessment,
        gap: matched ? "" : "需要进一步确认经历库是否有直接证据",
        action: matched ? "准备这段经历如何对应 JD 的说法" : "补充岗位要求对应的案例或信息",
      };
    });
    return {
      recordId: job.recordId,
      company: cleanText(job.company),
      position: cleanText(job.position),
      status: cleanText(job.status),
      overallScore: clampScore(
        (careerValueScore * preference.careerWeight
          + practiceValueScore * preference.practiceWeight
          + fallbackValueScore * preference.fallbackWeight) / weightTotal
        + technical.penalty,
      ),
      careerValueScore,
      practiceValueScore,
      fallbackValueScore,
      criterionScore,
      experienceScore,
      technicalRequirement: technical,
      careerValueSummary: requiredText(item.careerValueSummary ?? item.criterionSummary, "careerValueSummary"),
      practiceValueSummary: requiredText(item.practiceValueSummary ?? item.bestFor, "practiceValueSummary"),
      fallbackValueSummary: requiredText(item.fallbackValueSummary ?? item.experienceSummary, "fallbackValueSummary"),
      criterionSummary: requiredText(item.criterionSummary ?? item.careerValueSummary, "criterionSummary"),
      experienceSummary: requiredText(item.experienceSummary, "experienceSummary"),
      quickTake: cleanText(item.quickTake) || `${cleanText(job.company)} · ${cleanText(job.position)}：${requiredText(item.bestFor, "bestFor")}`,
      bestFor: requiredText(item.bestFor, "bestFor"),
      recommendedUse: requiredText(item.recommendedUse ?? item.bestFor, "recommendedUse"),
      conflictNotes: optionalTextList(item.conflictNotes, []),
      scoreBreakdown: scoreBreakdownList(item.scoreBreakdown, scoreFallback),
      scoreRationale: scoreRationaleList(item.scoreRationale, scoreFallback),
      criterionEvidence,
      experienceEvidence,
      matchedExperiences: matchedExperienceList(item.matchedExperiences, matchedFallback),
      jdChecklist: jdChecklistList(item.jdChecklist, checklistFallback),
      gaps,
      risks: optionalTextList(item.risks, gaps),
      prepFocus: optionalTextList(item.prepFocus, gaps.map((gap) => `补充准备：${gap}`)),
      uncertainties: textList(item.uncertainties, "uncertainties"),
    };
  }).sort((a, b) =>
    b.overallScore - a.overallScore
    || selectionOrder.get(a.recordId) - selectionOrder.get(b.recordId));

  return {
    summary: requiredText(raw.summary, "summary"),
    contrasts: objectList(raw.contrasts, ["topic", "observation"], "contrasts"),
    preference,
    jobs: normalizedJobs,
  };
}

export function mockComparisonResult(selectedJobs, experiences = [], preference = defaultComparisonPreference()) {
  const normalizedPreference = normalizeComparisonPreference(preference);
  const experienceTitle = experiences[0]?.title || "经历库示例";
  const experienceSummary = experiences[0]?.summary || experiences[0]?.content || "已有经历可作为初步证据，但需要用真实模型做精确匹配。";
  return {
    summary: "当前处于 AI 占位模式：这里只用于检查页面结构，接入真实模型后会返回基于 JD 和经历库的具体判断。",
    preference: normalizedPreference,
    contrasts: [
      { topic: "业务侧重点", observation: "占位：真实结果会比较各岗位在产品策略、运营执行、数据分析、技术背景要求上的差异。" },
      { topic: "经历证据", observation: `占位：会逐岗引用经历库标题，例如「${experienceTitle}」，说明能证明哪条 JD 要求。` },
    ],
    jobs: selectedJobs.map((job, index) => ({
      recordId: job.recordId,
      careerValueScore: 58 + (index % 4) * 7,
      practiceValueScore: 72 - (index % 3) * 5,
      fallbackValueScore: 52 + (index % 5) * 6,
      criterionScore: 60 + (index % 4) * 5,
      experienceScore: 55 + (index % 3) * 7,
      quickTake: `占位速览：${job.company} · ${job.position} 需要结合真实 JD 判断核心要求、可证明经历和准备成本。`,
      careerValueSummary: "占位：会结合长期方向、价值取向、公司/业务吸引力和简历匹配判断是否值得认真投入。",
      practiceValueSummary: "占位：会判断这场面试能否训练项目表达、JD 拆解、业务理解和结构化沟通。",
      fallbackValueSummary: "占位：会判断门槛友好度、准备成本和推进到笔试/面试的可能性。",
      criterionSummary: "占位：会根据本次标准逐条判断岗位要求是否匹配。",
      experienceSummary: "占位：会根据经历库判断已有证据强弱。",
      bestFor: "占位：真实模型会说明这个岗位适合验证或发展什么能力。",
      recommendedUse: normalizedPreference.stage === "兜底" ? "兜底观察" : normalizedPreference.stage === "冲刺" ? "认真冲刺" : "练手优先",
      conflictNotes: ["占位：真实模型会提示简历契合但个人偏好冲突等情况"],
      technicalRequirement: index % 3 === 0
        ? { level: "preferred", backgroundFit: "adjacent", penalty: 0, evidence: "占位：真实模型会引用 JD 中的专业或技术背景表述", assessment: "存在技术倾向；若简历背景同属要求范围则不扣分或加分" }
        : { level: "none", backgroundFit: "none", penalty: 0, evidence: "占位：真实模型会检查 JD 是否提出专业背景要求", assessment: "不因专业背景调整分数" },
      criterionEvidence: [
        { requirement: "JD 核心要求", evidence: `${job.company} · ${job.position} 的岗位描述`, assessment: "占位：真实模型会判断具体符合点" },
      ],
      experienceEvidence: [
        { requirement: "岗位相关能力", experienceTitle, evidence: "占位：已有经历可提供初步证据" },
      ],
      scoreRationale: [
        { dimension: "求职价值", score: 58 + (index % 4) * 7, reason: "占位：真实模型会结合长期方向、个人偏好、公司/业务吸引力和简历匹配判断。" },
        { dimension: "练手价值", score: 72 - (index % 3) * 5, reason: "占位：真实模型会判断能训练哪些面试能力，以及失败成本是否低。" },
        { dimension: "兜底价值", score: 52 + (index % 5) * 6, reason: "占位：真实模型会判断门槛友好度、准备成本和推进可能性。" },
        { dimension: "专业/技术倾向", score: index % 3 === 0 ? 60 : 100, reason: "占位：真实模型会识别 JD 是否要求理工科、计算机或技术背景。" },
      ],
      scoreBreakdown: [
        { dimension: "求职价值", score: 58 + (index % 4) * 7, reason: "占位：长期方向和意愿判断。" },
        { dimension: "练手价值", score: 72 - (index % 3) * 5, reason: "占位：面试训练价值判断。" },
        { dimension: "兜底价值", score: 52 + (index % 5) * 6, reason: "占位：推进和保底价值判断。" },
      ],
      matchedExperiences: [
        {
          experienceTitle,
          jdRequirement: "岗位相关能力",
          proof: clip(experienceSummary, 120),
          strength: "medium",
        },
      ],
      jdChecklist: [
        {
          requirement: "岗位相关能力",
          jdEvidence: `${job.company} · ${job.position} 的岗位描述`,
          status: "partial",
          matchedExperienceTitle: experienceTitle,
          proof: clip(experienceSummary, 120),
          gap: "占位：真实模型会写明缺少哪类直接证据",
          action: "占位：准备这段经历如何对应 JD 的说法",
        },
      ],
      gaps: ["占位：需要进一步确认岗位业务深度要求"],
      risks: ["占位：真实模型会列出准备成本、能力缺口或专业背景风险"],
      prepFocus: ["占位：补齐岗位业务理解", `占位：准备「${experienceTitle}」如何对应 JD 要求的说法`],
      uncertainties: ["占位：招聘信息未说明团队具体分工"],
    })),
  };
}
