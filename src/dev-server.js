import { createServer } from "http";
import { readFile } from "fs/promises";
import { extname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { handle } from "./api/index.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function readBody(req) {
  return new Promise((done, fail) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) fail(new Error("请求体过大"));
      else chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

async function serveStatic(pathname, res) {
  // 前缀必须带分隔符，否则同级的 public-xxx 目录也会通过检查
  const root = resolve(PUBLIC_DIR) + sep;
  const requested = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!requested.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const file = await readFile(requested);
    res.writeHead(200, { "Content-Type": MIME[extname(requested)] || "application/octet-stream" });
    res.end(file);
  } catch {
    // 前端是单页，路由路径回落到 index.html；但带扩展名的说明是资源路径写错了，
    // 回落会让浏览器拿到一个 text/html 的 index.html，报的错和真实原因毫无关系
    if (extname(requested)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`找不到静态资源：${pathname}`);
      return;
    }
    try {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(await readFile(join(PUBLIC_DIR, "index.html")));
    } catch {
      res.writeHead(404).end("public/index.html 不存在");
    }
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (!pathname.startsWith("/api/")) return serveStatic(pathname, res);

  let body = {};
  if (req.method !== "GET" && req.method !== "HEAD") {
    const text = await readBody(req).catch(() => "");
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        res.writeHead(400, { "Content-Type": MIME[".json"] });
        res.end(JSON.stringify({ ok: false, error: "请求体不是合法 JSON" }));
        return;
      }
    }
  }

  const result = await handle({ method: req.method, url: req.url, headers: req.headers, body });
  res.writeHead(result.status, { "Content-Type": MIME[".json"] });
  res.end(result.body === null ? "" : JSON.stringify(result.body));
});

server.listen(config.port, () => {
  console.log(`job-hunter → http://localhost:${config.port}`);
  if (!config.auth.password) console.log("提示：APP_PASSWORD 未设置，接口无口令保护（仅限本地）");
});
