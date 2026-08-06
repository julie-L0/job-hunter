import { listRecords, batchUpdateRecords } from "../storage/bitable.js";
import { RESUME_CODE_PATTERN } from "../storage/schema.js";

// 待投 = 还没投出去，不计入简历的投递记录
const APPLIED = new Set(["已投", "笔试", "一面", "二面", "三面", "挂", "offer"]);

/** 取现有编号里 R{n} 的最大 n +1。不匹配格式的编号忽略，已删除编号的空缺不复用。 */
export async function nextResumeCode(existing) {
  const resumes = existing ?? (await listRecords("resume"));
  let max = 0;
  for (const resume of resumes) {
    const match = RESUME_CODE_PATTERN.exec(String(resume.code || "").trim());
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `R${max + 1}`;
}

function label(job) {
  return [job.company, job.position].filter(Boolean).join("-");
}

/**
 * 全量重算简历库「投递记录」。
 * 必须全量而非增量：简历编号被改、状态回退、岗位删除都会让增量结果错。
 */
export async function recomputeApplyRecords() {
  const [jobs, resumes] = await Promise.all([listRecords("main"), listRecords("resume")]);

  const byCode = new Map();
  for (const job of jobs) {
    if (!job.resumeId || !APPLIED.has(job.status)) continue;
    const code = String(job.resumeId).trim();
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(label(job));
  }

  const updates = resumes
    .map((resume) => ({
      recordId: resume.recordId,
      next: (byCode.get(String(resume.code || "").trim()) || []).join("、"),
      current: resume.applyRecord || "",
    }))
    .filter((row) => row.next !== row.current)
    .map((row) => ({ recordId: row.recordId, patch: { applyRecord: row.next } }));

  if (updates.length) await batchUpdateRecords("resume", updates);
  return { updated: updates.length };
}
