import { config, assertLarkConfig } from "../config.js";

const TIMEOUT_MS = 20_000;

let cachedToken = null;
let cachedExpiry = 0;

export class LarkError extends Error {
  constructor(code, msg, detail, path) {
    super(`飞书 API 错误 ${code}: ${msg}${path ? `（${path}）` : ""}`);
    this.code = code;
    this.detail = detail;
    this.path = path;
  }
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // 出错时要能看出是哪个接口挂的：一次操作可能连着调 docx 建文档、写块、授权三个接口，
  // 只报「invalid param」根本没法定位
  const path = URL.canParse(url) ? new URL(url).pathname.replace("/open-apis", "") : "";
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new LarkError(response.status, "响应不是 JSON", text.slice(0, 300), path);
    }
    if (payload.code !== 0) {
      throw new LarkError(payload.code, payload.msg || "unknown", payload.error, path);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function getTenantAccessToken() {
  assertLarkConfig();
  const now = Date.now();
  if (cachedToken && now < cachedExpiry) return cachedToken;

  const payload = await fetchJson(`${config.lark.apiBase}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: config.lark.appId, app_secret: config.lark.appSecret }),
  });

  cachedToken = payload.tenant_access_token;
  cachedExpiry = now + Math.max(0, (payload.expire || 7200) - 300) * 1000;
  return cachedToken;
}

// token 被飞书提前失效时的错误码。缓存留了 5 分钟余量，但撤销/重置不会通知我们
const TOKEN_ERRORS = new Set([99991661, 99991663, 99991664, 99991665]);
// 1254291 = 并发写同一张表；1254607 / 1255001 = 飞书侧限流或内部错误
const RETRY_ERRORS = new Set([1254291, 1254607, 1255001]);

async function send(method, path, { query, body } = {}) {
  const token = await getTenantAccessToken();
  const url = new URL(config.lark.apiBase + path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }

  return fetchJson(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 只对 token 失效和并发/限流这两类可恢复错误重试；权限、字段、参数错误立刻抛出。 */
export async function larkRequest(method, path, options) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send(method, path, options);
    } catch (error) {
      if (attempt >= 2) throw error;
      if (TOKEN_ERRORS.has(error.code)) {
        cachedToken = null;
        cachedExpiry = 0;
        continue;
      }
      if (!RETRY_ERRORS.has(error.code)) throw error;
      await new Promise((done) => setTimeout(done, 500 * (attempt + 1)));
    }
  }
}

// 授权 lijue 本人访问由应用创建的文档/表格，否则她打开自己的链接会 403
export async function grantUserAccess(token, type, perm = "full_access") {
  if (!config.lark.userOpenId) return { skipped: "LARK_USER_OPEN_ID 未配置" };
  return larkRequest("POST", `/drive/v1/permissions/${token}/members`, {
    query: { type, need_notification: "false" },
    body: { member_type: "openid", member_id: config.lark.userOpenId, perm },
  });
}
