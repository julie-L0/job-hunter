import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { jobRoutes } from "./jobs.js";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

test("patching a job keeps its company when Lark returns only updated fields", async () => {
  const originalFetch = globalThis.fetch;
  const originalLark = {
    ...config.lark,
    tables: { ...config.lark.tables },
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
  });

  globalThis.fetch = async (url, options = {}) => {
    const { pathname } = new URL(url);
    if (pathname.endsWith("/auth/v3/tenant_access_token/internal")) {
      return jsonResponse({ code: 0, tenant_access_token: "token", expire: 7200 });
    }
    if (pathname.endsWith("/tables/main-table/records/job-1") && options.method === "GET") {
      return jsonResponse({
        code: 0,
        data: {
          record: {
            record_id: "job-1",
            fields: {
              "公司名": "旧公司名",
              "公司ID": "company-1",
              "岗位名": "产品经理",
              JD: "岗位描述",
              "状态": "待投",
            },
          },
        },
      });
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
            fields: { "备注": "跟进一面" },
          },
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
      body: { note: "跟进一面" },
    });

    assert.equal(result.job.recordId, "job-1");
    assert.equal(result.job.companyId, "company-1");
    assert.equal(result.job.company, "示例公司");
    assert.equal(result.job.position, "产品经理");
    assert.equal(result.job.note, "跟进一面");
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config.lark, originalLark);
    config.lark.tables = originalLark.tables;
  }
});
