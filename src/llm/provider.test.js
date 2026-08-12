import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { chatJson } from "./provider.js";

function response(content, finishReason = "stop") {
  return new Response(JSON.stringify({
    code: 0,
    choices: [{ finish_reason: finishReason, message: { role: "assistant", content } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("chatJson retries once when the first JSON response is truncated", async () => {
  const originalFetch = globalThis.fetch;
  const originalLlm = { ...config.llm };
  let calls = 0;

  Object.assign(config.llm, {
    apiKey: "test-key",
    baseUrl: "https://llm.test",
    model: "test-model",
    mock: false,
  });
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1
      ? response('{ "summary": "被截断"', "length")
      : response('{ "summary": "ok" }');
  };

  try {
    const result = await chatJson({
      messages: [{ role: "user", content: "输出 JSON" }],
      maxTokens: 8192,
      retryInstruction: "重新输出合法 JSON",
    });
    assert.equal(calls, 2);
    assert.deepEqual(result, { summary: "ok" });
  } finally {
    globalThis.fetch = originalFetch;
    Object.assign(config.llm, originalLlm);
  }
});
