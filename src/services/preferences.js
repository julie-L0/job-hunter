import { HttpError } from "../http/app.js";
import { createRecord, listRecords, updateRecord } from "../storage/bitable.js";
import { COMPARISON_STAGES } from "../storage/schema.js";

export const DEFAULT_COMPARISON_CONFIG = "默认偏好";
export const STAGE_WEIGHTS = {
  练手: { career: 30, practice: 55, fallback: 15 },
  均衡: { career: 40, practice: 40, fallback: 20 },
  冲刺: { career: 70, practice: 20, fallback: 10 },
  兜底: { career: 20, practice: 25, fallback: 55 },
};

export const STAGE_DESCRIPTIONS = {
  练手: "优先找能带来面试训练的岗位，看能否练项目表达、JD 拆解、业务理解，失败成本是否低。",
  均衡: "同时看岗位本身价值和练手机会，适合不确定下一批投递重点时使用。",
  冲刺: "优先真正想去、长期方向匹配、值得认真准备的岗位。",
  兜底: "优先找更容易推进、门槛更友好、准备成本更低的岗位；不等于随便投。",
};

const DEFAULT_VALUE_ORIENTATION = [
  "偏向 AI 产品、ToB / 平台型 / 工具型产品；",
  "不太想去明显高压、强销售、强地推或强卷文化公司；",
  "可以接受 ToC 作为过渡，但长期更想积累 AI、产品机制设计、技术理解和复杂系统协作。",
].join("\n");

const cleanText = (value) => String(value ?? "").trim();

function weightsFor(stage) {
  return STAGE_WEIGHTS[stage] || STAGE_WEIGHTS.练手;
}

export function defaultComparisonPreference() {
  const stage = "练手";
  const weights = weightsFor(stage);
  return {
    configName: DEFAULT_COMPARISON_CONFIG,
    stage,
    careerWeight: weights.career,
    practiceWeight: weights.practice,
    fallbackWeight: weights.fallback,
    valueOrientation: DEFAULT_VALUE_ORIENTATION,
    updatedAt: Date.now(),
  };
}

export function normalizeComparisonPreference(raw = {}) {
  const fallback = defaultComparisonPreference();
  const stage = COMPARISON_STAGES.includes(cleanText(raw.stage)) ? cleanText(raw.stage) : fallback.stage;
  const weights = weightsFor(stage);
  return {
    recordId: raw.recordId || null,
    configName: cleanText(raw.configName) || DEFAULT_COMPARISON_CONFIG,
    stage,
    careerWeight: weights.career,
    practiceWeight: weights.practice,
    fallbackWeight: weights.fallback,
    valueOrientation: cleanText(raw.valueOrientation) || fallback.valueOrientation,
    updatedAt: raw.updatedAt || null,
    stageDescription: STAGE_DESCRIPTIONS[stage],
  };
}

export function preferenceForPrompt(preference) {
  const normalized = normalizeComparisonPreference(preference);
  return {
    stage: normalized.stage,
    stageDescription: normalized.stageDescription,
    weights: {
      careerValue: normalized.careerWeight,
      practiceValue: normalized.practiceWeight,
      fallbackValue: normalized.fallbackWeight,
    },
    valueOrientation: normalized.valueOrientation,
  };
}

export function validateComparisonPreferencePatch(body = {}) {
  const patch = {};
  if (body.stage !== undefined) {
    const stage = cleanText(body.stage);
    if (!COMPARISON_STAGES.includes(stage)) {
      throw new HttpError(400, `阶段策略必须是：${COMPARISON_STAGES.join("/")}`);
    }
    const weights = weightsFor(stage);
    Object.assign(patch, {
      stage,
      careerWeight: weights.career,
      practiceWeight: weights.practice,
      fallbackWeight: weights.fallback,
    });
  }
  if (body.valueOrientation !== undefined) {
    const valueOrientation = cleanText(body.valueOrientation);
    if (valueOrientation.length > 1200) throw new HttpError(400, "价值取向不能超过 1200 字");
    patch.valueOrientation = valueOrientation;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
  patch.configName = DEFAULT_COMPARISON_CONFIG;
  patch.updatedAt = Date.now();
  return patch;
}

export async function getComparisonPreference() {
  const records = await listRecords("preference");
  const record = records.find((item) => cleanText(item.configName) === DEFAULT_COMPARISON_CONFIG);
  if (record) return normalizeComparisonPreference(record);
  const created = await createRecord("preference", defaultComparisonPreference());
  return normalizeComparisonPreference(created);
}

export async function updateComparisonPreference(body) {
  const current = await getComparisonPreference();
  const patch = validateComparisonPreferencePatch(body);
  const updated = current.recordId
    ? await updateRecord("preference", current.recordId, patch)
    : await createRecord("preference", { ...defaultComparisonPreference(), ...patch });
  return normalizeComparisonPreference(updated);
}
