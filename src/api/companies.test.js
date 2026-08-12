import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { createRecord } from "../storage/bitable.js";
import { companyRoutes } from "./companies.js";

function route(method, path) {
  return companyRoutes.find((candidate) => candidate.method === method && candidate.path === path);
}

test("company delete only allows companies without linked jobs", async () => {
  const originalMock = config.lark.mock;
  config.lark.mock = true;
  try {
    const emptyCompany = await createRecord("company", { name: "可删除公司" });
    const deleted = await route("DELETE", "/api/companies/:recordId").handler({
      params: { recordId: emptyCompany.recordId },
    });
    assert.deepEqual(deleted, { recordId: emptyCompany.recordId, deleted: true });

    const company = await createRecord("company", { name: "有关联岗位公司" });
    await createRecord("main", {
      company: company.name,
      companyId: company.recordId,
      position: "产品经理",
      jd: "岗位描述",
      status: "待投",
    });
    await assert.rejects(
      () => route("DELETE", "/api/companies/:recordId").handler({ params: { recordId: company.recordId } }),
      /下面还有 1 个岗位/,
    );
  } finally {
    config.lark.mock = originalMock;
  }
});
