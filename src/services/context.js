import { HttpError } from "../http/app.js";
import { getRecord, listRecords } from "../storage/bitable.js";

async function findResumeByCode(code) {
  const target = String(code || "").trim();
  if (!target) return null;
  const resumes = await listRecords("resume");
  return resumes.find((resume) => String(resume.code || "").trim() === target) || null;
}

/**
 * 组装 AI 需要的岗位上下文。
 * 简历优先用请求里显式指定的编号，否则用主表里已填的简历编号。
 * 不注入完整经历库：会稀释注意力且 token 随对话轮次翻倍增长。
 */
export async function buildJobContext(recordId, { resumeCode } = {}) {
  const job = await getRecord("main", recordId);
  const code = resumeCode || job.resumeId;
  const resume = code ? await findResumeByCode(code) : null;
  if (code && !resume) throw new HttpError(404, `简历库里没有编号 ${code}`);

  return {
    job,
    resume,
    vars: {
      company: job.company || "",
      position: job.position || "",
      jd: job.jd || "",
      jd_summary: job.jd || "",
      resume_content: resume?.content || "（未指定简历版本）",
      company_background_section: job.companyBackground
        ? `公司背景补充：\n${job.companyBackground}`
        : "",
    },
  };
}
