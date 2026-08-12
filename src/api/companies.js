import { HttpError, requireBody } from "../http/app.js";
import { createRecord, deleteRecord, listRecords, updateRecord } from "../storage/bitable.js";
import {
  assertCompanyNameAvailable,
  getCompany,
  listCompanies,
} from "../services/companies.js";

const PATCH_FIELDS = new Set(["name", "siteUrl", "companyBackground", "note"]);
let companyWrite = Promise.resolve();

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function pickPatch(body) {
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (PATCH_FIELDS.has(key)) patch[key] = key === "name" ? cleanName(value) : String(value || "").trim();
  }
  if (!Object.keys(patch).length) throw new HttpError(400, "没有可写字段");
  if ("name" in patch && !patch.name) throw new HttpError(400, "公司名要填");
  return patch;
}

function serializeCompanyWrite(work) {
  const current = companyWrite.then(work, work);
  companyWrite = current.catch(() => {});
  return current;
}

export const companyRoutes = [
  {
    method: "GET",
    path: "/api/companies",
    handler: () => listCompanies(),
  },
  {
    method: "GET",
    path: "/api/companies/:recordId",
    handler: ({ params }) => getCompany(params.recordId),
  },
  {
    method: "POST",
    path: "/api/companies",
    handler: ({ body }) => serializeCompanyWrite(async () => {
      requireBody(body, ["name"]);
      const name = cleanName(body.name);
      await assertCompanyNameAvailable(name);
      return createRecord("company", {
        name,
        siteUrl: String(body.siteUrl || "").trim(),
      });
    }),
  },
  {
    method: "PATCH",
    path: "/api/companies/:recordId",
    handler: ({ params, body }) => serializeCompanyWrite(async () => {
      await getCompany(params.recordId);
      const patch = pickPatch(body);
      if ("name" in patch) await assertCompanyNameAvailable(patch.name, params.recordId);
      return updateRecord("company", params.recordId, patch);
    }),
  },
  {
    method: "DELETE",
    path: "/api/companies/:recordId",
    handler: ({ params }) => serializeCompanyWrite(async () => {
      const company = await getCompany(params.recordId);
      const linkedJobs = (await listRecords("main"))
        .filter((job) => String(job.companyId || "") === params.recordId)
        .filter((job) => String(job.position || "").trim());
      if (linkedJobs.length) {
        throw new HttpError(409, `公司「${company.name}」下面还有 ${linkedJobs.length} 个岗位，先删除或迁移岗位后再删公司`);
      }
      return deleteRecord("company", params.recordId);
    }),
  },
];
