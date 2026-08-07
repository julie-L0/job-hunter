import { handle } from "../src/api/index.js";

// Vercel 的 catch-all 入口，所有 /api/* 都进这里，再由 src/api/index.js 路由
export default async function handler(req, res) {
  let body = req.body ?? {};
  if (typeof body === "string") {
    try {
      body = body ? JSON.parse(body) : {};
    } catch {
      res.status(400).json({ ok: false, error: "请求体不是合法 JSON" });
      return;
    }
  }

  const result = await handle({ method: req.method, url: req.url, headers: req.headers, body });
  res.status(result.status).json(result.body ?? {});
}
