// 复盘的纯函数层：分段规整、角色预标、文档正文拼装、入参校验。
// 全部同步纯函数，不碰飞书也不碰 AI——所以能被完整单测覆盖，也是这个功能里最该测的部分。
import { HttpError } from "../http/app.js";
import { INTERVIEW_ROUNDS, REVIEW_SOURCES } from "../storage/schema.js";

// 单场面试的正文上限。超了就截断：转写 6 万字已经是 4 小时的量，
// 再往上送进 LLM 只会撞 token 上限，还不如明确告诉用户被截了。
const MAX_TRANSCRIPT_CHARS = 60_000;
// VAD 切出来的碎片下限。小于这个时长的段基本是「嗯」「对」这类语气词，单独成行只会让列表没法读。
const MIN_SEGMENT_SEC = 1.5;

const INTERVIEWER_PREFIXES = [
  "能不能", "能否", "可以", "为什么", "为何", "你觉得", "你认为", "你如何", "你怎么",
  "介绍一下", "介绍下", "讲一下", "讲讲", "说一下", "说说", "聊聊", "请", "那你", "如果",
  "有没有", "怎么", "如何", "什么", "是不是",
];

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * 规整 Python 侧送来的分段：丢空段、按时间排序、合并过短碎片、超长截断。
 * 返回 { segments, truncated }——truncated 要一路传到前端，用户有权知道内容不全。
 */
export function normalizeSegments(raw) {
  const sorted = (Array.isArray(raw) ? raw : [])
    .map((item) => ({
      start: num(item?.start),
      end: num(item?.end),
      text: String(item?.text ?? "").trim(),
      ...(item?.role ? { role: item.role } : {}),
    }))
    .filter((item) => item.text)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    // 只往前合并，不往后看：碎片挂到上一段末尾，语序才是对的。
    if (previous && segment.end - segment.start < MIN_SEGMENT_SEC) {
      previous.end = Math.max(previous.end, segment.end);
      previous.text = `${previous.text}${segment.text}`;
      continue;
    }
    merged.push({ ...segment });
  }

  let total = 0;
  let truncated = false;
  const segments = [];
  for (const segment of merged) {
    if (total + segment.text.length > MAX_TRANSCRIPT_CHARS) {
      truncated = true;
      break;
    }
    total += segment.text.length;
    segments.push(segment);
  }

  return { segments, truncated };
}

/**
 * 确定性规则预标角色，不调 AI（PRD 原则 2：能用脚本做的不花 token）。
 * sherpa-onnx 没有说话人分离，这里只求「大部分对、剩下用户一键改」，不追求准确率。
 */
export function guessRoles(segments) {
  const list = Array.isArray(segments) ? segments : [];
  const lengths = list.map((segment) => String(segment?.text ?? "").length);
  const average = lengths.length ? lengths.reduce((sum, n) => sum + n, 0) / lengths.length : 0;

  return list.map((segment) => {
    const text = String(segment?.text ?? "").trim();
    const asksQuestion = /[?？]\s*$/.test(text) || INTERVIEWER_PREFIXES.some((word) => text.startsWith(word));
    // 面试官说话通常比候选人短。只满足其中一条就判面试官会把长篇自述里的反问也误标。
    const role = asksQuestion && text.length < average ? "面试官" : "我";
    return { ...segment, role };
  });
}

/**
 * 只给没标角色的段补规则预标，已经标了的一律不动。
 *
 * 不能用「全都有角色才保留、否则整体重标」——粘贴的纯文本大多没有 `面试官：` 前缀，
 * 用户手改了其中几段之后仍有空的，整体重标会把他刚改的那几段一起抹掉。
 */
export function fillMissingRoles(segments) {
  const list = Array.isArray(segments) ? segments : [];
  if (list.every((segment) => segment?.role)) return list;
  // 均值按全部段算，已标的段也要参与，否则长度基准会偏
  const guessed = guessRoles(list);
  return list.map((segment, index) => (segment?.role ? segment : guessed[index]));
}

/** 秒 → 00:03:12。负数和非法值一律归零，时间戳不该成为报错来源。 */
export function formatTimestamp(sec) {
  const total = Math.max(0, Math.floor(num(sec)));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}

export function segmentsToTranscript(segments) {
  return (Array.isArray(segments) ? segments : [])
    .map((segment) => `[${formatTimestamp(segment?.start)}] ${segment?.role || "我"}：${String(segment?.text ?? "").trim()}`)
    .join("\n");
}

function commentLines(comment) {
  if (!comment || typeof comment !== "object") return [];
  const lines = [];
  const push = (title, items) => {
    if (!items?.length) return;
    lines.push(title, ...items, "");
  };

  push("### 亮点", (comment.highlights || []).map((item) => `- ${item}`));
  push(
    "### 问题",
    (comment.problems || []).flatMap((item) => [
      `- ${item?.point ?? ""}`,
      `  原话：${item?.evidence ?? ""}`,
      `  怎么改：${item?.fix ?? ""}`,
    ]),
  );
  push(
    "### 更好的回答",
    (comment.answerRewrites || []).flatMap((item) => [
      `- Q：${item?.question ?? ""}`,
      `  A：${item?.betterAnswer ?? ""}`,
    ]),
  );
  push("### 下一步", (comment.nextActions || []).map((item) => `- ${item}`));
  if (comment.takeaway) lines.push(`### 一句话结论`, String(comment.takeaway), "");
  return lines;
}

/**
 * 拼复盘文档正文。返回纯文本行数组——appendDocText 只支持纯文本段落，
 * 所以标题只能是 `## ` 开头的文本行，和现有准备文档保持一致。
 */
export function buildReviewDocContent({ job, round, interviewedAt, segments, myNote, comment } = {}) {
  const company = job?.company || "";
  const position = job?.position || "";
  const day = interviewedAt ? formatDay(interviewedAt) : "";
  const lines = [
    `# ${company} ${position} ${round || ""} 复盘`.replace(/\s+/g, " ").trim(),
    "",
    `岗位：${company} ${position}`.trim(),
    `轮次：${round || "未填"}`,
    `面试时间：${day || "未填"}`,
    "",
  ];

  const transcript = segmentsToTranscript(segments);
  if (transcript) lines.push("## 逐字记录", transcript, "");
  if (String(myNote ?? "").trim()) lines.push("## 我的补充", String(myNote).trim(), "");

  const commentBlock = commentLines(comment);
  if (commentBlock.length) lines.push("## AI 点评", ...commentBlock);

  return lines;
}

/** 追加写用的正文片段，只含有内容的部分，不重复写标题元信息。 */
export function buildAppendContent({ myNote, comment, appendedAt = Date.now() } = {}) {
  const lines = [`## 补充 · ${formatDay(appendedAt)}`, ""];
  if (String(myNote ?? "").trim()) lines.push(String(myNote).trim(), "");
  const commentBlock = commentLines(comment);
  if (commentBlock.length) lines.push("### 重新点评", ...commentBlock);
  return lines;
}

function formatDay(value) {
  const date = new Date(typeof value === "number" ? value : String(value));
  if (Number.isNaN(date.getTime())) return String(value ?? "");
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 入参校验放在 service/API 层，不依赖前端。
 * round / source 是 text 字段，飞书不会帮我们拦非法值，这里是唯一防线。
 */
export function validateReviewInput(body = {}) {
  const jobRecordId = String(body.jobRecordId ?? "").trim();
  if (!jobRecordId) throw new HttpError(400, "缺少参数：jobRecordId");

  const round = String(body.round ?? "").trim();
  if (!INTERVIEW_ROUNDS.includes(round)) {
    throw new HttpError(400, `面试轮次非法：${round || "空"}（可选：${INTERVIEW_ROUNDS.join("/")}）`);
  }

  const source = String(body.source ?? "").trim();
  if (!REVIEW_SOURCES.includes(source)) {
    throw new HttpError(400, `内容来源非法：${source || "空"}（可选：${REVIEW_SOURCES.join("/")}）`);
  }

  return { jobRecordId, round, source };
}

export function buildReviewTitle({ company, position, round, interviewedAt }) {
  const day = interviewedAt ? formatDay(interviewedAt) : formatDay(Date.now());
  return `${company || ""}-${position || ""} ${round || ""} ${day}`.trim();
}

export { MAX_TRANSCRIPT_CHARS, MIN_SEGMENT_SEC, formatDay };
