import test from "node:test";
import assert from "node:assert/strict";
import {
  applyStatusHistoryChange,
  appendStatusHistory,
  statusHistoryRollsBack,
} from "./status-history.js";

test("status history appends normal forward changes", () => {
  const history = applyStatusHistoryChange("", {
    at: 1,
    from: "已投",
    to: "笔试",
    resumeId: "R1",
  });

  assert.deepEqual(JSON.parse(history), [{ at: 1, from: "已投", to: "笔试", resumeId: "R1" }]);
});

test("status history removes the latest entry when a change is reversed", () => {
  const first = appendStatusHistory("", { at: 1, from: "已投", to: "笔试", resumeId: "R1" });
  assert.equal(statusHistoryRollsBack(first, { from: "笔试", to: "已投" }), true);

  const rolledBack = applyStatusHistoryChange(first, { at: 2, from: "笔试", to: "已投", resumeId: "R1" });

  assert.deepEqual(JSON.parse(rolledBack), []);
});

test("status history keeps non-inverse backward changes as new entries", () => {
  const first = appendStatusHistory("", { at: 1, from: "待投", to: "已投", resumeId: "R1" });
  const changed = applyStatusHistoryChange(first, { at: 2, from: "笔试", to: "已投", resumeId: "R1" });

  assert.deepEqual(JSON.parse(changed), [
    { at: 1, from: "待投", to: "已投", resumeId: "R1" },
    { at: 2, from: "笔试", to: "已投", resumeId: "R1" },
  ]);
});
