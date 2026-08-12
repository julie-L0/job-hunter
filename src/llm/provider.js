import { config } from "../config.js";

const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 没有可用 key 时也要能把整条链路跑通，否则前端和路由无法联调。
// `mockText` 给那些前端要按固定文本使用返回的场景（如经历摘要草稿）：
// 占位文本不照 prompt 约定的形状出，解析分支就永远走不到，只能花钱验。
function mockCompletion(messages, mockText) {
  if (mockText) return { role: "assistant", content: mockText, mock: true };
  const last = [...messages].reverse().find((m) => m.role === "user");
  return {
    role: "assistant",
    content: [
      "【MOCK 模式】未配置有效的 DEEPSEEK_API_KEY，返回占位内容。",
      "",
      `收到 ${messages.length} 条消息，最后一条用户输入前 200 字：`,
      String(last?.content ?? "").slice(0, 200),
    ].join("\n"),
    mock: true,
  };
}

export function isMock() {
  return config.llm.mock || !config.llm.apiKey;
}

export async function chatCompletion({ messages, temperature = 0.7, responseFormat, mockText, maxTokens }) {
  if (isMock()) return mockCompletion(messages, mockText);

  const url = new URL("/v1/chat/completions", config.llm.baseUrl).toString();
  const body = { model: config.llm.model, messages, temperature };
  if (responseFormat) body.response_format = responseFormat;
  if (maxTokens) body.max_tokens = maxTokens;

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAY_MS);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.llm.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const failure = new Error(`LLM ${response.status}: ${text.slice(0, 200)}`);
        // 4xx 是 key 或参数问题，重试只是白等
        if (response.status < 500) throw Object.assign(failure, { fatal: true });
        lastError = failure;
        if (attempt < MAX_RETRIES) continue;
        throw failure;
      }

      const data = await response.json();
      const choice = data.choices?.[0];
      const message = choice?.message;
      if (!message) throw new Error("LLM 返回结构异常");
      if (message.content) {
        message.content = message.content.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
      }
      return { ...message, finishReason: choice?.finish_reason, usage: data.usage };
    } catch (error) {
      if (error.fatal) throw error;
      lastError = error.name === "AbortError" ? new Error("LLM 请求超时") : error;
      if (attempt >= MAX_RETRIES) break;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    // 有些模型会在 json_object 模式下仍包一层 ```json，先剥掉再试。
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) return JSON.parse(fenced[1].trim());
    // 也容忍前后多余说明文字，但不尝试补全被截断的 JSON。
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("invalid json");
  }
}

/**
 * 要求模型输出 JSON 的场景；解析失败时把原文一起抛出，方便定位 prompt 问题。
 * `mockShape` 是 MOCK 模式下要顶上的结构：占位文本没有 JSON 结构，
 * 不给一份就没法在不花钱的前提下走通拆题、Mock 复盘这些吃结构化返回的页面。
 */
export async function chatJson({ messages, temperature = 0.3, mockShape, maxTokens, retryInstruction }) {
  let lastContent = "";
  let finishReason = "";
  let currentMessages = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await chatCompletion({
      messages: currentMessages,
      temperature: attempt ? Math.min(temperature, 0.1) : temperature,
      responseFormat: { type: "json_object" },
      maxTokens,
    });
    if (message.mock) return { mock: true, raw: message.content, ...(mockShape ?? {}) };
    lastContent = message.content;
    finishReason = message.finishReason || "";
    try {
      return parseJsonContent(message.content);
    } catch {
      if (attempt) break;
      currentMessages = [
        ...messages,
        {
          role: "user",
          content: retryInstruction || [
            "上一条回复不是可解析的完整 JSON。请重新输出完整合法 JSON。",
            "只输出 JSON 对象本身，不要 Markdown，不要解释。",
            "如果内容太长，请压缩文字说明，但必须保留要求的字段和数组结构。",
          ].join("\n"),
        },
      ];
    }
  }
  const hint = finishReason === "length" ? "（疑似输出被截断）" : "";
  throw new Error(`LLM 未返回合法 JSON${hint}：${String(lastContent).slice(0, 300)}`);
}
