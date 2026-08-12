import { HttpError, requireBody } from "../http/app.js";
import {
  createRecord,
  deleteRecord,
  getRecord,
  listRecords,
  updateRecord,
} from "../storage/bitable.js";
import {
  JOB_STAR_VALUE,
  JOB_STATUSES,
  RESUME_CODE_PATTERN,
  RESUME_REQUIRED_STATUSES,
} from "../storage/schema.js";
import { getCompany, getJob, hydrateJob, listJobs } from "../services/companies.js";
import { recomputeApplyRecords } from "../services/resume.js";
import { createPrepDoc } from "../services/prep-doc.js";

const JOB_PATCH_FIELDS = new Set([
  "position",
  "jd",
  "deadline",
  "referralCode",
  "status",
  "starred",
  "resumeId",
  "prepDocUrl",
  "intro1min",
  "intro3min",
  "intro5min",
  "introEn",
  "note",
]);

function pickPatch(body) {
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (!JOB_PATCH_FIELDS.has(key)) continue;
    if (key === "starred") {
      patch.starred = value ? JOB_STAR_VALUE : "";
      continue;
    }
    patch[key] = ["position", "status", "resumeId"].includes(key)
      ? String(value || "").trim()
      : value;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
  return patch;
}

async function validateJob(job) {
  const companyId = String(job.companyId || "").trim();
  const position = String(job.position || "").trim();
  const jd = String(job.jd || "").trim();
  const status = String(job.status || "待投").trim();
  const resumeId = String(job.resumeId || "").trim();

  if (!companyId) throw new HttpError(400, "岗位必须选择公司");
  if (!position) throw new HttpError(400, "岗位名要填");
  if (!jd) throw new HttpError(400, "JD 要填");
  if (!JOB_STATUSES.includes(status)) {
    throw new HttpError(400, `状态必须是：${JOB_STATUSES.join("/")}`);
  }
  if (RESUME_REQUIRED_STATUSES.has(status) && !resumeId) {
    throw new HttpError(400, `状态为「${status}」时必须选择简历`);
  }
  if (resumeId) {
    if (!RESUME_CODE_PATTERN.test(resumeId)) throw new HttpError(400, "简历编号格式必须是 R{数字}");
    const resumes = await listRecords("resume");
    if (!resumes.some((resume) => resume.code === resumeId)) {
      throw new HttpError(400, `简历库里没有编号 ${resumeId}`);
    }
  }

  return getCompany(companyId);
}

async function recomputeWarning() {
  try {
    await recomputeApplyRecords();
    return null;
  } catch (error) {
    return `岗位已保存，但简历投递记录同步失败：${error.message}`;
  }
}

export const jobRoutes = [
  {
    method: "GET",
    path: "/api/jobs",
    handler: () => listJobs(),
  },
  {
    method: "GET",
    path: "/api/jobs/:recordId",
    handler: ({ params }) => getJob(params.recordId),
  },
  {
    method: "POST",
    path: "/api/jobs",
    handler: async ({ body }) => {
      requireBody(body, ["companyId", "position", "jd"]);
      const patch = {
        companyId: String(body.companyId).trim(),
        position: String(body.position).trim(),
        jd: String(body.jd).trim(),
        status: String(body.status || "待投").trim(),
        resumeId: String(body.resumeId || "").trim(),
      };
      if (body.starred) patch.starred = JOB_STAR_VALUE;
      if (body.deadline !== undefined && body.deadline !== "") patch.deadline = body.deadline;

      const company = await validateJob(patch);
      const job = await createRecord("main", {
        ...patch,
        company: company.name,
        siteUrl: company.siteUrl || "",
        companyBackground: company.companyBackground || "",
        note: company.note || "",
      });
      return hydrateJob(job, company);
    },
  },
  {
    method: "PATCH",
    path: "/api/jobs/:recordId",
    handler: async ({ params, body }) => {
      const current = await getRecord("main", params.recordId);
      if (!String(current.position || "").trim()) throw new HttpError(404, "岗位不存在");
      const patch = pickPatch(body);
      const company = await validateJob({ ...current, ...patch });
      const updated = await updateRecord("main", params.recordId, patch);
      const persistedPatch = Object.fromEntries(
        Object.keys(patch).map((key) => [key, updated[key]]),
      );
      const warning = "status" in patch || "resumeId" in patch ? await recomputeWarning() : null;
      return { job: hydrateJob({ ...current, ...persistedPatch }, company), warning };
    },
  },
  {
    method: "DELETE",
    path: "/api/jobs/:recordId",
    handler: async ({ params }) => {
      const result = await deleteRecord("main", params.recordId);
      return { ...result, warning: await recomputeWarning() };
    },
  },
  {
    method: "POST",
    path: "/api/jobs/:recordId/prep-doc",
    handler: async ({ params }) => {
      const job = await getJob(params.recordId);
      if (job.prepDocUrl) throw new HttpError(409, `已有准备文档：${job.prepDocUrl}`);
      const doc = await createPrepDoc({
        title: `${job.company}-${job.position} 面试准备`,
        content: `# ${job.company} ${job.position}\n\n## JD\n${job.jd}\n\n## 面试复盘\n`,
      });
      const writeBack = await updateRecord("main", params.recordId, { prepDocUrl: doc.url })
        .then(() => null)
        .catch((error) => error.message);
      return { ...doc, writeBackError: writeBack };
    },
  },
];
