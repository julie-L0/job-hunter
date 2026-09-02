import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";
import {
  getTranscribeJob,
  isTranscribeEnabled,
  resetTranscribeJobs,
  startTranscribeJob,
} from "./transcribe.js";

/**
 * 不装 Python 也要能测状态机：把 asr.pythonPath 指向当前 node，scriptPath 指向一个
 * 临时 .mjs，让它按同样的「按行 JSON」协议输出。测的是解析和状态流转，不是模型。
 */
async function withFakeEngine(scriptBody, run) {
  const dir = await mkdtemp(join(tmpdir(), "job-hunter-asr-test-"));
  const scriptPath = join(dir, "fake-engine.mjs");
  const audioPath = join(dir, "audio.m4a");
  await writeFile(scriptPath, scriptBody, "utf8");
  await writeFile(audioPath, "not really audio", "utf8");

  const original = { ...config.asr };
  const hadVercel = process.env.VERCEL;
  delete process.env.VERCEL;
  Object.assign(config.asr, {
    pythonPath: process.execPath,
    scriptPath,
    modelDir: dir,
  });
  resetTranscribeJobs();
  try {
    await run({ audioPath, dir });
  } finally {
    Object.assign(config.asr, original);
    if (hadVercel !== undefined) process.env.VERCEL = hadVercel;
    resetTranscribeJobs();
    await rm(dir, { recursive: true, force: true });
  }
}

/** 轮询到任务不再是 pending/running。真实前端也是这么等的。 */
async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const job = getTranscribeJob(jobId);
    if (job.status === "done" || job.status === "failed") return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("转写任务一直没结束");
}

test("isTranscribeEnabled honors a configured local engine", () => {
  const original = { ...config.asr };
  const hadVercel = process.env.VERCEL;
  try {
    Object.assign(config.asr, {
      pythonPath: process.execPath,
      scriptPath: process.execPath,
      modelDir: tmpdir(),
    });
    process.env.VERCEL = "1";
    assert.equal(isTranscribeEnabled(), true);
  } finally {
    Object.assign(config.asr, original);
    if (hadVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = hadVercel;
  }
});

test("isTranscribeEnabled requires every asr path to be configured and to exist", () => {
  const original = { ...config.asr };
  const hadVercel = process.env.VERCEL;
  delete process.env.VERCEL;
  try {
    Object.assign(config.asr, { pythonPath: "", scriptPath: "", modelDir: "" });
    assert.equal(isTranscribeEnabled(), false, "未配置时必须关闭");

    Object.assign(config.asr, {
      pythonPath: process.execPath,
      scriptPath: join(tmpdir(), "definitely-not-here-transcribe.py"),
      modelDir: tmpdir(),
    });
    assert.equal(isTranscribeEnabled(), false, "路径配了但文件不存在时必须关闭");

    Object.assign(config.asr, {
      pythonPath: process.execPath,
      scriptPath: process.execPath,
      modelDir: tmpdir(),
    });
    assert.equal(isTranscribeEnabled(), true);
  } finally {
    Object.assign(config.asr, original);
    if (hadVercel !== undefined) process.env.VERCEL = hadVercel;
  }
});

test("startTranscribeJob refuses to run when transcription is disabled", () => {
  const original = { ...config.asr };
  try {
    Object.assign(config.asr, { pythonPath: "", scriptPath: "", modelDir: "" });
    assert.throws(() => startTranscribeJob({ filePath: "whatever.m4a" }), /本地转写未启用/);
  } finally {
    Object.assign(config.asr, original);
  }
});

test("a job walks pending → done, keeps the segments, and deletes the audio", async () => {
  const script = [
    `process.stdout.write(JSON.stringify({ progress: 0.5 }) + "\\n");`,
    `process.stdout.write(JSON.stringify({`,
    `  segments: [{ start: 0, end: 8, text: "自我介绍一下" }],`,
    `  durationSec: 3600,`,
    `}) + "\\n");`,
  ].join("\n");

  await withFakeEngine(script, async ({ audioPath }) => {
    const jobId = startTranscribeJob({ filePath: audioPath, originalName: "一面.m4a" });
    assert.equal(getTranscribeJob(jobId).status, "pending");

    const job = await waitForJob(jobId);
    assert.equal(job.status, "done");
    assert.equal(job.progress, 1);
    assert.equal(job.durationSec, 3600);
    assert.equal(job.originalName, "一面.m4a");
    assert.deepEqual(job.segments, [{ start: 0, end: 8, text: "自我介绍一下" }]);
    // 服务端不留录音，这是硬约束
    assert.equal(existsSync(audioPath), false);
  });
});

test("a job that reports an error ends up failed with the message surfaced", async () => {
  const script = [
    `process.stdout.write(JSON.stringify({ error: "ffmpeg 没装" }) + "\\n");`,
    `process.exit(1);`,
  ].join("\n");

  await withFakeEngine(script, async ({ audioPath }) => {
    const job = await waitForJob(startTranscribeJob({ filePath: audioPath }));
    assert.equal(job.status, "failed");
    assert.match(job.error, /ffmpeg 没装/);
    assert.equal(existsSync(audioPath), false);
  });
});

test("exiting zero without segments still counts as failure", async () => {
  // 进程「成功」退出但没吐结果，绝不能报成 done——前端会拿到空分段还以为转写好了
  await withFakeEngine(`process.stdout.write("hello, not json\\n");`, async ({ audioPath }) => {
    const job = await waitForJob(startTranscribeJob({ filePath: audioPath }));
    assert.equal(job.status, "failed");
    assert.match(job.error, /转写失败/);
  });
});

test("progress lines split across chunks are still parsed", async () => {
  const script = [
    // 故意把一行 JSON 拆成两次写，模拟 stdout 分片
    `process.stdout.write('{"progress":0.2');`,
    `await new Promise((r) => setTimeout(r, 30));`,
    `process.stdout.write('}\\n');`,
    `await new Promise((r) => setTimeout(r, 60));`,
    `process.stdout.write(JSON.stringify({ segments: [{ start: 1, end: 3, text: "好" }], durationSec: 10 }));`,
  ].join("\n");

  await withFakeEngine(script, async ({ audioPath }) => {
    const jobId = startTranscribeJob({ filePath: audioPath });
    const job = await waitForJob(jobId);
    assert.equal(job.status, "done");
    // 最后一行没有换行符，靠 close 时的 buffer 兜底解析
    assert.deepEqual(job.segments, [{ start: 1, end: 3, text: "好" }]);
  });
});

test("getTranscribeJob throws 404 for an unknown job id", () => {
  resetTranscribeJobs();
  assert.throws(() => getTranscribeJob("nope"), /转写任务不存在/);
});
