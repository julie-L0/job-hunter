import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { jobRoutes } from "./jobs.js";
import { JOB_STAR_VALUE, fromRecord, toFields } from "../storage/schema.js";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("job star field serializes as a nullable select", () => {
  assert.deepEqual(toFields("main", { starred: JOB_STAR_VALUE }), { "星标": JOB_STAR_VALUE });
  assert.deepEqual(toFields("main", { starred: "" }), { "星标": null });
  assert.equal(
    fromRecord("main", { record_id: "job-star", fields: { "星标": [JOB_STAR_VALUE] } }).starred,
    JOB_STAR_VALUE,
  );
});

test("selecting a resume keeps the job company when Lark returns only updated fields", async () => {
  const originalFetch = globalThis.fetch;
  const originalLark = {
    ...config.lark,
    tables: { ...config.lark.tables },
  };
  const jobRecord = {
    record_id: "job-1",
    fields: {
      "公司名": "旧公司名",
      "公司ID": "company-1",
      "岗位名": "产品经理",
      JD: "岗位描述",
      "状态": "待投",
    },
  };
  const resumeRecord = {
    record_id: "resume-1",
    fields: { "编号": "R1", "投递记录": "" },
  };

  Object.assign(config.lark, {
    appId: "app-id",
    appSecret: "app-secret",
    apiBase: "https://lark.test/open-apis",
    baseToken: "base-token",
    mock: false,
  });
  Object.assign(config.lark.tables, {
    company: "company-table",
    main: "main-table",
    resume: "resume-table",
  });

  globalThis.fetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "token", expire: 7200 });
    }
    if (pathname.endsWith("/tables/main-table/records/job-1") && options.method === "GET") {
      return jsonResponse({ code: 0, data: { record: jobRecord } });
    }
    if (pathname.endsWith("/tables/resume-table/records/search") && options.method === "POST") {
      return jsonResponse({ code: 0, data: { items: [resumeRecord], has_more: false } });
    }
    if (pathname.endsWith("/tables/company-table/records/company-1")) {
      return jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "company-1",
            fields: { "公司名": "示例公司" },
          },
        },
      });
    }
    if (pathname.endsWith("/tables/main-table/records/job-1") && options.method === "PUT") {
      return jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "job-1",
            fields: { "简历编号": "R1" },
          },
        },
      });
    }
    if (pathname.endsWith("/tables/main-table/records/search") && options.method === "POST") {
      return jsonResponse({
        code: 0,
        data: {
          items: [{
            ...jobRecord,
            fields: { ...jobRecord.fields, "简历编号": "R1" },
          }],
          has_more: false,
        },
      });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };

  try {
    const route = jobRoutes.find(
      (candidate) => candidate.method === "PATCH" && candidate.path === "/api/jobs/:recordId",
    );
    const result = await route.handler({
      params: { recordId: "job-1" },
      body: { resumeId: "R1" },
    });

    assert.equal(result.job.recordId, "job-1");
    assert.equal(result.job.companyId, "company-1");
    assert.equal(result.job.company, "示例公司");
    assert.equal(result.job.position, "产品经理");
    assert.equal(result.job.resumeId, "R1");
    assert.equal(result.warning, null);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config.lark, originalLark);
    config.lark.tables = originalLark.tables;
  }
});

test("changing job status appends a structured status history entry", async () => {
  const originalFetch = globalThis.fetch;
  const originalLark = {
    ...config.lark,
    tables: { ...config.lark.tables },
  };
  const changedAt = 1786600000000;
  const jobRecord = {
    record_id: "job-history",
    fields: {
      "公司名": "旧公司名",
      "公司ID": "company-1",
      "岗位名": "产品经理",
      JD: "岗位描述",
      "状态": "待投",
      "状态记录": "",
    },
  };
  const resumeRecord = {
    record_id: "resume-1",
    fields: { "编号": "R1", "投递记录": "" },
  };
  let updatedFields = null;

  Object.assign(config.lark, {
    appId: "app-id",
    appSecret: "app-secret",
    apiBase: "https://lark.test/open-apis",
    baseToken: "base-token",
    mock: false,
  });
  Object.assign(config.lark.tables, {
    company: "company-table",
    main: "main-table",
    resume: "resume-table",
  });

  globalThis.fetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "token", expire: 7200 });
    }
    if (pathname.endsWith("/tables/main-table/records/job-history") && options.method === "GET") {
      return jsonResponse({ code: 0, data: { record: jobRecord } });
    }
    if (pathname.endsWith("/tables/resume-table/records/search") && options.method === "POST") {
      return jsonResponse({ code: 0, data: { items: [resumeRecord], has_more: false } });
    }
    if (pathname.endsWith("/tables/company-table/records/company-1")) {
      return jsonResponse({
        code: 0,
        data: { record: { record_id: "company-1", fields: { "公司名": "示例公司" } } },
      });
    }
    if (pathname.endsWith("/tables/main-table/records/job-history") && options.method === "PUT") {
      updatedFields = JSON.parse(options.body).fields;
      return jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "job-history",
            fields: {
              "状态": "已投",
              "简历编号": "R1",
              "状态记录": updatedFields["状态记录"],
            },
          },
        },
      });
    }
    if (pathname.endsWith("/tables/main-table/records/search") && options.method === "POST") {
      return jsonResponse({
        code: 0,
        data: {
          items: [{
            ...jobRecord,
            fields: { ...jobRecord.fields, "状态": "已投", "简历编号": "R1" },
          }],
          has_more: false,
        },
      });
    }
    if (pathname.endsWith("/tables/resume-table/records/batch_update") && options.method === "POST") {
      return jsonResponse({ code: 0, data: { records: [] } });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };

  try {
    const route = jobRoutes.find(
      (candidate) => candidate.method === "PATCH" && candidate.path === "/api/jobs/:recordId",
    );
    const result = await route.handler({
      params: { recordId: "job-history" },
      body: { status: "已投", resumeId: "R1", statusChangedAt: changedAt },
    });

    const history = JSON.parse(updatedFields["状态记录"]);
    assert.deepEqual(history, [{ at: changedAt, from: "待投", to: "已投", resumeId: "R1" }]);
    assert.equal(result.job.status, "已投");
    assert.equal(result.job.statusHistory, updatedFields["状态记录"]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config.lark, originalLark);
    config.lark.tables = originalLark.tables;
  }
});

test("changing job status back removes the latest inverse status history entry", async () => {
  const originalFetch = globalThis.fetch;
  const originalLark = {
    ...config.lark,
    tables: { ...config.lark.tables },
  };
  const keptEntry = { at: 1786500000000, from: "待投", to: "已投", resumeId: "R1" };
  const removedEntry = { at: 1786600000000, from: "已投", to: "笔试", resumeId: "R1" };
  const jobRecord = {
    record_id: "job-history-rollback",
    fields: {
      "公司名": "旧公司名",
      "公司ID": "company-1",
      "岗位名": "产品经理",
      JD: "岗位描述",
      "状态": "笔试",
      "简历编号": "R1",
      "状态记录": JSON.stringify([keptEntry, removedEntry]),
    },
  };
  const resumeRecord = {
    record_id: "resume-1",
    fields: { "编号": "R1", "投递记录": "" },
  };
  let updatedFields = null;

  Object.assign(config.lark, {
    appId: "app-id",
    appSecret: "app-secret",
    apiBase: "https://lark.test/open-apis",
    baseToken: "base-token",
    mock: false,
  });
  Object.assign(config.lark.tables, {
    company: "company-table",
    main: "main-table",
    resume: "resume-table",
  });

  globalThis.fetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "token", expire: 7200 });
    }
    if (pathname.endsWith("/tables/main-table/records/job-history-rollback") && options.method === "GET") {
      return jsonResponse({ code: 0, data: { record: jobRecord } });
    }
    if (pathname.endsWith("/tables/resume-table/records/search") && options.method === "POST") {
      return jsonResponse({ code: 0, data: { items: [resumeRecord], has_more: false } });
    }
    if (pathname.endsWith("/tables/company-table/records/company-1")) {
      return jsonResponse({
        code: 0,
        data: { record: { record_id: "company-1", fields: { "公司名": "示例公司" } } },
      });
    }
    if (pathname.endsWith("/tables/main-table/records/job-history-rollback") && options.method === "PUT") {
      updatedFields = JSON.parse(options.body).fields;
      return jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "job-history-rollback",
            fields: {
              "状态": "已投",
              "简历编号": "R1",
              "状态记录": updatedFields["状态记录"],
            },
          },
        },
      });
    }
    if (pathname.endsWith("/tables/main-table/records/search") && options.method === "POST") {
      return jsonResponse({
        code: 0,
        data: {
          items: [{
            ...jobRecord,
            fields: { ...jobRecord.fields, "状态": "已投", "状态记录": updatedFields?.["状态记录"] || "" },
          }],
          has_more: false,
        },
      });
    }
    if (pathname.endsWith("/tables/resume-table/records/batch_update") && options.method === "POST") {
      return jsonResponse({ code: 0, data: { records: [] } });
    }
    throw new Error(`Unexpected request: ${options.method} ${url}`);
  };

  try {
    const route = jobRoutes.find(
      (candidate) => candidate.method === "PATCH" && candidate.path === "/api/jobs/:recordId",
    );
    const result = await route.handler({
      params: { recordId: "job-history-rollback" },
      body: { status: "已投", resumeId: "R1", statusChangedAt: 1786700000000 },
    });

    assert.deepEqual(JSON.parse(updatedFields["状态记录"]), [keptEntry]);
    assert.equal(result.job.status, "已投");
    assert.equal(result.job.statusHistory, updatedFields["状态记录"]);
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config.lark, originalLark);
    config.lark.tables = originalLark.tables;
  }
});
