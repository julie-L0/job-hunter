import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultComparisonPreference,
  normalizeComparisonPreference,
  preferenceForPrompt,
  validateComparisonPreferencePatch,
} from "./preferences.js";

test("comparison preference normalizes stage weights for prompt", () => {
  const preference = normalizeComparisonPreference({
    stage: "兜底",
    valueOrientation: "更看重推进概率",
  });
  assert.equal(preference.stage, "兜底");
  assert.equal(preference.careerWeight, 20);
  assert.equal(preference.practiceWeight, 25);
  assert.equal(preference.fallbackWeight, 55);
  assert.deepEqual(preferenceForPrompt(preference).weights, {
    careerValue: 20,
    practiceValue: 25,
    fallbackValue: 55,
  });
});

test("comparison preference patch validates stage and syncs weights", () => {
  const patch = validateComparisonPreferencePatch({ stage: "冲刺", valueOrientation: "偏 ToB" });
  assert.equal(patch.stage, "冲刺");
  assert.equal(patch.careerWeight, 70);
  assert.equal(patch.practiceWeight, 20);
  assert.equal(patch.fallbackWeight, 10);
  assert.equal(patch.valueOrientation, "偏 ToB");
  assert.throws(() => validateComparisonPreferencePatch({ stage: "目标冲刺" }), /阶段策略/);
});

test("default comparison preference starts with practice stage", () => {
  const preference = defaultComparisonPreference();
  assert.equal(preference.stage, "练手");
  assert.match(preference.valueOrientation, /AI 产品/);
});
