import { createServer } from "http";
import { createWriteStream } from "fs";
import { readFile, rm } from "fs/promises";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { basename, extname, join, resolve, sep } from "path";
import { fileURLToPath } from "url";
import { config } from "./config.js";
import { handle } from "./api/index.js";
import { assertAuthorized } from "./http/app.js";
import { assertTranscribeEnabled, startTranscribeJob } from "./services/transcribe.js";

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

const AUDIO_UPLOAD_PATH = "/api/reviews/audio";

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": MIME[".json"] });
  res.end(JSON.stringify(body));
}

/**
 * 录音上传。不走 JSON 路由：整段录音可能上百 MB，读成字符串再 base64 会直接把内存打穿。
 * 因为绕开了 createApp，口令校验必须在这里显式调一次。只在本地注册，Vercel 上没有这条路由。
 */
async function handleAudioUpload(req, res, parsed) {
  try {
    assertAuthorized(req.headers);
    assertTranscribeEnabled();
  } catch (error) {
    sendJson(res, error.status || 500, { ok: false, error: error.message });
    return;
  }

  // basename 是必须的：name 来自浏览器，不能让它带出 tmpdir
  const originalName = basename(String(parsed.searchParams.get("name") || "audio"));
  const filePath = join(tmpdir(), `job-hunter-${randomUUID()}${extname(originalName)}`);
  const limit = Math.max(1, config.asr.maxUploadMb) * 1024 * 1024;
  const out = createWriteStream(filePath);

  let size = 0;
  let aborted = false;
  const fail = async (status, message) => {
    if (aborted) return;
    aborted = true;
    req.unpipe(out);
    out.destroy();
    await rm(filePath, { force: true }).catch(() => {});
    sendJson(res, status, { ok: false, error: message });
  };

  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > limit) fail(413, `录音超过 ${config.asr.maxUploadMb}MB 上限`);
  });
  req.on("error", () => fail(400, "上传中断"));
  out.on("error", () => fail(500, "写入临时文件失败"));
  req.pipe(out);

  out.on("close", () => {
    if (aborted) return;
    if (!size) {
      fail(400, "上传内容为空");
      return;
    }
    try {
      const jobId = startTranscribeJob({ filePath, originalName });
      sendJson(res, 200, { ok: true, data: { jobId } });
    } catch (error) {
      fail(error.status || 500, error.message);
    }
  });
}

const server = createServer(async (req, res) => {
  const parsed = new URL(req.url, "http://localhost");
  const pathname = parsed.pathname;

  if (!pathname.startsWith("/api/")) return serveStatic(pathname, res);

  // 现有 5MB JSON 上限保持不动，只在这一条路径放宽
  if (req.method === "POST" && pathname === AUDIO_UPLOAD_PATH) {
    return handleAudioUpload(req, res, parsed);
  }

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
