import { HttpError, requireBody } from "../http/app.js";
import { createRecord, deleteRecord, getRecord, listRecords, updateRecord } from "../storage/bitable.js";
import { JOB_STATUSES, SCHEMAS } from "../storage/schema.js";
import { recomputeApplyRecords } from "../services/resume.js";
import { createPrepDoc } from "../services/prep-doc.js";

const WRITABLE = new Set(Object.keys(SCHEMAS.main.fields));

function pickPatch(body) {
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (WRITABLE.has(key)) patch[key] = value;
  }
  if (patch.status && !JOB_STATUSES.includes(patch.status)) {
    throw new HttpError(400, `状态必须是：${JOB_STATUSES.join("/")}`);
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
  return patch;
}

// 投递记录是派生数据，它算失败不该让主写入看起来失败
async function safeRecompute() {
  return recomputeApplyRecords().catch((error) => ({ error: error.message }));
}

export const jobRoutes = [
  {
    method: "GET",
    path: "/api/jobs",
    handler: () => listRecords("main"),
  },
  {
    method: "GET",
    path: "/api/jobs/:recordId",
    handler: ({ params }) => getRecord("main", params.recordId),
  },
  {
    method: "POST",
    path: "/api/jobs",
    handler: async ({ body }) => {
      requireBody(body, ["company", "position"]);
      const job = await createRecord("main", { status: "待投", ...pickPatch(body) });
      return job;
    },
  },
  {
    method: "PATCH",
    path: "/api/jobs/:recordId",
    handler: async ({ params, body }) => {
      const patch = pickPatch(body);
      const job = await updateRecord("main", params.recordId, patch);
      // 状态或简历编号变化会改变简历库的投递记录归属
      const recompute =
        "status" in patch || "resumeId" in patch ? await safeRecompute() : null;
      return { job, recompute };
    },
  },
  {
    method: "DELETE",
    path: "/api/jobs/:recordId",
    handler: async ({ params }) => {
      const result = await deleteRecord("main", params.recordId);
      return { ...result, recompute: await safeRecompute() };
    },
  },
  {
    method: "POST",
    path: "/api/jobs/:recordId/prep-doc",
    handler: async ({ params }) => {
      const job = await getRecord("main", params.recordId);
      if (job.prepDocUrl) throw new HttpError(409, `已有准备文档：${job.prepDocUrl}`);
      const doc = await createPrepDoc({
        title: `${job.company || "未命名"}-${job.position || "岗位"} 面试准备`,
        content: `# ${job.company} ${job.position}\n\n## JD\n${job.jd || ""}\n\n## 面试复盘\n`,
      });
      // 文档已经建出来了，回填失败也要把链接给出去，否则文档就找不回来了
      const writeBack = await updateRecord("main", params.recordId, { prepDocUrl: doc.url })
        .then(() => null)
        .catch((error) => error.message);
      return { ...doc, writeBackError: writeBack };
    },
  },
];
