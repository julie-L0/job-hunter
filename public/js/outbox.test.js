import test from "node:test";
import assert from "node:assert/strict";
import { ensureRequiredResume, mergeOutboxItem, repairOutboxItems } from "./outbox.js";

const requiresResume = (status) => ["已投", "笔试", "一面", "二面", "三面", "挂", "offer"].includes(status);

test("status patch carries the local resume when required", () => {
  assert.deepEqual(
    ensureRequiredResume({ status: "已投" }, { status: "已投", resumeId: "R2" }, requiresResume),
    { status: "已投", resumeId: "R2" },
  );
});

test("resume patch merges into a blocked status change", () => {
  const items = [{
    id: "status-1",
    kind: "job.patch",
    recordId: "job-1",
    patch: { status: "已投" },
    statusChange: { at: 1, from: "待投", to: "已投", resumeId: "" },
    blocked: true,
    error: "缺简历",
  }];

  const merged = mergeOutboxItem(items, {
    id: "resume-1",
    kind: "job.patch",
    recordId: "job-1",
    patch: { resumeId: "R1" },
    statusChange: null,
    updatedAt: 2,
  }, requiresResume);

  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].patch, { status: "已投", resumeId: "R1" });
  assert.equal(merged[0].statusChange.resumeId, "R1");
  assert.equal(merged[0].blocked, false);
});

test("repair copies a later resume patch into an earlier required status patch", () => {
  const result = repairOutboxItems([
    { id: "status-1", kind: "job.patch", recordId: "job-1", patch: { status: "已投" }, statusChange: { to: "已投" } },
    { id: "resume-1", kind: "job.patch", recordId: "job-1", patch: { resumeId: "R3" } },
  ], [{ recordId: "job-1", company: "示例公司", position: "产品经理" }], requiresResume);

  assert.equal(result.blockedCount, 0);
  assert.equal(result.items[0].patch.resumeId, "R3");
  assert.equal(result.items[0].statusChange.resumeId, "R3");
});

test("repair reports the exact job when a required resume is missing", () => {
  const result = repairOutboxItems([
    { id: "status-1", kind: "job.patch", recordId: "job-1", patch: { status: "已投" } },
  ], [{ recordId: "job-1", company: "示例公司", position: "产品经理" }], requiresResume);

  assert.equal(result.blockedCount, 1);
  assert.match(result.firstBlockedError, /示例公司 · 产品经理/);
  assert.match(result.firstBlockedError, /必须选择简历/);
});
