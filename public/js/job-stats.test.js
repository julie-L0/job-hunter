import test from "node:test";
import assert from "node:assert/strict";
import { dailyJobStats } from "./job-stats.js";

const now = new Date(2026, 8, 2, 12).getTime();

test("daily stats count new jobs and status transitions", () => {
  const today = new Date(2026, 8, 2, 9).getTime();
  const stats = dailyJobStats([{ createdAt: today, statusHistory: JSON.stringify([
    { at: today, from: "待投", to: "已投" },
    { at: today, from: "已投", to: "笔试" },
    { at: today, from: "笔试", to: "一面" },
  ]) }], now);
  assert.deepEqual(stats, { date: "2026-09-02", newJobs: 1, applied: 1, assessments: 1, interviews: 1 });
});

test("empty history produces no transition counts", () => {
  const today = new Date(2026, 8, 2, 9).getTime();
  const stats = dailyJobStats([{ createdAt: today, statusHistory: "[]" }], now);
  assert.equal(stats.applied + stats.assessments + stats.interviews, 0);
});
