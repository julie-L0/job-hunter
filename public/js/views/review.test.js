import test from "node:test";
import assert from "node:assert/strict";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

globalThis.localStorage = memoryStorage();
globalThis.sessionStorage = memoryStorage();
globalThis.location = { hash: "" };
globalThis.window = {
  Vue: {
    reactive: (value) => value,
    ref: (value) => ({ value }),
    computed: (getter) => ({ get value() { return getter(); } }),
    watch: () => {},
    onUnmounted: () => {},
  },
  addEventListener: () => {},
};

const { parsePastedTranscript, segmentsToDoc } = await import(`./review.js?test=${Date.now()}`);

test("segmentsToDoc merges adjacent same-role fragments into document turns", () => {
  assert.equal(
    segmentsToDoc([
      { start: 0, end: 4, role: "面试官", text: "介绍一下你的项目。" },
      { start: 6, end: 9, role: "面试官", text: "重点说结果" },
      { start: 26, end: 40, role: "我", text: "我负责活动策略和复盘。" },
    ]),
    "[00:00:00] 面试官：介绍一下你的项目。重点说结果\n[00:00:26] 我：我负责活动策略和复盘。",
  );
});

test("parsePastedTranscript recognizes the other candidate role", () => {
  const segments = parsePastedTranscript("[00:08:10] 其他面试者：我补充一个问题");
  assert.equal(segments.length, 1);
  assert.equal(segments[0].start, 490);
  assert.equal(segments[0].role, "其他面试者");
  assert.equal(segments[0].text, "我补充一个问题");
});
