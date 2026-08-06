import { config } from "../config.js";

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

// 部署到公网后，简历、JD、面试复盘都在这个 URL 后面，必须有口令
function requireAuth(headers) {
  if (!config.auth.password) return;
  const token = headers["x-auth-token"] || headers["X-Auth-Token"];
  if (token !== config.auth.password) throw new HttpError(401, "口令错误");
}

export function requireBody(body, keys) {
  const missing = keys.filter((key) => body[key] === undefined || body[key] === "");
  if (missing.length) throw new HttpError(400, `缺少参数：${missing.join(", ")}`);
  return body;
}
