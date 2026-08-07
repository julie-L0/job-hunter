import { HttpError } from "../http/app.js";
import { getRecord, listRecords } from "../storage/bitable.js";

export function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export async function listCompanies() {
  return listRecords("company");
}

export async function getCompany(recordId) {
  try {
    return await getRecord("company", recordId);
  } catch (error) {
    if (error?.code === 1254043) throw new HttpError(404, "公司不存在");
    throw error;
  }
}

export async function assertCompanyNameAvailable(name, excludeRecordId = null) {
  const normalized = normalizeCompanyName(name);
  if (!normalized) throw new HttpError(400, "公司名要填");
  const duplicate = (await listCompanies()).find(
    (company) => company.recordId !== excludeRecordId && normalizeCompanyName(company.name) === normalized,
  );
  if (duplicate) throw new HttpError(409, `公司「${duplicate.name}」已经在公司库里`);
}

export function hydrateJob(job, company) {
  if (!company || company.recordId !== String(job.companyId || "")) {
    throw new HttpError(409, `岗位「${job.company || "未命名公司"} · ${job.position}」缺少有效公司关联`);
  }
  return {
    ...job,
    company: company.name,
    siteUrl: company.siteUrl || "",
    companyBackground: company.companyBackground || "",
    companyNote: company.note || "",
  };
}

export async function listJobs() {
  const [companies, jobs] = await Promise.all([listCompanies(), listRecords("main")]);
  const companiesById = new Map(companies.map((company) => [company.recordId, company]));
  return jobs
    .filter((job) => String(job.position || "").trim())
    .map((job) => hydrateJob(job, companiesById.get(String(job.companyId || ""))));
}

export async function getJob(recordId) {
  let job;
  try {
    job = await getRecord("main", recordId);
  } catch (error) {
    if (error?.code === 1254043) throw new HttpError(404, "岗位不存在");
    throw error;
  }
  if (!String(job.position || "").trim()) throw new HttpError(404, "岗位不存在");
  const company = await getCompany(job.companyId);
  return hydrateJob(job, company);
}
