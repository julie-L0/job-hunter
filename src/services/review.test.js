import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRANSCRIPT_CHARS,
  buildAppendContent,
  buildReviewDocContent,
  buildReviewTitle,
  fillMissingRoles,
  formatTimestamp,
  guessRoles,
  normalizeSegments,
  segmentsToTranscript,
  validateReviewInput,
} from "./review.js";

test("normalizeSegments sorts, drops empties, and merges short fragments backwards", () => {
  const { segments, truncated } = normalizeSegments([
    { start: 10, end: 20, text: "  第二段说了很长一段话  " },
    { start: 0, end: 6, text: "第一段" },
    { start: 6, end: 7, text: "嗯" },
    { start: 30, end: 40, text: "   " },
    { start: 21, end: 21.5, text: "对" },
  ]);

  assert.equal(truncated, false);
  // 「嗯」只有 1 秒，合并进第一段末尾；「对」合并进第二段。空白段整条丢掉。
  assert.deepEqual(segments, [
    { start: 0, end: 7, text: "第一段嗯" },
    { start: 10, end: 21.5, text: "第二段说了很长一段话对" },
  ]);
});

test("normalizeSegments keeps a leading fragment instead of dropping it", () => {
  // 第一段没有「上一段」可合并，不能因为短就丢掉，否则开场问候会消失
  const { segments } = normalizeSegments([{ start: 0, end: 0.5, text: "你好" }]);
  assert.deepEqual(segments, [{ start: 0, end: 0.5, text: "你好" }]);
});

test("normalizeSegments truncates past the transcript cap and reports it", () => {
  const chunk = "字".repeat(20_000);
  const raw = [0, 1, 2, 3].map((index) => ({
    start: index * 100,
    end: index * 100 + 90,
    text: chunk,
  }));

  const { segments, truncated } = normalizeSegments(raw);
  assert.equal(truncated, true);
  assert.equal(segments.length, 3);
  assert.equal(segments.reduce((sum, item) => sum + item.text.length, 0), MAX_TRANSCRIPT_CHARS);
});

test("normalizeSegments preserves roles already set by the user", () => {
  const { segments } = normalizeSegments([{ start: 0, end: 5, text: "自我介绍一下", role: "面试官" }]);
  assert.equal(segments[0].role, "面试官");
});

test("normalizeSegments tolerates non-array and malformed input", () => {
  assert.deepEqual(normalizeSegments(null), { segments: [], truncated: false });
  const { segments } = normalizeSegments([{ start: "x", end: null, text: "有内容" }]);
  assert.deepEqual(segments, [{ start: 0, end: 0, text: "有内容" }]);
});

test("guessRoles marks short questions as the interviewer and long answers as me", () => {
  const roles = guessRoles([
    { text: "介绍一下你的项目" },
    { text: "我在字节做内容运营，负责活动策划和效果复盘，具体做的事情是先定目标再拆指标，然后跟研发排期" },
    { text: "北极星指标是怎么定的？" },
    { text: "当时我们看的是人均观看时长，因为这个指标最能反映内容生态的健康度，也和商业化目标一致" },
  ]);
  assert.deepEqual(roles.map((item) => item.role), ["面试官", "我", "面试官", "我"]);
});

test("guessRoles does not mistake a rhetorical question inside a long answer", () => {
  const long = `我当时反问了自己一句，这个功能到底解决了谁的问题？${"然后我把用户访谈重新过了一遍。".repeat(6)}`;
  const roles = guessRoles([{ text: long }, { text: "好的" }]);
  assert.equal(roles[0].role, "我");
});

test("fillMissingRoles only fills blanks and never overwrites what the user set", () => {
  const segments = [
    { text: "介绍一下你的项目", role: "我" },
    { text: "我在字节做内容运营，负责活动策划和效果复盘，具体做的事情是先定目标再拆指标，然后跟研发排期" },
    { text: "北极星指标是怎么定的？" },
  ];

  const filled = fillMissingRoles(segments);
  // 第一段规则会猜成「面试官」，但用户已经改成了「我」，不能被抹掉
  assert.deepEqual(filled.map((item) => item.role), ["我", "我", "面试官"]);
  assert.equal(filled[0], segments[0]);
});

test("fillMissingRoles returns the same list when every segment already has a role", () => {
  const segments = [{ text: "短", role: "我" }, { text: "也短", role: "面试官" }];
  assert.equal(fillMissingRoles(segments), segments);
  assert.deepEqual(fillMissingRoles(null), []);
});

test("formatTimestamp pads to hh:mm:ss and floors invalid values to zero", () => {
  assert.equal(formatTimestamp(192), "00:03:12");
  assert.equal(formatTimestamp(3661.9), "01:01:01");
  assert.equal(formatTimestamp(-5), "00:00:00");
  assert.equal(formatTimestamp("abc"), "00:00:00");
});

test("segmentsToTranscript renders one timestamped line per segment", () => {
  assert.equal(
    segmentsToTranscript([
      { start: 192, text: "自我介绍一下", role: "面试官" },
      { start: 200, text: "我是……" },
    ]),
    "[00:03:12] 面试官：自我介绍一下\n[00:03:20] 我：我是……",
  );
});

test("buildReviewDocContent keeps section order and skips empty sections", () => {
  const lines = buildReviewDocContent({
    job: { company: "字节跳动", position: "产品运营" },
    round: "一面",
    interviewedAt: Date.parse("2026-09-02T09:00:00"),
    segments: [{ start: 0, end: 8, text: "自我介绍一下", role: "面试官" }],
    myNote: "  被追问指标时慌了  ",
    comment: {
      highlights: ["项目背景讲得完整"],
      problems: [{ point: "指标口径说不清", evidence: "北极星指标就是活跃", fix: "先说定义再说结果" }],
      answerRewrites: [{ question: "介绍一下项目", betterAnswer: "背景-动作-结果" }],
      nextActions: ["把指标定义写成一句话"],
      takeaway: "指标口径要能一句话讲清",
    },
  });

  assert.equal(lines[0], "# 字节跳动 产品运营 一面 复盘");
  assert.ok(lines.includes("面试时间：2026-09-02"));
  const order = ["## 逐字记录", "## 我的补充", "## AI 点评"].map((title) => lines.indexOf(title));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(lines.includes("被追问指标时慌了"));
  assert.ok(lines.includes("### 亮点"));
  assert.ok(lines.includes("  原话：北极星指标就是活跃"));
});

test("buildReviewDocContent omits sections that have no content", () => {
  const lines = buildReviewDocContent({
    job: { company: "腾讯", position: "产品经理" },
    round: "笔试",
    segments: [],
    myNote: "   ",
    comment: null,
  });
  assert.ok(!lines.includes("## 逐字记录"));
  assert.ok(!lines.includes("## 我的补充"));
  assert.ok(!lines.includes("## AI 点评"));
  assert.ok(lines.includes("面试时间：未填"));
});

test("buildAppendContent writes only the parts that exist", () => {
  const lines = buildAppendContent({
    myNote: "事后想到更好的答案",
    comment: null,
    appendedAt: Date.parse("2026-09-05T10:00:00"),
  });
  assert.equal(lines[0], "## 补充 · 2026-09-05");
  assert.ok(lines.includes("事后想到更好的答案"));
  assert.ok(!lines.includes("### 重新点评"));

  const withComment = buildAppendContent({ myNote: "", comment: { takeaway: "别再背稿" } });
  assert.ok(withComment.includes("### 重新点评"));
});

test("validateReviewInput rejects missing job, bad round, and bad source", () => {
  assert.throws(() => validateReviewInput({ round: "一面", source: "粘贴文本" }), /缺少参数：jobRecordId/);
  assert.throws(
    () => validateReviewInput({ jobRecordId: "job-1", round: "四面", source: "粘贴文本" }),
    /面试轮次非法/,
  );
  assert.throws(
    () => validateReviewInput({ jobRecordId: "job-1", round: "一面", source: "自己编的" }),
    /内容来源非法/,
  );
  assert.deepEqual(
    validateReviewInput({ jobRecordId: " job-1 ", round: "一面", source: "本地转写" }),
    { jobRecordId: "job-1", round: "一面", source: "本地转写" },
  );
});

test("buildReviewTitle matches the schema example", () => {
  assert.equal(
    buildReviewTitle({
      company: "字节跳动",
      position: "产品运营",
      round: "一面",
      interviewedAt: Date.parse("2026-09-02T09:00:00"),
    }),
    "字节跳动-产品运营 一面 2026-09-02",
  );
});
