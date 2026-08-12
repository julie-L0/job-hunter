import test from "node:test";
import assert from "node:assert/strict";
import {
  appendInterviewQuestion,
  validateExperienceType,
  validateExperienceTags,
} from "./experiences.js";
import {
  buildExperienceMigrationPatch,
  larkText,
} from "../services/experience-migration.js";

test("experience tags use the supplied Feishu options", () => {
  assert.deepEqual(
    validateExperienceTags(["数据分析", "数据分析", "产品设计"], ["产品设计", "数据分析"]),
    ["数据分析", "产品设计"],
  );
  assert.throws(
    () => validateExperienceTags(["组织协调", "数据分析"], ["数据分析"]),
    /组织协调/,
  );
});

test("experience type uses the schema enum", () => {
  assert.equal(validateExperienceType("项目经历"), "项目经历");
  assert.equal(validateExperienceType(""), "");
  assert.throws(() => validateExperienceType("产品经理"), /经历类型必须是/);
});

test("interview questions are appended to followup records", () => {
  const updated = appendInterviewQuestion("已有追问", {
    question: "最大的取舍是什么？",
    answerDirection: "说明备选方案和约束。",
    source: "Mock 面试 示例公司",
    date: "2026-08-10",
  });

  assert.match(updated, /^已有追问/);
  assert.match(updated, /### 2026-08-10 · Mock 面试 示例公司/);
  assert.match(updated, /Q：最大的取舍是什么？\n\nA：说明备选方案和约束。/);
});

test("experience migration preserves legacy content without overwriting new fields", () => {
  const patch = buildExperienceMigrationPatch({
    "100字版": [{ text: "已有摘要" }],
    STAR全文: [{ text: "完整经历" }],
    "相关链接": "材料 | https://example.com",
    "追问记录": "追问了数据口径",
  });

  assert.equal(patch["经历摘要"], "已有摘要");
  assert.equal(patch["经历正文"], "完整经历");
  assert.equal(patch["相关链接"], undefined);
  assert.equal(patch["追问记录"], undefined);

  assert.deepEqual(buildExperienceMigrationPatch({
    "经历摘要": "新摘要",
    "经历正文": "新正文",
    "100字版": "旧摘要",
    STAR全文: "旧正文",
  }), {});
  assert.equal(larkText([{ text: "第一段" }, { text: "第二段" }]), "第一段第二段");
});
