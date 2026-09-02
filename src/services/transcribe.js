// 本地语音转写的任务机。转写一小时录音要几分钟，远超前端 60s 超时，
// 所以必须「提交任务 → 轮询进度」，job 存在进程内存里。
//
// 这条路只在本地常驻进程上成立：Vercel 无状态、跑不了 Python，isTranscribeEnabled() 直接返回 false，
// 线上靠 /api/health 的 transcribeEnabled 让前端隐藏入口。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { HttpError } from "../http/app.js";

/** jobId → { status, progress, segments, durationSec, error, originalName, finishedAt } */
const jobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

export function isTranscribeEnabled() {
  // VERCEL 由平台注入，本地永远没有。放在最前面，避免线上因为误配环境变量而尝试 spawn。
  const { pythonPath, scriptPath, modelDir } = config.asr;
  if (!pythonPath || !scriptPath || !modelDir) return false;
  return existsSync(pythonPath) && existsSync(scriptPath) && existsSync(modelDir);
}

export function assertTranscribeEnabled() {
  if (!isTranscribeEnabled()) {
    throw new HttpError(400, "本地转写未启用：线上环境不支持，本地需配置 ASR_PYTHON / ASR_SCRIPT / ASR_MODEL_DIR");
  }
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

/** 转写完就删录音：服务端不保存面试录音，这是硬约束，不是优化项。 */
async function dropAudio(filePath) {
  await rm(filePath, { force: true }).catch(() => {});
}

function finish(job, patch) {
  Object.assign(job, patch, { finishedAt: Date.now() });
}

/**
 * Python 按行输出 JSON：`{"progress":0.42}` 逐行更新进度，最后一行是
 * `{"segments":[...],"durationSec":3600}`。不用整体 JSON 是因为要实时进度。
 */
function handleLine(job, line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return;
  let payload;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return; // 半行/脏行直接忽略，别让日志噪音打断整个任务
  }
  if (Number.isFinite(payload.progress)) {
    job.status = "running";
    job.progress = Math.min(1, Math.max(0, payload.progress));
  }
  if (Array.isArray(payload.segments)) {
    job.segments = payload.segments;
    job.durationSec = Number(payload.durationSec) || 0;
  }
  if (payload.error) job.error = String(payload.error);
}

export function startTranscribeJob({ filePath, originalName = "" }) {
  assertTranscribeEnabled();
  pruneJobs();

  const jobId = randomUUID();
  const job = {
    jobId,
    status: "pending",
    progress: 0,
    segments: null,
    durationSec: 0,
    error: null,
    originalName,
    finishedAt: null,
  };
  jobs.set(jobId, job);

  const child = spawn(
    config.asr.pythonPath,
    [config.asr.scriptPath, "--audio", filePath, "--model-dir", config.asr.modelDir],
    {
      stdio: ["ignore", "pipe", "pipe"],
      // 脚本自己也会 reconfigure，这里再固定一次：下面是按 utf8 读的，
      // Windows 中文系统上 Python 默认会按 cp936 写管道，不对齐就整段中文乱码
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    },
  );

  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(job, line);
  });

  // stderr 只留最后一段，且只用于报错。转写文本一律不进日志（日志不得输出面试内容）。
  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-500);
  });

  child.on("error", async (error) => {
    finish(job, { status: "failed", error: `转写进程启动失败：${error.message}` });
    await dropAudio(filePath);
  });

  child.on("close", async (code) => {
    if (buffer.trim()) handleLine(job, buffer);
    if (code === 0 && job.segments) {
      finish(job, { status: "done", progress: 1 });
    } else {
      finish(job, {
        status: "failed",
        error: job.error || `转写失败（退出码 ${code}）${stderrTail ? `：${stderrTail.trim().split("\n").pop()}` : ""}`,
      });
    }
    await dropAudio(filePath);
  });

  return jobId;
}

export function getTranscribeJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) throw new HttpError(404, "转写任务不存在或已过期（任务只保留 30 分钟）");
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    segments: job.segments,
    durationSec: job.durationSec,
    error: job.error,
    originalName: job.originalName,
  };
}

/** 仅供测试：清掉进程内 job 表。 */
export function resetTranscribeJobs() {
  jobs.clear();
}
