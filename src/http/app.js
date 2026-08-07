import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_TRACKED_CLIENTS = 1000;

const loginAttempts = new Map();

export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function compile(pattern) {
  const segments = pattern.split("/").filter(Boolean);
  return (pathname) => {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length !== segments.length) return null;
    const params = {};
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].startsWith(":")) params[segments[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (segments[i] !== parts[i]) return null;
    }
    return params;
  };
}

export function createApp(routes) {
  const compiled = routes.map((route) => ({ ...route, match: compile(route.path) }));

  return async function handle({ method, url, headers = {}, body }) {
    const parsed = new URL(url, "http://localhost");
    const pathname = parsed.pathname;

    if (method === "OPTIONS") return { status: 204, body: null };

    let pathMatched = false;
    for (const route of compiled) {
      const params = route.match(pathname);
      if (!params) continue;
      pathMatched = true;
      if (route.method !== method) continue;

      try {
        if (!route.public) requireAuth(headers);
        const data = await route.handler({
          params,
          query: Object.fromEntries(parsed.searchParams),
          body: body ?? {},
          headers,
        });
        return { status: 200, body: { ok: true, data } };
      } catch (error) {
        const status = error instanceof HttpError ? error.status : 500;
        if (status >= 500) console.error(`[${method} ${pathname}]`, error);
        return {
          status,
          body: { ok: false, error: error.message, detail: error.detail ?? null },
        };
      }
    }

    return {
      status: pathMatched ? 405 : 404,
      body: { ok: false, error: pathMatched ? "方法不允许" : `无此接口：${method} ${pathname}` },
    };
  };
}

function productionAuthRequired() {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === "production";
}

export function isAuthRequired() {
  return productionAuthRequired() || Boolean(config.auth.password);
}

function assertAuthConfigured() {
  if (isAuthRequired() && !config.auth.password) {
    throw new HttpError(503, "缺少环境变量：APP_PASSWORD（公网运行必须配置）");
  }
}

function digest(value) {
  return createHash("sha256").update(String(value ?? "")).digest();
}

function equalSecret(actual, expected) {
  return timingSafeEqual(digest(actual), digest(expected));
}

function sessionSignature(payload) {
  return createHmac("sha256", config.auth.password).update(payload).digest("base64url");
}

function issueSessionToken(now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      issuedAt: now,
      expiresAt: now + SESSION_TTL_MS,
      nonce: randomBytes(16).toString("base64url"),
    }),
  ).toString("base64url");
  return `${payload}.${sessionSignature(payload)}`;
}

function validSessionToken(token, now = Date.now()) {
  if (typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2 || !equalSecret(parts[1], sessionSignature(parts[0]))) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.version === 1 && Number.isFinite(payload.expiresAt) && payload.expiresAt > now;
  } catch {
    return false;
  }
}

function headerValue(headers, name) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function clientKey(headers) {
  const forwarded = String(headerValue(headers, "x-forwarded-for") || "");
  return (forwarded.split(",")[0].trim() || String(headerValue(headers, "x-real-ip") || "local")).slice(0, 128);
}

function pruneLoginAttempts(now) {
  for (const [key, entry] of loginAttempts) {
    if (entry.blockedUntil <= now && now - entry.windowStartedAt >= LOGIN_WINDOW_MS) loginAttempts.delete(key);
  }
  if (loginAttempts.size >= MAX_TRACKED_CLIENTS) loginAttempts.delete(loginAttempts.keys().next().value);
}

function rejectLimitedLogin(key, now) {
  const entry = loginAttempts.get(key);
  if (entry?.blockedUntil > now) {
    throw new HttpError(429, "尝试次数过多，请稍后再试", {
      retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000),
    });
  }
}

function recordFailedLogin(key, now) {
  const previous = loginAttempts.get(key);
  const entry =
    previous && now - previous.windowStartedAt < LOGIN_WINDOW_MS
      ? previous
      : { attempts: 0, windowStartedAt: now, blockedUntil: 0 };
  entry.attempts += 1;
  if (entry.attempts >= MAX_LOGIN_ATTEMPTS) entry.blockedUntil = now + LOGIN_LOCK_MS;
  loginAttempts.set(key, entry);
  rejectLimitedLogin(key, now);
}

export function createSession(password, headers = {}) {
  assertAuthConfigured();
  if (!isAuthRequired()) return { token: "", expiresAt: null };

  const now = Date.now();
  pruneLoginAttempts(now);
  const key = clientKey(headers);
  rejectLimitedLogin(key, now);
  if (!equalSecret(password, config.auth.password)) {
    recordFailedLogin(key, now);
    throw new HttpError(401, "口令错误");
  }

  loginAttempts.delete(key);
  return { token: issueSessionToken(now), expiresAt: now + SESSION_TTL_MS };
}

function requireAuth(headers) {
  if (!isAuthRequired()) return;
  assertAuthConfigured();
  const token = headerValue(headers, "x-auth-token");
  if (!validSessionToken(token)) throw new HttpError(401, "登录已失效，请重新输入");
}

export function requireBody(body, keys) {
  const missing = keys.filter((key) => body[key] === undefined || body[key] === "");
  if (missing.length) throw new HttpError(400, `缺少参数：${missing.join(", ")}`);
  return body;
}
