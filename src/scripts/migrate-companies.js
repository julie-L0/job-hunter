import { pathToFileURL } from "node:url";
import { config } from "../config.js";
import {
  batchCreateRecords,
  batchUpdateRecords,
  listRecords,
} from "../storage/bitable.js";
import { normalizeCompanyName } from "../services/companies.js";

const COMPANY_FIELDS = ["siteUrl", "companyBackground", "note"];

function nonemptyValues(records, key) {
  return [...new Set(records.map((record) => String(record[key] || "").trim()).filter(Boolean))];
}

export function analyzeCompanyMigration(records, existingCompanies = []) {
  const blankCompanyRecords = records
    .filter((record) => !normalizeCompanyName(record.company))
    .map((record) => ({ recordId: record.recordId, position: record.position || "" }));
  const groupsByName = new Map();

  for (const record of records) {
    const normalizedName = normalizeCompanyName(record.company);
    if (!normalizedName) continue;
    if (!groupsByName.has(normalizedName)) groupsByName.set(normalizedName, []);
    groupsByName.get(normalizedName).push(record);
  }

  const companiesByName = new Map();
  for (const company of existingCompanies) {
    const normalizedName = normalizeCompanyName(company.name);
    if (!companiesByName.has(normalizedName)) companiesByName.set(normalizedName, []);
    companiesByName.get(normalizedName).push(company);
  }

  const blockingConflicts = [];
  const groups = [...groupsByName.entries()].map(([normalizedName, groupedRecords]) => {
    const existing = companiesByName.get(normalizedName) || [];
    const nameVariants = [...new Set(groupedRecords.map((record) => String(record.company).trim()))];
    const fieldValues = Object.fromEntries(
      COMPANY_FIELDS.map((field) => [field, nonemptyValues(groupedRecords, field)]),
    );
    const fieldConflicts = Object.fromEntries(
      Object.entries(fieldValues).filter(([, values]) => values.length > 1),
    );
    if (existing.length > 1) {
      blockingConflicts.push({ type: "duplicate-company-records", normalizedName, recordIds: existing.map((item) => item.recordId) });
    }
    if (!existing.length && Object.keys(fieldConflicts).length) {
      blockingConflicts.push({ type: "company-field-conflict", normalizedName, fields: fieldConflicts });
    }

    const jobs = groupedRecords.filter((record) => String(record.position || "").trim());
    const pseudoCompanies = groupedRecords.filter((record) => !String(record.position || "").trim());
    const targetCompanyId = existing.length === 1 ? existing[0].recordId : null;
    const displayName = nameVariants[0];
    return {
      normalizedName,
      displayName,
      nameVariants,
      fieldValues,
      fieldConflicts,
      existingCompanyIds: existing.map((item) => item.recordId),
      targetCompanyId,
      jobRecordIds: jobs.map((job) => job.recordId),
      pseudoCompanyRecordIds: pseudoCompanies.map((item) => item.recordId),
      jobUpdates: jobs.filter((job) => !targetCompanyId || job.companyId !== targetCompanyId).length,
      createPatch: existing.length ? null : {
        name: displayName,
        siteUrl: fieldValues.siteUrl[0] || "",
        companyBackground: fieldValues.companyBackground[0] || "",
        note: fieldValues.note[0] || "",
      },
    };
  });

  if (blankCompanyRecords.length) {
    blockingConflicts.push({ type: "blank-company-name", records: blankCompanyRecords });
  }

  return {
    counts: {
      records: records.length,
      jobs: records.filter((record) => String(record.position || "").trim()).length,
      pseudoCompanies: records.filter((record) => !String(record.position || "").trim()).length,
      normalizedCompanies: groups.length,
      existingCompanies: existingCompanies.length,
      companiesToCreate: groups.filter((group) => group.createPatch).length,
      jobsToUpdate: groups.reduce((total, group) => total + group.jobUpdates, 0),
    },
    blankCompanyRecords,
    blockingConflicts,
    groups,
  };
}

async function loadState() {
  const records = await listRecords("main");
  const companyTableConfigured = Boolean(config.lark.tables.company) || config.lark.mock;
  const companies = companyTableConfigured ? await listRecords("company") : [];
  return { records, companies, companyTableConfigured };
}

async function applyMigration(initial) {
  if (!initial.companyTableConfigured) {
    throw new Error("缺少 BITABLE_TABLE_COMPANY，不能执行迁移");
  }
  let report = analyzeCompanyMigration(initial.records, initial.companies);
  if (report.blockingConflicts.length) {
    throw new Error("存在阻断冲突，先处理 dry-run 输出后再执行");
  }

  const creates = report.groups.map((group) => group.createPatch).filter(Boolean);
  if (creates.length) await batchCreateRecords("company", creates);

  const companies = await listRecords("company");
  report = analyzeCompanyMigration(initial.records, companies);
  if (report.blockingConflicts.length) throw new Error("创建公司后仍存在冲突，已停止回填岗位");

  const targetByName = new Map(
    report.groups.map((group) => [group.normalizedName, group.targetCompanyId]),
  );
  const updates = initial.records
    .filter((record) => String(record.position || "").trim())
    .map((record) => ({
      recordId: record.recordId,
      companyId: targetByName.get(normalizeCompanyName(record.company)),
    }))
    .filter((update) => update.companyId)
    .filter((update) => initial.records.find((record) => record.recordId === update.recordId)?.companyId !== update.companyId)
    .map(({ recordId, companyId }) => ({ recordId, patch: { companyId } }));
  if (updates.length) await batchUpdateRecords("main", updates);

  const [finalRecords, finalCompanies] = await Promise.all([
    listRecords("main"),
    listRecords("company"),
  ]);
  const finalReport = analyzeCompanyMigration(finalRecords, finalCompanies);
  if (finalReport.counts.jobsToUpdate) throw new Error("迁移后仍有岗位未关联到正确公司");
  return { createdCompanies: creates.length, updatedJobs: updates.length, report: finalReport };
}

export async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const state = await loadState();
  const report = analyzeCompanyMigration(state.records, state.companies);

  if (!apply) {
    console.log(JSON.stringify({ mode: "dry-run", companyTableConfigured: state.companyTableConfigured, ...report }, null, 2));
    return;
  }

  const result = await applyMigration(state);
  console.log(JSON.stringify({ mode: "apply", ...result }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
